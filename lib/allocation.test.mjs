import test from 'node:test';
import assert from 'node:assert/strict';
import { CLUBS, demoStudents, allocate, allocateNext, allocateClub, clubRoundDone, applyFixedRoster, completedRank, validate, moveStudent } from './allocation.ts';

const students=demoStudents();
const result=allocate(students,CLUBS,'CLUB-2026-01');
test('per-club quotas reserve seats for later preferences and all second rounds must finish before third rounds',()=>{
 const clubs=CLUBS.filter(c=>['paper','pen','writing'].includes(c.id)).map(c=>({...c,min:0,max:c.id==='paper'?1:4}));
 const applicants=students.slice(0,6).map(s=>({...s,choices:['paper','pen','writing']}));
 const first=allocateNext(applicants,clubs,'quotas'),snapshot=structuredClone(first);
 let next=allocateClub(applicants,clubs,first,2,'pen',2);
 assert.equal(Object.values(next.placements).filter(p=>p.club==='pen').length,2);
 assert.equal(completedRank(next),1);
 assert.equal(clubRoundDone(next,2,'pen'),true);
 assert.throws(()=>allocateClub(applicants,clubs,next,2,'pen',1),/이미 처리/);
 assert.throws(()=>allocateClub(applicants,clubs,next,3,'writing',2),/모든 동아리/);
 assert.throws(()=>allocateNext(applicants,clubs,first.seed,next),/동아리별/);
 const occupied=structuredClone(next.placements);
 next=allocateClub(applicants,clubs,next,2,'paper',0);
 next=allocateClub(applicants,clubs,next,2,'writing',0);
 assert.equal(completedRank(next),2);
 assert.deepEqual(next.placements,occupied);
 next=allocateClub(applicants,clubs,next,3,'writing',1);
 assert.equal(completedRank(next),2);
 assert.equal(Object.values(next.placements).filter(p=>p.rank===3).length,1);
 next=allocateClub(applicants,clubs,next,3,'paper',0);
 next=allocateClub(applicants,clubs,next,3,'pen',0);
 assert.equal(completedRank(next),3);
 assert.equal(Object.values(next.placements).filter(p=>!p.club).length,2);
 assert.deepEqual(first,snapshot);
 assert.deepEqual(next.rounds.slice(0,clubs.length),first.rounds);
 for(const [id,p] of Object.entries(occupied)) if(p.club) assert.deepEqual(next.placements[id],p);
});
test('per-club draw counts reject invalid quotas and respect manual or fixed occupied seats',()=>{
 const clubs=CLUBS.map(c=>({...c,min:0,max:2}));
 const applicants=students.slice(0,5).map(s=>({...s,choices:['paper','pen','writing']}));
 const first=allocateNext(applicants,clubs,'count-validation');
 for(const count of [-1,0.5,3,NaN,Infinity,'1',null]) assert.throws(()=>allocateClub(applicants,clubs,first,2,'pen',count));
 assert.throws(()=>allocateClub(applicants,clubs,first,2,'unknown',0));
 assert.throws(()=>allocateClub(applicants,clubs,first,1,'pen',0));
 const waiting=applicants.find(s=>!first.placements[s.id].club);
 const adjusted=moveStudent(first,applicants,clubs,waiting.id,'pen','review');
 assert.throws(()=>allocateClub(applicants,clubs,adjusted,2,'pen',2));
 const next=allocateClub(applicants,clubs,adjusted,2,'pen',1);
 assert.deepEqual(next.placements[waiting.id],adjusted.placements[waiting.id]);
 assert.equal(Object.values(next.placements).filter(p=>p.club==='pen').length,2);
});
test('per-club draw order within a preference preserves lottery outcomes and existing full results are locked',()=>{
 const first=allocateNext(students,CLUBS,'club-order');
 const run=clubs=>{
   let next=first;
   for(const rank of [2,3]) for(const club of clubs) {
     const seats=club.max-Object.values(next.placements).filter(p=>p.club===club.id).length;
     next=allocateClub(students,CLUBS,next,rank,club.id,seats);
   }
   return next;
 };
 const forward=run(CLUBS),reverse=run([...CLUBS].reverse());
 assert.deepEqual(forward.placements,reverse.placements);
 assert.deepEqual(forward.placements,allocate(students,CLUBS,first.seed).placements);
 const legacy={...forward};delete legacy.completedRank;
 assert.throws(()=>allocateClub(students,CLUBS,legacy,2,'paper',0));
 assert.throws(()=>allocateClub(students,CLUBS,legacy,3,'paper',0));
});
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

