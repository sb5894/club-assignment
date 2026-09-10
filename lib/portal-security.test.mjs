import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { createPasswordHash, createStudentCodeIssuer, hashSecret, normalizeStudentCode } from './server/auth.ts';
import { handlePortalRequest } from './server/portal-api.ts';

function memoryDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const execute = (sql, parameters, kind) => {
    const statement = sqlite.prepare(sql);
    if (kind === 'run') {
      const metadata = statement.run(...parameters);
      return { success: true, results: [], meta: { changes: Number(metadata.changes), last_row_id: Number(metadata.lastInsertRowid) } };
    }
    return { success: true, results: statement.all(...parameters).map(row => ({ ...row })), meta: { changes: 0 } };
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

const origin = 'https://club.example.test';
const password = 'Test-only teacher password 2026!';
const passwordHash = createPasswordHash(password);

async function fixture(context) {
  const DB = memoryDb();
  context.after(() => DB.sqlite.close());
  const migrations = new URL('../drizzle/', import.meta.url);
  const files = (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  assert.ok(files.length > 0, 'production database migrations must exist');
  for (const file of files) await DB.exec(await readFile(new URL(file, migrations), 'utf8'));
  return { DB, TEACHER_PASSWORD_HASH: await passwordHash };
}

async function request(env, path, { method = 'GET', body, cookie, headers = {}, site = origin } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) {
    if (!requestHeaders.has('content-type')) requestHeaders.set('content-type', 'application/json');
    if (!requestHeaders.has('origin')) requestHeaders.set('origin', site);
  }
  if (cookie) requestHeaders.set('cookie', cookie);
  if (!requestHeaders.has('CF-Connecting-IP')) requestHeaders.set('CF-Connecting-IP', '192.0.2.10');
  return handlePortalRequest(new Request(`${site}${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
}

function cookieOf(response) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'successful login returns a session cookie');
  return cookie.split(';', 1)[0];
}

async function teacherLogin(env) {
  const response = await request(env, '/api/auth/teacher', { method: 'POST', body: { password } });
  assert.equal(response.status, 200, await response.clone().text());
  return cookieOf(response);
}

async function teacherState(env, cookie) {
  const response = await request(env, '/api/teacher/state', { cookie });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function teacherAction(env, cookie, body) {
  const response = await request(env, '/api/teacher/action', { method: 'POST', cookie, body });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function classroom(context, fixed = false) {
  const env = await fixture(context);
  const teacher = await teacherLogin(env);
  const initial = await teacherState(env, teacher);
  const imported = await teacherAction(env, teacher, { action: 'import', revision: initial.revision, rows: [
    { grade: 5, classNo: 1, number: 1, name: 'First Real Student', gender: '남' },
    { grade: 5, classNo: 1, number: 2, name: 'Second Real Student', gender: '여' },
    { grade: 5, classNo: 1, number: 3, name: 'Third Real Student', gender: '남' },
  ] });
  assert.equal(imported.codes.length, 3);
  let state = imported.state;
  if (fixed) ({ state } = await teacherAction(env, teacher, { action: 'settings', revision: state.revision,
    clubs: state.clubs.map(club => club.id === 'paper' ? { ...club, allocationMode: 'fixed', fixedStudentIds: ['5-1-2'] } : club),
  }));
  ({ state } = await teacherAction(env, teacher, { action: 'phase', phase: 'open', revision: state.revision }));
  return { env, teacher, state, codes: imported.codes };
}

async function studentLogin(env, issued) {
  const response = await request(env, '/api/auth/student', { method: 'POST', body: { studentId: issued.id, code: issued.code } });
  assert.equal(response.status, 200, await response.clone().text());
  return cookieOf(response);
}

test('unauthenticated requests cannot read student or teacher data or mutate teacher state', async context => {
  const env = await fixture(context);
  for (const path of ['/api/student/me', '/api/teacher/state', '/api/teacher/history?studentId=5-1-1', '/api/teacher/audit']) {
    const response = await request(env, path);
    assert.equal(response.status, 401, path);
  }
  const response = await request(env, '/api/teacher/action', { method: 'POST', body: { action: 'phase', phase: 'open', revision: 0 } });
  assert.equal(response.status, 401);
});

test('teacher password verification issues a secure cookie and tampered tokens are rejected', async context => {
  const env = await fixture(context);
  const denied = await request(env, '/api/auth/teacher', { method: 'POST', body: { password: 'incorrect' } });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('set-cookie'), null);
  const login = await request(env, '/api/auth/teacher', { method: 'POST', body: { password } });
  assert.equal(login.status, 200, await login.clone().text());
  const setCookie = login.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(flag), flag);
  const cookie = cookieOf(login);
  assert.equal((await request(env, '/api/teacher/state', { cookie })).status, 200);
  const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('A') ? 'B' : 'A'}`;
  assert.equal((await request(env, '/api/teacher/state', { cookie: tampered })).status, 401);
  assert.equal((await request(env, '/api/student/me', { cookie })).status, 401, 'teacher cookie cannot impersonate a student');
});

test('mutations require exact same-origin JSON and reject missing Origin before authentication', async context => {
  const env = await fixture(context);
  for (const badOrigin of ['https://attacker.example', 'https://club.example.test.attacker.example', 'null']) {
    const response = await request(env, '/api/auth/teacher', { method: 'POST', body: { password }, headers: { origin: badOrigin } });
    assert.equal(response.status, 403, badOrigin);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const missing = await handlePortalRequest(new Request(`${origin}/api/auth/teacher`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
  }), env);
  assert.equal(missing.status, 403);
  const wrongType = await request(env, '/api/auth/teacher', { method: 'POST', body: { password }, headers: { 'content-type': 'text/plain' } });
  assert.ok([400, 415].includes(wrongType.status));
});

test('teacher logout revokes the server session and clears the browser cookie', async context => {
  const env = await fixture(context);
  const cookie = await teacherLogin(env);
  const response = await request(env, '/api/auth/logout', { method: 'POST', cookie, body: { role: 'teacher' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/i);
  assert.equal((await request(env, '/api/teacher/state', { cookie })).status, 401);
});

test('repeated failed teacher logins are rate limited without blocking a different trusted IP', async context => {
  const env = await fixture(context);
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await request(env, '/api/auth/teacher', { method: 'POST', body: { password: 'wrong' } });
    assert.ok([401, 429].includes(response.status));
  }
  const limited = await request(env, '/api/auth/teacher', { method: 'POST', body: { password } });
  assert.equal(limited.status, 429);
  const otherIp = await request(env, '/api/auth/teacher', { method: 'POST', body: { password }, headers: { 'CF-Connecting-IP': '192.0.2.11' } });
  assert.equal(otherIp.status, 200);
});

test('student codes authenticate only the matching student and student cookies cannot access any teacher API', async context => {
  const { env, codes } = await classroom(context, true);
  const wrongIdentity = await request(env, '/api/auth/student', { method: 'POST', body: { studentId: codes[1].id, code: codes[0].code } });
  assert.equal(wrongIdentity.status, 401);
  assert.equal(wrongIdentity.headers.get('set-cookie'), null);
  const cookie = await studentLogin(env, { ...codes[0], code: codes[0].code.toLowerCase().replaceAll('-', ' ') });
  const own = await request(env, '/api/student/me', { cookie });
  assert.equal(own.status, 200);
  assert.match(own.headers.get('cache-control'), /no-store/);
  assert.equal(own.headers.get('vary'), 'Cookie');
  const state = await own.json();
  assert.equal(state.student.id, codes[0].id);
  const encoded = JSON.stringify(state);
  for (const forbidden of [codes[1].id, codes[1].name, codes[2].name, 'fixedStudentIds', 'code_hash', 'codeHash', 'token_hash']) assert.ok(!encoded.includes(forbidden), forbidden);
  for (const path of ['/api/teacher/state', `/api/teacher/history?studentId=${codes[1].id}`, '/api/teacher/audit']) {
    assert.equal((await request(env, path, { cookie })).status, 401, path);
  }
  const mutation = await request(env, '/api/teacher/action', { method: 'POST', cookie, body: { action: 'phase', phase: 'closed', revision: 0 } });
  assert.equal(mutation.status, 401);
});

test('student query and body identity injection are rejected and cannot read or modify a second student', async context => {
  const { env, teacher, codes } = await classroom(context);
  const cookie = await studentLogin(env, codes[0]);
  for (const path of [`/api/student/me?studentId=${codes[1].id}`, `/api/student/me?id=${codes[1].id}`]) {
    assert.equal((await request(env, path, { cookie })).status, 400);
  }
  for (const identity of [{ studentId: codes[1].id }, { id: codes[1].id }, { role: 'teacher' }]) {
    const response = await request(env, '/api/student/application', { method: 'POST', cookie,
      body: { choices: ['paper', 'pen', 'writing'], version: 0, ...identity },
    });
    assert.equal(response.status, 400);
  }
  const verify = await request(env, '/api/student/verify', { method: 'POST', cookie, body: { version: 1, studentId: codes[1].id } });
  assert.equal(verify.status, 400);
  const state = await teacherState(env, teacher);
  assert.ok(state.students.every(student => student.applicationVersion === 0));
  const history = await request(env, `/api/teacher/history?studentId=${codes[1].id}`, { cookie: teacher });
  assert.deepEqual((await history.json()).history, []);
});

test('authenticated HTTP submissions enforce versions, reset confirmation on edits, and reject closed registration writes', async context => {
  const { env, teacher, codes } = await classroom(context);
  const cookie = await studentLogin(env, codes[0]);
  const submit = async (choices, version) => request(env, '/api/student/application', { method: 'POST', cookie, body: { choices, version } });
  const first = await submit(['paper', 'pen', 'writing'], 0);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).student.applicationVersion, 1);
  const verified = await request(env, '/api/student/verify', { method: 'POST', cookie, body: { version: 1 } });
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).student.verifiedVersion, 1);
  assert.equal((await submit(['pen', 'writing', 'paper'], 0)).status, 409);
  const edited = await submit(['pen', 'writing', 'paper'], 1);
  assert.equal(edited.status, 200);
  const current = (await edited.json()).student;
  assert.equal(current.applicationVersion, 2);
  assert.equal(current.verifiedAt, null);
  assert.equal(current.verifiedVersion, null);
  const state = await teacherState(env, teacher);
  await teacherAction(env, teacher, { action: 'phase', phase: 'closed', revision: state.revision });
  assert.equal((await submit(['paper', 'pen', 'writing'], 2)).status, 409);
  assert.equal((await request(env, '/api/student/verify', { method: 'POST', cookie, body: { version: 1 } })).status, 409);
  assert.equal((await request(env, '/api/student/verify', { method: 'POST', cookie, body: { version: 2 } })).status, 200);
  const history = (await (await request(env, `/api/teacher/history?studentId=${codes[0].id}`, { cookie: teacher })).json()).history;
  assert.deepEqual(history.map(entry => entry.version), [1, 2]);
  assert.deepEqual(history.map(entry => entry.choices), [['paper', 'pen', 'writing'], ['pen', 'writing', 'paper']]);
});

