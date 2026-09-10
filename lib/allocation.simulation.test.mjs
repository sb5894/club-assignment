import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { CLUBS, demoStudents, allocate, validate, moveStudent } from './allocation.ts';

const simulations = [];
const checks = [];
const isFixed = club => club.allocationMode === 'fixed';
const copyClubs = () => CLUBS.map(club => ({ ...club }));
const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function audit(name, run) {
  test(name, () => {
    try {
      run();
      checks.push({ name, passed: true });
    } catch (error) {
      checks.push({ name, passed: false, error: error.message });
      throw error;
    }
  });
}

// A separate deterministic generator varies inputs; it does not duplicate the draw algorithm.
function inputRandom(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function shuffled(items, seed) {
  const result = [...items], random = inputRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function scenario(index) {
  const seed = `250-students-case-${String(index + 1).padStart(2, '0')}`;
  let students = demoStudents(250, `${seed}-students`);
  let clubs = copyClubs();
  if (index === 1 || index === 6) {
    students = students.map((student, i) => ({
      ...student, choices: [0, 1, 2].map(offset => clubs[(i + offset * 3) % clubs.length].id),
    }));
  } else if (index === 2 || index === 8) {
    students = students.map(student => ({ ...student, choices: ['badminton', 'dance', 'dodgeball'] }));
  } else if (index === 3 || index === 9) {
    students = students.map((student, i) => ({
      ...student, choices: shuffled(clubs.map(club => club.id), 4000 + index * 250 + i).slice(0, 3),
    }));
    clubs = clubs.map((club, i) => ({ ...club, min: 0, max: index === 3 ? 5 + i : 18 + i % 5 }));
  }
  if (index >= 4) {
    const fixedConfigs = index === 4 ? [['counsel', 8]]
      : index === 5 ? [['counsel', 6], ['paper', 12]]
      : index === 6 ? [['dance', 0], ['maker', 15]]
      : index === 7 ? [['counsel', 8], ['badminton', 25], ['language', 10]]
      : index === 8 ? [['badminton', 25], ['counsel', 0]]
      : [['counsel', 7], ['dance', 13], ['writing', 5]];
    const selected = shuffled(students, 901 + index);
    let cursor = 0;
    for (const [id, count] of fixedConfigs) {
      const club = clubs.find(club => club.id === id);
      club.allocationMode = 'fixed';
      club.fixedStudentIds = selected.slice(cursor, cursor + count).map(student => student.id);
      cursor += count;
    }
  }
  return { seed, students, clubs };
}

function inspect(students, clubs, result) {
  const roster = new Map();
  const assigned = new Map();
  const byId = new Map(students.map(student => [student.id, student]));
  assert.equal(students.length, 250);
  assert.equal(byId.size, 250);
  assert.deepEqual(Object.keys(result.placements).sort(compareIds), [...byId.keys()].sort(compareIds));
  assert.deepEqual(validate(students, clubs), []);
  for (const club of clubs) {
    if (!isFixed(club)) continue;
    const ids = [...(club.fixedStudentIds ?? [])].sort(compareIds);
    roster.set(club.id, ids);
    const actual = Object.entries(result.placements).filter(([, placement]) => placement.club === club.id).map(([id]) => id).sort(compareIds);
    assert.deepEqual(actual, ids, `${club.id}: fixed roster is exact`);
    for (const id of ids) {
      assert.ok(!assigned.has(id), 'fixed rosters do not overlap');
      assigned.set(id, club.id);
      assert.equal(result.placements[id].assignmentType, 'fixed');
      assert.equal(result.placements[id].rank, 0);
    }
  }
  const lotteryClubs = clubs.filter(club => !isFixed(club)).sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(result.rounds.length, lotteryClubs.length * 3);
  let roundIndex = 0;
  for (let rank = 1; rank <= 3; rank++) {
    for (const club of lotteryClubs) {
      const round = result.rounds[roundIndex++];
      assert.equal(round.rank, rank);
      assert.equal(round.club, club.id);
      const occupied = [...assigned.values()].filter(id => id === club.id).length;
      const expectedSeats = club.max - occupied;
      const expectedCandidates = students.filter(student => !assigned.has(student.id) && student.choices[rank - 1] === club.id).map(student => student.id).sort(compareIds);
      assert.equal(round.seats, expectedSeats);
      assert.deepEqual(round.candidates, expectedCandidates, `${club.id}, rank ${rank}: eligible candidates`);
      assert.equal(new Set(round.winners).size, round.winners.length);
      assert.equal(round.winners.length, Math.min(expectedCandidates.length, expectedSeats));
      for (const id of round.winners) {
        assert.ok(expectedCandidates.includes(id));
        assert.ok(!assigned.has(id), `${id}: student only wins once`);
        assigned.set(id, club.id);
        assert.equal(result.placements[id].club, club.id);
        assert.equal(result.placements[id].rank, rank);
        assert.notEqual(result.placements[id].assignmentType, 'fixed');
      }
    }
  }
  const occupancy = Object.fromEntries(clubs.map(club => [club.id, Object.values(result.placements).filter(placement => placement.club === club.id).length]));
  for (const club of clubs) assert.ok(occupancy[club.id] <= club.max, `${club.id}: capacity respected`);
  for (const student of students) {
    const placement = result.placements[student.id];
    if (!assigned.has(student.id)) {
      assert.equal(placement.club, null);
      assert.equal(placement.rank, null);
    } else assert.equal(placement.club, assigned.get(student.id));
    if (placement.assignmentType === 'fixed') continue;
    if (placement.club) assert.equal(student.choices[placement.rank - 1], placement.club);
    const skippedChoices = student.choices.slice(0, placement.club ? placement.rank - 1 : 3);
    for (const id of skippedChoices) {
      const club = clubs.find(club => club.id === id);
      if (!isFixed(club)) assert.equal(occupancy[id], club.max, `${student.id}: skipped preference has no remaining seats`);
    }
  }
  const rankCounts = [1, 2, 3].map(rank => Object.values(result.placements).filter(placement => placement.rank === rank).length);
  const fixed = [...roster.values()].reduce((sum, ids) => sum + ids.length, 0);
  const unassigned = Object.values(result.placements).filter(placement => !placement.club).length;
  assert.equal(fixed + rankCounts.reduce((sum, count) => sum + count, 0) + unassigned, 250);
  return { applicants: 250, fixed, rankCounts, unassigned, occupancy, fixedRosters: Object.fromEntries(roster) };
}

for (let index = 0; index < 10; index++) {
  audit(`simulation ${index + 1}: 250 students, exact rosters, lottery eligibility, quotas and replay`, () => {
    const { seed, students, clubs } = scenario(index);
    const original = JSON.stringify({ students, clubs });
    const result = allocate(students, clubs, seed);
    const summary = inspect(students, clubs, result);
    assert.deepEqual(allocate(students, clubs, seed), result, 'same seed reproduces the full draw');
    assert.deepEqual(allocate(shuffled(students, 712 + index), shuffled(clubs, 987 + index), seed), result, 'input order cannot change the draw');
    const alternate = allocate(students, clubs, `${seed}-alternative`);
    inspect(students, clubs, alternate);
    for (const club of clubs.filter(isFixed)) {
      const idsFor = draw => Object.entries(draw.placements).filter(([, placement]) => placement.club === club.id).map(([id]) => id).sort(compareIds);
      assert.deepEqual(idsFor(alternate), idsFor(result), 'fixed roster survives a changed draw seed');
    }
    assert.equal(JSON.stringify({ students, clubs }), original, 'allocation does not mutate inputs');
    simulations.push({ run: index + 1, seed, ...summary, passed: true });
  });
}

function fixture() {
  const students = demoStudents(12, 'validation-fixture').map(student => ({ ...student, choices: ['paper', 'pen', 'writing'] }));
  const clubs = copyClubs();
  clubs.find(club => club.id === 'counsel').allocationMode = 'fixed';
  clubs.find(club => club.id === 'counsel').fixedStudentIds = [students[0].id, students[1].id];
  return { students, clubs };
}

audit('new valid applications remain valid alongside existing fixed rosters', () => {
  const { students, clubs } = fixture();
  const newStudent = { id: '6-5-1', grade: 6, classNo: 5, number: 1, name: 'Additional Student', gender: '남', choices: ['paper', 'pen', 'writing'] };
  assert.deepEqual(validate([...students, newStudent], clubs), []);
  const result = allocate([...students, newStudent], clubs, 'new-application-fixed-roster');
  assert.equal(result.placements[newStudent.id].club, 'paper');
  assert.equal(result.placements[students[0].id].assignmentType, 'fixed');
  assert.equal(result.placements[students[1].id].assignmentType, 'fixed');
});

audit('fixed roster validation rejects duplicate, unknown and overcapacity members', () => {
  for (const mutate of [
    ({ students, clubs }) => { clubs.find(club => club.id === 'counsel').fixedStudentIds = [students[0].id, students[0].id]; },
    ({ clubs }) => { clubs.find(club => club.id === 'counsel').fixedStudentIds = ['6-99-99']; },
    ({ students, clubs }) => { clubs.find(club => club.id === 'counsel').fixedStudentIds = students.slice(0, 9).map(student => student.id); },
    ({ students, clubs }) => { Object.assign(clubs.find(club => club.id === 'paper'), { allocationMode: 'fixed', fixedStudentIds: [students[0].id] }); },
  ]) {
    const data = fixture();
    mutate(data);
    assert.ok(validate(data.students, data.clubs).length > 0);
    assert.throws(() => allocate(data.students, data.clubs, 'invalid-roster'));
  }
});

audit('empty fixed club cannot admit students through any lottery round', () => {
  const { students, clubs } = fixture();
  Object.assign(clubs.find(club => club.id === 'paper'), { allocationMode: 'fixed', fixedStudentIds: [] });
  const result = allocate(students, clubs, 'empty-fixed');
  assert.ok(result.rounds.every(round => round.club !== 'paper' && round.club !== 'counsel'));
  assert.ok(Object.values(result.placements).every(placement => placement.club !== 'paper'));
  for (const student of students.slice(2)) assert.deepEqual(result.placements[student.id], { club: 'pen', rank: 2 });
});

audit('manual moves reject fixed sources and destinations and preserve the draw log', () => {
  const { students, clubs } = fixture();
  const result = allocate(students, clubs, 'manual-fixed');
  const snapshot = JSON.stringify(result);
  assert.throws(() => moveStudent(result, students, clubs, students[0].id, 'pen', 'move fixed member'));
  assert.throws(() => moveStudent(result, students, clubs, students[2].id, 'counsel', 'move into fixed club'));
  assert.throws(() => moveStudent(result, students, clubs, students[2].id, 'pen', '  '));
  assert.throws(() => moveStudent(result, students, clubs, '6-99-99', 'pen', 'unknown student'));
  assert.throws(() => moveStudent(result, students, clubs, students[2].id, 'unknown-club', 'unknown club'));
  const moved = moveStudent(result, students, clubs, students[2].id, 'pen', '  student reselection  ');
  assert.equal(moved.placements[students[2].id].club, 'pen');
  assert.equal(moved.placements[students[2].id].rank, 0);
  assert.equal(moved.placements[students[2].id].assignmentType, 'manual');
  assert.equal(moved.placements[students[2].id].reason, 'student reselection');
  assert.deepEqual(moved.rounds, result.rounds);
  assert.equal(JSON.stringify(result), snapshot);
  const tightClubs = clubs.map(club => club.id === 'pen' ? { ...club, min: 0, max: 1 } : club);
  assert.throws(() => moveStudent(moved, students, tightClubs, students[3].id, 'pen', 'full club'));
});

audit('invalid identities, preferences, modes, capacities and seeds stop allocation', () => {
  const { students, clubs } = fixture();
  for (const invalidClubs of [
    [], [...clubs, clubs[0]],
    clubs.map((club, index) => index ? club : { ...club, min: -1 }),
    clubs.map((club, index) => index ? club : { ...club, min: 26, max: 25 }),
    clubs.map((club, index) => index ? club : { ...club, min: 0, max: 0 }),
    clubs.map((club, index) => index ? club : { ...club, max: 25.5 }),
    clubs.map((club, index) => index ? club : { ...club, allocationMode: 'unknown' }),
  ]) assert.throws(() => allocate(students, invalidClubs, 'invalid-settings'));
  assert.throws(() => allocate([...students, students[0]], clubs, 'duplicate'));
  assert.throws(() => allocate(students.map((student, i) => i ? student : { ...student, id: 'wrong-id' }), clubs, 'identity'));
  assert.throws(() => allocate(students.map((student, i) => i ? student : { ...student, choices: ['paper', 'paper', 'pen'] }), clubs, 'preferences'));
  assert.throws(() => allocate(students, clubs, '   '));
});

audit('virtual student generation is seeded, repeatable and supports 250 unique students', () => {
  const students = demoStudents(250, 'generator-one');
  assert.equal(students.length, 250);
  assert.equal(new Set(students.map(student => student.id)).size, 250);
  assert.deepEqual(validate(students, CLUBS), []);
  assert.deepEqual(demoStudents(250, 'generator-one'), students);
  assert.notDeepEqual(demoStudents(250, 'generator-two'), students);
  assert.equal(demoStudents().length, 236);
});

after(async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    command: 'node --test lib/allocation.test.mjs lib/allocation.simulation.test.mjs',
    passed: checks.length === 16 && checks.every(check => check.passed) && simulations.length === 10,
    requestedSimulationRuns: 10,
    completedSimulationRuns: simulations.length,
    virtualStudentsPerRun: 250,
    totalPrimarySimulationStudents: simulations.reduce((sum, simulation) => sum + simulation.applicants, 0),
    additionalChecks: 'Each primary run is repeated with the same seed, permuted student/club input, and an alternative seed; both draw outcomes receive full invariant checks.',
    checks,
    simulations,
  };
  await mkdir(new URL('../work/', import.meta.url), { recursive: true });
  await writeFile(new URL('../work/allocation-validation.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
});