test('staged draws match the original full draw and never mutate an earlier result',()=>{
 const first=allocateNext(students,CLUBS,'CLUB-2026-01'), snapshot=structuredClone(first);
 assert.equal(completedRank(first),1);
 assert.ok(first.rounds.every(r=>r.rank===1));
 assert.ok(Object.values(first.placements).every(p=>p.rank===null||p.rank===1));
 const second=allocateNext(students,CLUBS,first.seed,first);
 const third=allocateNext(students,CLUBS,first.seed,second);
 assert.deepEqual(first,snapshot);
 assert.deepEqual(third,result);
 assert.throws(()=>allocateNext(students,CLUBS,first.seed,third));
 assert.throws(()=>allocateNext(students,CLUBS,'changed-seed',first));
 const legacy={seed:result.seed,placements:result.placements,rounds:result.rounds};
 assert.equal(completedRank(legacy),3);
 assert.throws(()=>allocateNext(students,CLUBS,legacy.seed,legacy));
});

test('later draws preserve manual adjustments and count their occupied seats',()=>{
 const clubs=CLUBS.map(c=>({...c,min:0,max:1}));
 const applicants=students.slice(0,5).map(s=>({...s,choices:['paper','pen','writing']}));
 const first=allocateNext(applicants,clubs,'staged');
 const waiting=applicants.filter(s=>!first.placements[s.id].club);
 const adjusted=moveStudent(first,applicants,clubs,waiting[0].id,'pen','teacher review');
 const second=allocateNext(applicants,clubs,first.seed,adjusted);
 assert.deepEqual(second.placements[waiting[0].id],adjusted.placements[waiting[0].id]);
 assert.equal(second.rounds.find(r=>r.rank===2&&r.club==='pen').seats,0);
 const third=allocateNext(applicants,clubs,first.seed,second);
 assert.equal(Object.values(third.placements).filter(p=>p.rank===3).length,1);
 assert.deepEqual(third.rounds.slice(0,clubs.length),first.rounds);
});

test('fixed roster edits change only affected placements, preserve logs, and reject occupied capacity overflow',()=>{
 const clubs=CLUBS.map(c=>({...c,min:0,max:1}));
 const applicants=students.slice(0,4).map(s=>({...s,choices:['paper','pen','writing']}));
 const first=allocateNext(applicants,clubs,'fixed-change'),snapshot=structuredClone(first);
 const winner=applicants.find(s=>first.placements[s.id].club);
 const waiting=applicants.find(s=>!first.placements[s.id].club);
 const full=clubs.map(c=>c.id==='paper'?{...c,allocationMode:'fixed',fixedStudentIds:[waiting.id]}:c);
 assert.throws(()=>applyFixedRoster(first,clubs,full),/최대 정원/);
 const fixed=clubs.map(c=>c.id==='pen'?{...c,allocationMode:'fixed',fixedStudentIds:[winner.id]}:c);
 const changed=applyFixedRoster(first,clubs,fixed);
 assert.equal(changed.placements[winner.id].club,'pen');
 assert.equal(changed.placements[winner.id].assignmentType,'fixed');
 assert.deepEqual(first,snapshot);
 assert.deepEqual(changed.rounds,first.rounds);
 const released=applyFixedRoster(changed,fixed,clubs);
 assert.equal(released.placements[winner.id].club,null);
 const second=allocateNext(applicants,clubs,first.seed,released);
 assert.ok(second.rounds.find(r=>r.rank===2&&r.club==='pen').candidates.includes(winner.id));
 assert.equal(Object.values(second.placements).filter(p=>p.club==='paper').length,0,'past preferences are never rerun');
});