test('expired sessions, duplicate cookies and teacher password rotation invalidate access', async context => {
  const { env, teacher, codes } = await classroom(context);
  const student = await studentLogin(env, codes[0]);
  assert.equal((await request(env, '/api/student/me', { cookie: `${student}; ${student}` })).status, 401);
  await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE role=?').bind(Date.now() - 1, 'student').run();
  assert.equal((await request(env, '/api/student/me', { cookie: student })).status, 401);
  const rotated = { ...env, TEACHER_PASSWORD_HASH: await createPasswordHash('Changed teacher password 2026!') };
  assert.equal((await request(rotated, '/api/teacher/state', { cookie: teacher })).status, 401);
  await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE role=?').bind(Date.now() - 1, 'teacher').run();
  assert.equal((await request(env, '/api/teacher/state', { cookie: teacher })).status, 401);
});

test('resetting a student code revokes old sessions and codes without deleting their application history', async context => {
  const { env, teacher, codes } = await classroom(context);
  const oldCookie = await studentLogin(env, codes[0]);
  const submitted = await request(env, '/api/student/application', { method: 'POST', cookie: oldCookie, body: { choices: ['paper', 'pen', 'writing'], version: 0 } });
  assert.equal(submitted.status, 200);
  const historyBefore = await (await request(env, `/api/teacher/history?studentId=${codes[0].id}`, { cookie: teacher })).json();
  const state = await teacherState(env, teacher);
  const reset = await teacherAction(env, teacher, { action: 'reset-code', studentId: codes[0].id, revision: state.revision });
  assert.notEqual(reset.codes[0].code, codes[0].code);
  assert.equal((await request(env, '/api/student/me', { cookie: oldCookie })).status, 401);
  const oldLogin = await request(env, '/api/auth/student', { method: 'POST', body: { studentId: codes[0].id, code: codes[0].code } });
  assert.equal(oldLogin.status, 401);
  const newCookie = await studentLogin(env, reset.codes[0]);
  const own = await request(env, '/api/student/me', { cookie: newCookie });
  assert.equal(own.status, 200);
  assert.equal((await own.json()).student.applicationVersion, 1);
  const historyAfter = await (await request(env, `/api/teacher/history?studentId=${codes[0].id}`, { cookie: teacher })).json();
  assert.deepEqual(historyAfter, historyBefore);
});

