import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CLUBS } from './allocation.ts';
import { studentClubs, studentClubName, studentClubDescription } from './student-clubs.ts';
import { studentRussian, studentText, studentError, preferenceLabel } from './student-i18n.ts';

test('every selectable club has a sourced one-sentence description and bilingual Russian name', () => {
  assert.deepEqual(Object.keys(studentClubs).sort(), CLUBS.map(club => club.id).sort());
  const original = JSON.stringify(CLUBS);
  for (const club of CLUBS) {
    const copy = studentClubs[club.id];
    assert(copy.slides.length > 0 || copy.source, club.id);
    for (const language of ['ko', 'ru']) {
      const description = studentClubDescription(club.id, language);
      assert.equal(description.split(/[.!?]/u).filter(part => part.trim()).length, 1, club.id);
    }
    assert.match(copy.ru, /[А-Яа-яЁё]/u);
    assert.equal(studentClubName(club, 'ko'), club.name);
    assert.equal(studentClubName(club, 'ru'), `${copy.name} (${club.name})`);
  }
  assert.equal(JSON.stringify(CLUBS), original, 'Presentation must never mutate allocation data');
});

test('all static Korean messages in the student component have Russian translations', () => {
  const source = readFileSync(new URL('../components/student-portal.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('student-portal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const missing = [];
  function visit(node) {
    if (ts.isStringLiteral(node) && /[가-힣]/u.test(node.text) && node.text !== '언어 / Язык') {
      if (!studentRussian[node.text]) missing.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual(missing, []);
  for (const club of CLUBS) assert(studentRussian[club.category]);
});

test('unknown clubs remain usable and untranslated failures have a Russian recovery message', () => {
  assert.equal(studentClubName({id:'new-club',name:'새 동아리'},'ru'), '새 동아리');
  assert.match(studentClubDescription('new-club','ru'), /учителя/u);
  assert.equal(studentError('Unexpected network error','ru'), studentRussian['잠시 후 다시 시도해 주세요.']);
  assert.equal(studentText('로그아웃','ko'),'로그아웃');
  assert.equal(studentError('신청 코드로 다시 로그인해 주세요.','ru'),'Войди ещё раз со своим кодом.');
  assert.equal(preferenceLabel(1,'ru'),'1-е место');
  assert.equal(preferenceLabel(3,'ko'),'3지망');
});
