import test from 'node:test';
import assert from 'node:assert/strict';
import { CLUBS, demoStudents, allocate, validate, moveStudent } from './allocation.ts';

const students=demoStudents();
const result=allocate(students,CLUBS,'CLUB-2026-01');
test('236 distinct students have three different valid preferences',()=>{
 assert.equal(students.length,236);assert.deepEqual(validate(students,CLUBS),[]);
 assert.equal(new Set(students.map(s=>s.id)).size,236);
});
test('no student is duplicated and club capacity is respected, including counsel',()=>{
 assert.equal(Object.keys(result.placements).length,236);
 for(const c of CLUBS)assert.ok(Object.values(result.placements).filter(p=>p.club===c.id).length<=c.max);
 assert.equal(CLUBS.find(c=>c.id==='counsel').max,8);
 const winners=result.rounds.flatMap(r=>r.winners);assert.equal(winners.length,new Set(winners).size);
});
test('assignments respect preferences and earlier choices have no vacancies when skipped',()=>{
 for(const s of students){const p=result.placements[s.id];if(p.club)assert.equal(p.club,s.choices[p.rank-1]);
  for(const cId of s.choices.slice(0,p.rank?p.rank-1:3)){
   const c=CLUBS.find(c=>c.id===cId);assert.equal(Object.values(result.placements).filter(p=>p.club===cId).length,c.max);
  }
 }
});
test('identical input and seed reproduce results, independent of sheet or club ordering',()=>{
 assert.deepEqual(allocate(students,CLUBS,'CLUB-2026-01'),result);
 assert.deepEqual(allocate([...students].reverse(),[...CLUBS].reverse(),'CLUB-2026-01').placements,result.placements);
 assert.notDeepEqual(allocate(students,CLUBS,'another-seed').placements,result.placements);
});
test('under minimum first choices are admitted without forcing unrelated students in',()=>{
 const tiny=students.slice(0,3).map(s=>({...s,choices:['paper','pen','writing']}));
 const r=allocate(tiny,CLUBS,'tiny');for(const p of Object.values(r.placements))assert.deepEqual(p,{club:'paper',rank:1});
});
test('second and third choices compete only for remaining seats; leftovers remain unassigned',()=>{
 const limited=CLUBS.map(c=>({...c,min:0,max:1}));
 const tiny=students.slice(0,4).map(s=>({...s,choices:['paper','pen','writing']}));
 const r=allocate(tiny,limited,'limited'),p=Object.values(r.placements);
 assert.equal(p.filter(p=>p.rank===1).length,1);assert.equal(p.filter(p=>p.rank===2).length,1);assert.equal(p.filter(p=>p.rank===3).length,1);assert.equal(p.filter(p=>!p.club).length,1);
});
test('invalid identity, duplicate preferences and invalid quotas stop allocation',()=>{
 assert.throws(()=>allocate([...students,students[0]],CLUBS,'s'));
 assert.throws(()=>allocate([{...students[0],choices:['paper','paper','pen']}],CLUBS,'s'));
 assert.throws(()=>allocate(students,CLUBS.map(c=>({...c,min:30,max:25})),'s'));
 assert.throws(()=>allocate(students,CLUBS,''));
});
test('manual adjustment requires reason, respects capacity and preserves original draw log',()=>{
 const s=students.find(s=>!result.placements[s.id].club);
 assert.ok(s,'demo includes students to review');
 const vacant=CLUBS.find(c=>Object.values(result.placements).filter(p=>p.club===c.id).length<c.max);
 const full=CLUBS.find(c=>Object.values(result.placements).filter(p=>p.club===c.id).length===c.max);
 assert.throws(()=>moveStudent(result,students,CLUBS,s.id,full.id,'reselection'));
 assert.throws(()=>moveStudent(result,students,CLUBS,s.id,vacant.id,''));
 const next=moveStudent(result,students,CLUBS,s.id,vacant.id,'student reselection');
 assert.equal(next.placements[s.id].club,vacant.id);assert.equal(next.placements[s.id].rank,0);
 assert.equal(result.placements[s.id].club,null);assert.deepEqual(next.rounds,result.rounds);
});
console.log(JSON.stringify({applicants:students.length,rankCounts:[1,2,3].map(rank=>Object.values(result.placements).filter(p=>p.rank===rank).length),unassigned:Object.values(result.placements).filter(p=>!p.club).length}));