test('a request authenticated before code reset cannot finish a delayed submission after its session is revoked', async context => {
  const { env, teacher, codes } = await classroom(context);
  const cookie = await studentLogin(env, codes[0]);
  let authenticationFinished;
  const authenticated = new Promise(resolve => { authenticationFinished = resolve; });
  const originalPrepare = env.DB.prepare;
  env.DB.prepare = sql => {
    const wrap = statement => ({
      ...statement,
      bind: (...values) => wrap(statement.bind(...values)),
      first: async column => {
        const row = await statement.first(column);
        if (sql.includes('FROM sessions s LEFT JOIN students') && row?.role === 'student') authenticationFinished();
        return row;
      },
    });
    return wrap(originalPrepare(sql));
  };
  let bodyController;
  const body = new ReadableStream({ start(controller) { bodyController = controller; } });
  const pending = handlePortalRequest(new Request(`${origin}/api/student/application`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', cookie }, body, duplex: 'half',
  }), env);
  await authenticated;
  const state = await teacherState(env, teacher);
  await teacherAction(env, teacher, { action: 'reset-code', studentId: codes[0].id, revision: state.revision });
  const afterReset = await teacherState(env, teacher);
  const auditCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM operation_log').first('n');
  bodyController.enqueue(new TextEncoder().encode(JSON.stringify({ choices: ['paper', 'pen', 'writing'], version: 0 })));
  bodyController.close();
  const response = await pending;
  assert.equal(response.status, 409);
  assert.deepEqual(await teacherState(env, teacher), afterReset);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM operation_log').first('n'), auditCount);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM application_revisions WHERE student_id=?').bind(codes[0].id).first('n'), 0);
});

