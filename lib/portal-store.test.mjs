import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { getTeacherState, getStudentState, submitApplication, verifyApplication, importStudents, updateClubs, changePhase, runAllocation, adjustPlacement, finalize, getHistory, getAudit, resetStudentCode } from './server/store.ts';

// D1's prepared statement API backed by real SQLite, including atomic batch rollback.
function memoryDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const execute = (sql, parameters, kind) => {
    const statement = sqlite.prepare(sql);
    if (kind === 'run') {
      const metadata = statement.run(...parameters);
      return { success: true, results: [], meta: { changes: Number(metadata.changes), last_row_id: Number(metadata.lastInsertRowid) } };
    }
    const rows = statement.all(...parameters).map(row => ({ ...row }));
    return { success: true, results: rows, meta: { changes: 0 } };
  };
  const prepared = (sql, parameters = []) => ({
    bind: (...values) => prepared(sql, values),
    first: async column => {
      const row = execute(sql, parameters, 'all').results[0] ?? null;
      return column === undefined || row === null ? row : row[column];
    },
    all: async () => execute(sql, parameters, 'all'),
    run: async () => execute(sql, parameters, 'run'),
    raw: async () => execute(sql, parameters, 'all').results.map(row => Object.values(row)),
    execute: () => execute(sql, parameters, /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) ? 'all' : 'run'),
  });
  return {
    sqlite,
    prepare: sql => prepared(sql),
    exec: async sql => { sqlite.exec(sql); return { count: 1, duration: 0 }; },
    batch: async statements => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const actor = 'teacher-test';
const preferences = ['paper', 'pen', 'writing'];
const revisedPreferences = ['pen', 'writing', 'paper'];
const isConflict = error => error.status === 409;
const roster = count => Array.from({ length: count }, (_, index) => ({
  grade: 5, classNo: 1, number: index + 1, name: `Real Student ${index + 1}`, gender: index % 2 ? '여' : '남', codeHash: `hashed-code-${index + 1}`,
}));

async function fixture(context, count = 4, open = true) {
  const db = memoryDb();
  context.after(() => db.sqlite.close());
  const migrations = new URL('../drizzle/', import.meta.url);
  const files = (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  assert.ok(files.length > 0);
  for (const file of files) await db.exec(await readFile(new URL(file, migrations), 'utf8'));
  const initial = await getTeacherState(db);
  assert.equal(initial.phase, 'setup');
  assert.deepEqual(initial.students, [], 'production storage must not generate demo students');
  if (count) await importStudents(db, roster(count), initial.revision, actor);
  let state = await getTeacherState(db);
  if (open) state = await changePhase(db, 'open', state.revision, actor);
  return { db, state };
}

test('D1 test adapter rolls back every statement after a failed atomic batch', async () => {
  const db = memoryDb();
  await db.exec('CREATE TABLE adapter_check (id TEXT PRIMARY KEY)');
  await assert.rejects(db.batch([
    db.prepare('INSERT INTO adapter_check (id) VALUES (?)').bind('same'),
    db.prepare('INSERT INTO adapter_check (id) VALUES (?)').bind('same'),
  ]));
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM adapter_check').first('n'), 0);
  db.sqlite.close();
});

test('first submission and every resubmission are immutable history; current version replaces choices and resets confirmation', async context => {
  const { db } = await fixture(context);
  let state = await submitApplication(db, '5-1-1', preferences, 0);
  assert.equal(state.student.applicationVersion, 1);
  assert.deepEqual(state.student.choices, preferences);
  assert.ok(state.student.submittedAt);
  state = await verifyApplication(db, '5-1-1', 1);
  assert.equal(state.student.verifiedVersion, 1);
  assert.ok(state.student.verifiedAt);
  const first = await getHistory(db, '5-1-1');
  assert.equal(first.length, 1, 'verification does not create a submission revision');
  state = await submitApplication(db, '5-1-1', revisedPreferences, 1);
  assert.equal(state.student.applicationVersion, 2);
  assert.deepEqual(state.student.choices, revisedPreferences);
  assert.equal(state.student.verifiedVersion, null);
  assert.equal(state.student.verifiedAt, null);
  const history = await getHistory(db, '5-1-1');
  assert.equal(history.length, 2);
  assert.deepEqual(history[0], first[0]);
  assert.deepEqual(history.map(revision => revision.version), [1, 2]);
  assert.deepEqual(history.map(revision => revision.choices), [preferences, revisedPreferences]);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM applications WHERE student_id=?').bind('5-1-1').first('n'), 1);
  await assert.rejects(db.prepare('UPDATE application_revisions SET choices_json=? WHERE student_id=?').bind('[]', '5-1-1').run(), /immutable/i);
  await assert.rejects(db.prepare('DELETE FROM application_revisions WHERE student_id=?').bind('5-1-1').run(), /immutable/i);
  assert.deepEqual(await getHistory(db, '5-1-1'), history);
});

test('stale application versions cannot overwrite a newer application or append an audit or history entry', async context => {
  const { db } = await fixture(context);
  await submitApplication(db, '5-1-1', preferences, 0);
  const before = await getTeacherState(db), audit = await getAudit(db), history = await getHistory(db, '5-1-1');
  await assert.rejects(submitApplication(db, '5-1-1', revisedPreferences, 0), isConflict);
  await assert.rejects(verifyApplication(db, '5-1-1', 0), isConflict);
  assert.deepEqual(await getTeacherState(db), before);
  assert.deepEqual(await getAudit(db), audit);
  assert.deepEqual(await getHistory(db, '5-1-1'), history);
});

test('concurrent submissions by one student allow one winner, while different students can submit concurrently', async context => {
  const { db } = await fixture(context);
  const sameStudent = await Promise.allSettled([
    submitApplication(db, '5-1-1', preferences, 0),
    submitApplication(db, '5-1-1', revisedPreferences, 0),
  ]);
  assert.equal(sameStudent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(sameStudent.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal((await getHistory(db, '5-1-1')).length, 1);
  const differentStudents = await Promise.allSettled([
    submitApplication(db, '5-1-2', preferences, 0),
    submitApplication(db, '5-1-3', revisedPreferences, 0),
  ]);
  assert.ok(differentStudents.every(result => result.status === 'fulfilled'));
  for (const id of ['5-1-1', '5-1-2', '5-1-3']) assert.equal((await getStudentState(db, id)).student.applicationVersion, 1);
});

test('closed registration blocks direct submissions and confirmation applies only to the current submitted version', async context => {
  const { db } = await fixture(context);
  await assert.rejects(verifyApplication(db, '5-1-2', 1), isConflict);
  await submitApplication(db, '5-1-1', preferences, 0);
  await submitApplication(db, '5-1-1', revisedPreferences, 1);
  const state = await getTeacherState(db);
  await changePhase(db, 'closed', state.revision, actor);
  const before = await getTeacherState(db), audit = await getAudit(db);
  await assert.rejects(submitApplication(db, '5-1-1', preferences, 2), isConflict);
  await assert.rejects(submitApplication(db, '5-1-2', preferences, 0), isConflict);
  await assert.rejects(verifyApplication(db, '5-1-1', 1), isConflict);
  assert.deepEqual(await getTeacherState(db), before);
  assert.deepEqual(await getAudit(db), audit);
  const verified = await verifyApplication(db, '5-1-1', 2);
  assert.equal(verified.student.verifiedVersion, 2);
  assert.equal((await getHistory(db, '5-1-1')).length, 2);
});

test('a closing-registration race cannot accept a submission after closing or log the losing operation', async context => {
  const { db, state } = await fixture(context);
  const beforeAudit = await getAudit(db);
  const outcomes = await Promise.allSettled([
    changePhase(db, 'closed', state.revision, actor),
    submitApplication(db, '5-1-1', preferences, 0),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  const current = await getTeacherState(db);
  assert.equal(current.revision, state.revision + 1);
  assert.equal((await getAudit(db)).length, beforeAudit.length + 1);
  const closed = outcomes[0].status === 'fulfilled';
  assert.equal(current.phase, closed ? 'closed' : 'open');
  assert.equal((await getHistory(db, '5-1-1')).length, closed ? 0 : 1);
});

test('student state exposes only that student, sanitized clubs, and their own result only after finalization', async context => {
  const { db, state } = await fixture(context, 4, false);
  const clubs = state.clubs.map(club => club.id === 'paper' ? { ...club, allocationMode: 'fixed', fixedStudentIds: ['5-1-2'] } : club);
  let next = await updateClubs(db, clubs, state.revision, actor);
  next = await changePhase(db, 'open', next.revision, actor);
  for (const id of ['5-1-1', '5-1-2']) await submitApplication(db, id, preferences, 0);
  next = await getTeacherState(db);
  next = await changePhase(db, 'closed', next.revision, actor);
  next = await runAllocation(db, 'private-allocation-seed', next.revision, actor);
  const beforeFinal = await getStudentState(db, '5-1-1');
  assert.deepEqual(Object.keys(beforeFinal).sort((a, b) => a.localeCompare(b)), ['clubs', 'phase', 'placement', 'student']);
  assert.equal(beforeFinal.student.id, '5-1-1');
  assert.equal(beforeFinal.placement, null);
  const encoded = JSON.stringify(beforeFinal);
  for (const forbidden of ['fixedStudentIds', 'Real Student 2', '5-1-2', 'private-allocation-seed', 'code_hash', 'hashed-code', 'operation_log']) assert.ok(!encoded.includes(forbidden), forbidden);
  await finalize(db, next.revision, actor);
  const final = await getStudentState(db, '5-1-1');
  assert.equal(final.placement.club, 'paper');
  assert.equal(final.placement.rank, 1);
  assert.ok(!JSON.stringify(final).includes('5-1-2'));
});

test('closed allocation uses genuine applicants and fixed nonapplicants, fills only residual capacity, and never creates demos', async context => {
  const { db, state } = await fixture(context, 10, false);
  const clubs = state.clubs.map(club => club.id === 'paper' ? { ...club, min: 0, max: 5, allocationMode: 'fixed', fixedStudentIds: ['5-1-1', '5-1-2'] } : club);
  let next = await updateClubs(db, clubs, state.revision, actor);
  next = await changePhase(db, 'open', next.revision, actor);
  for (let number = 3; number <= 9; number++) await submitApplication(db, `5-1-${number}`, preferences, 0);
  next = await getTeacherState(db);
  await assert.rejects(runAllocation(db, 'too-early', next.revision, actor), isConflict);
  next = await changePhase(db, 'closed', next.revision, actor);
  const allocated = await runAllocation(db, 'real-applicants-only', next.revision, actor);
  assert.equal(allocated.phase, 'allocated');
  assert.equal(allocated.students.length, 10);
  assert.equal(Object.keys(allocated.result.placements).length, 10);
  for (const id of ['5-1-1', '5-1-2']) {
    assert.equal(allocated.result.placements[id].assignmentType, 'fixed');
    assert.equal(allocated.result.placements[id].club, 'paper');
    assert.equal(allocated.students.find(student => student.id === id).applicationVersion, 0);
    assert.deepEqual(allocated.students.find(student => student.id === id).choices, []);
  }
  const firstPaper = allocated.result.rounds.find(round => round.club === 'paper' && round.rank === 1);
  assert.equal(firstPaper.seats, 3);
  assert.equal(firstPaper.candidates.length, 7);
  assert.equal(firstPaper.winners.length, 3);
  assert.equal(Object.values(allocated.result.placements).filter(placement => placement.club === 'paper').length, 5);
  assert.equal(allocated.result.placements['5-1-10'].club, null);
  const allCandidates = allocated.result.rounds.flatMap(round => round.candidates);
  for (const excluded of ['5-1-1', '5-1-2', '5-1-10']) assert.ok(!allCandidates.includes(excluded));
  assert.ok(Object.keys(allocated.result.placements).every(id => allocated.students.some(student => student.id === id)));
  assert.ok(allocated.students.every(student => student.name.startsWith('Real Student')));
  await assert.rejects(adjustPlacement(db, '5-1-1', 'pen', 'cannot move fixed', allocated.revision, actor));
});

test('stale teacher revisions fail atomically without changing state, students, or audit history', async context => {
  const { db, state } = await fixture(context, 4, false);
  const clubs = state.clubs.map(club => ({ ...club, name: `${club.name} Updated` }));
  const changed = await updateClubs(db, clubs, state.revision, actor);
  const audit = await getAudit(db);
  await assert.rejects(updateClubs(db, state.clubs, state.revision, actor), isConflict);
  await assert.rejects(importStudents(db, [{ ...roster(1)[0], number: 20, codeHash: 'new-hash' }], state.revision, actor), isConflict);
  await assert.rejects(changePhase(db, 'open', state.revision, actor), isConflict);
  await assert.rejects(resetStudentCode(db, '5-1-1', 'reset-stale-hash', state.revision, actor), isConflict);
  assert.deepEqual(await getTeacherState(db), changed);
  assert.deepEqual(await getAudit(db), audit);
  const race = await Promise.allSettled([
    updateClubs(db, state.clubs, changed.revision, 'teacher-one'),
    updateClubs(db, clubs, changed.revision, 'teacher-two'),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal((await getAudit(db)).length, audit.length + 1);
});

test('malformed, duplicate identity, and duplicate code imports preserve the entire previous database state', async context => {
  const { db, state } = await fixture(context, 2, false);
  const audit = await getAudit(db);
  const valid = { ...roster(1)[0], number: 10, codeHash: 'new-import-code' };
  for (const rows of [
    [valid, { ...valid, number: 11, name: '', codeHash: 'different-code' }],
    [valid, { ...valid, codeHash: 'different-code' }],
    [valid, { ...valid, number: 1, codeHash: 'different-code' }],
    [valid, { ...valid, number: 11 }],
    [valid, { ...valid, number: 11, codeHash: 'hashed-code-1' }],
  ]) {
    await assert.rejects(importStudents(db, rows, state.revision, actor));
    assert.deepEqual(await getTeacherState(db), state);
    assert.deepEqual(await getAudit(db), audit);
  }
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM students').first('n'), 2);
});

test('code reset revokes sessions while retaining current application, confirmation and immutable submission history', async context => {
  const { db } = await fixture(context);
  await submitApplication(db, '5-1-1', preferences, 0);
  await submitApplication(db, '5-1-1', revisedPreferences, 1);
  await verifyApplication(db, '5-1-1', 2);
  await db.prepare('INSERT INTO sessions(token_hash,role,student_id,credential_version,expires_at) VALUES(?,?,?,?,?)').bind('hashed-session', 'student', '5-1-1', '1', Date.now() + 60000).run();
  const before = await getStudentState(db, '5-1-1'), history = await getHistory(db, '5-1-1');
  const state = await getTeacherState(db);
  await resetStudentCode(db, '5-1-1', 'reset-hashed-code', state.revision, actor);
  assert.deepEqual(await getStudentState(db, '5-1-1'), before);
  assert.deepEqual(await getHistory(db, '5-1-1'), history);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE student_id=?').bind('5-1-1').first('n'), 0);
  const credential = await db.prepare('SELECT code_hash,code_version FROM students WHERE id=?').bind('5-1-1').first();
  assert.equal(credential.code_hash, 'reset-hashed-code');
  assert.equal(credential.code_version, 2);
  const log = (await getAudit(db)).at(-1);
  assert.equal(log.action, 'student.code-reset');
  assert.ok(!JSON.stringify(log).includes('reset-hashed-code'));
});

test('atomic student write guards reject revoked, expired, wrong-student and old-credential sessions', async context => {
  const { db } = await fixture(context);
  await submitApplication(db, '5-1-1', preferences, 0);
  await db.prepare('INSERT INTO sessions(token_hash,role,student_id,credential_version,expires_at) VALUES(?,?,?,?,?)').bind('valid-token-hash', 'student', '5-1-1', '1', Date.now() + 60000).run();
  await verifyApplication(db, '5-1-1', 1, { tokenHash: 'valid-token-hash' });
  const before = await getTeacherState(db), audit = await getAudit(db), history = await getHistory(db, '5-1-1');
  await assert.rejects(submitApplication(db, '5-1-2', preferences, 0, { tokenHash: 'valid-token-hash' }), isConflict);
  await assert.rejects(submitApplication(db, '5-1-1', revisedPreferences, 1, { tokenHash: 'revoked-token-hash' }), isConflict);
  await assert.rejects(verifyApplication(db, '5-1-1', 1, { tokenHash: 'revoked-token-hash' }), isConflict);
  await db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(Date.now() - 1, 'valid-token-hash').run();
  await assert.rejects(verifyApplication(db, '5-1-1', 1, { tokenHash: 'valid-token-hash' }), isConflict);
  await db.prepare('UPDATE sessions SET expires_at=?,credential_version=? WHERE token_hash=?').bind(Date.now() + 60000, '0', 'valid-token-hash').run();
  await assert.rejects(verifyApplication(db, '5-1-1', 1, { tokenHash: 'valid-token-hash' }), isConflict);
  assert.deepEqual(await getTeacherState(db), before);
  assert.deepEqual(await getAudit(db), audit);
  assert.deepEqual(await getHistory(db, '5-1-1'), history);
});