test('student codes and session tokens are stored as hashes and never appear in persistent audit payloads', async context => {
  const { env, teacher, codes } = await classroom(context);
  const student = await studentLogin(env, codes[0]);
  const rows = await env.DB.prepare('SELECT id, code_hash FROM students').all();
  for (const issued of codes) {
    const saved = rows.results.find(row => row.id === issued.id);
    assert.equal(saved.code_hash, await hashSecret(normalizeStudentCode(issued.code)));
    assert.notEqual(saved.code_hash, issued.code);
    assert.notEqual(saved.code_hash, normalizeStudentCode(issued.code));
  }
  const rawToken = student.split('=')[1];
  const sessions = await env.DB.prepare('SELECT * FROM sessions').all();
  const tokenHash = await hashSecret(rawToken);
  assert.ok(sessions.results.some(row => row.token_hash === tokenHash));
  const persistent = JSON.stringify({
    students: rows.results,
    sessions: sessions.results,
    audit: (await env.DB.prepare('SELECT * FROM operation_log').all()).results,
    rateLimits: (await env.DB.prepare('SELECT * FROM rate_limits').all()).results,
  });
  for (const secret of [password, rawToken, teacher.split('=')[1]]) assert.ok(!persistent.includes(secret));
  // A short numeric code can coincidentally be a substring of a timestamp/hash.
  for (const { code } of codes) assert.ok(!persistent.includes(JSON.stringify(code)));
  assert.notEqual(env.TEACHER_PASSWORD_HASH, password);
  assert.match(env.TEACHER_PASSWORD_HASH, /^pbkdf2-sha256\$/);
});

test('body byte limits, malformed JSON, unsupported methods and cross-site fetch metadata fail safely', async context => {
  const env = await fixture(context);
  const oversized = await request(env, '/api/auth/teacher', { method: 'POST', body: { password: '가'.repeat(90000) } });
  assert.equal(oversized.status, 413, 'limit must count UTF-8 bytes, not JavaScript characters');
  const malformed = await handlePortalRequest(new Request(`${origin}/api/auth/teacher`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{broken',
  }), env);
  assert.equal(malformed.status, 400);
  const crossSite = await request(env, '/api/auth/teacher', { method: 'POST', body: { password }, headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  const method = await request(env, '/api/teacher/state', { method: 'DELETE' });
  assert.equal(method.status, 405);
  assert.ok(!JSON.stringify(await malformed.json()).includes('SyntaxError'));
});

test('student account rate limits follow the student across IPs while other students sharing the school IP can sign in', async context => {
  const { env, codes } = await classroom(context);
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await request(env, '/api/auth/student', { method: 'POST', body: { studentId: codes[0].id, code: 'WRONG-WRONG-WRONG-WRONG' } });
    assert.equal(response.status, 401);
  }
  const limited = await request(env, '/api/auth/student', { method: 'POST', body: { studentId: codes[0].id, code: codes[0].code }, headers: { 'CF-Connecting-IP': '192.0.2.99' } });
  assert.equal(limited.status, 429);
  assert.ok(await studentLogin(env, codes[1]));
});

test('short code issuance retries stored and same-batch collisions and stops on exhausted retries', async context => {
  const { env, codes } = await classroom(context);
  await env.DB.prepare('UPDATE students SET code_hash=? WHERE id=?').bind(await hashSecret('K7M2'), codes[0].id).run();
  await env.DB.prepare('UPDATE students SET code_hash=? WHERE id=?').bind(await hashSecret('N8P3'), codes[1].id).run();
  await env.DB.prepare('UPDATE students SET code_hash=? WHERE id=?').bind(await hashSecret('P9Q4'), codes[2].id).run();
  const candidates = ['K7M2', 'N8P3', 'R2S5', 'R2S5', 'T6V8'];
  const issue = await createStudentCodeIssuer(env.DB, () => candidates.shift());
  assert.equal((await issue()).code, 'R2S5');
  assert.equal((await issue()).code, 'T6V8');
  const stuck = await createStudentCodeIssuer(env.DB, () => 'K7M2');
  await assert.rejects(stuck(), error => error.status === 503);
});

test('500 imported students receive distinct four-character codes and reissue also avoids duplicates', async context => {
  const env = await fixture(context);
  const teacher = await teacherLogin(env);
  const initial = await teacherState(env, teacher);
  const imported = await teacherAction(env, teacher, { action: 'import', revision: initial.revision,
    rows: Array.from({ length: 500 }, (_, i) => ({ grade: 5, classNo: Math.floor(i / 25) + 1, number: i % 25 + 1, name: `Student ${i + 1}`, gender: '' })),
  });
  assert.equal(imported.codes.length, 500);
  assert.equal(new Set(imported.codes.map(row => row.code)).size, 500);
  for (const row of imported.codes) assert.match(row.code, /^[A-HJ-NP-Z2-9]{4}$/);
  const reset = await teacherAction(env, teacher, { action: 'reset-code', studentId: imported.codes[0].id, revision: imported.state.revision });
  assert.match(reset.codes[0].code, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(!imported.codes.some(row => row.code === reset.codes[0].code));
  await studentLogin(env, { ...reset.codes[0], code: reset.codes[0].code.toLowerCase() });
});

test('previously issued long codes remain valid until replaced by a short code', async context => {
  const { env, teacher, codes } = await classroom(context);
  const legacy = { ...codes[0], code: 'ABCD-EFGH-JKLM-NPQR' };
  await env.DB.prepare('UPDATE students SET code_hash=? WHERE id=?').bind(await hashSecret(normalizeStudentCode(legacy.code)), legacy.id).run();
  const oldCookie = await studentLogin(env, legacy);
  const state = await teacherState(env, teacher);
  const reset = await teacherAction(env, teacher, { action: 'reset-code', studentId: legacy.id, revision: state.revision });
  assert.match(reset.codes[0].code, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.equal((await request(env, '/api/student/me', { cookie: oldCookie })).status, 401);
  assert.equal((await request(env, '/api/auth/student', { method: 'POST', body: { studentId: legacy.id, code: legacy.code } })).status, 401);
  await studentLogin(env, reset.codes[0]);
});
