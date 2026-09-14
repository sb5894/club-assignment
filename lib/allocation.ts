export type Club = { id: string; name: string; category: string; min: number; max: number; allocationMode?: 'lottery' | 'fixed'; fixedStudentIds?: string[] };
export type Student = { id: string; grade: number; classNo: number; number: number; name: string; gender: string; choices: string[] };
export type Placement = { club: string | null; rank: number | null; reason?: string; assignmentType?: 'fixed' | 'manual' };
export type Round = { rank: number; club: string; candidates: string[]; winners: string[]; seats: number };
export type Result = { seed: string; placements: Record<string, Placement>; rounds: Round[]; completedRank?: number };
// Results saved before staged allocation already contain all three rounds.
export const completedRank = (result: Result | null) => result ? result.completedRank ?? 3 : 0;
export const CLUBS: Club[] = [
  ['badminton','배드민턴','스포츠'], ['dance','방송댄스','예술'], ['paper','종이공예','예술'],
  ['pen','펜드림','예술'], ['drawing','디지털드로잉','디지털'], ['maker','AI메이커','디지털'],
  ['writing','AI 문예창작','디지털'], ['media','미디어ON','미디어'], ['dodgeball','피구','스포츠'],
  ['teeball','티볼','스포츠'], ['language','이중언어','언어'], ['counsel','또래상담','소통'],
].map(([id,name,category])=>({id,name,category,min:id==='counsel'?6:15,max:id==='counsel'?8:25}));

function random(seed: string) {
  let a = 2166136261;
  for (const c of seed) a = Math.imul(a ^ c.charCodeAt(0), 16777619);
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function demoStudents(count = 236, seed = 'classroom-demo-236'): Student[] {
  if(!Number.isInteger(count)||count<0) throw new Error('가상학생 수는 0 이상의 정수로 입력해 주세요.');
  const rng = random(seed), studentsPerGrade = Math.ceil(count / 2);
  const weights = [25,9,5,5,11,13,4,6,23,9,4,7];
  const wheel = CLUBS.flatMap((c,i)=>Array(weights[i]).fill(c.id));
  return Array.from({length:count},(_,i)=>{
    const grade = i < studentsPerGrade ? 5 : 6, k = i % studentsPerGrade, classNo = Math.floor(k / 30)+1, number = k%30+1;
    const choices: string[] = [];
    while(choices.length<3) { const c=wheel[Math.floor(rng()*wheel.length)]; if(!choices.includes(c)) choices.push(c); }
    return {id:`${grade}-${classNo}-${number}`,grade,classNo,number,name:`가상학생 ${String(i+1).padStart(3,'0')}`,gender:rng()<0.5?'남':'여',choices};
  });
}
export function validate(students: Student[], clubs: Club[]): string[] {
  const errors: string[] = [], ids = new Set<string>(), clubIds = new Set(clubs.map(c=>c.id));
  const fixedIds = new Set(clubs.filter(c=>c.allocationMode==='fixed'&&Array.isArray(c.fixedStudentIds)).flatMap(c=>c.fixedStudentIds??[]));
  if(!clubs.length || clubIds.size!==clubs.length || clubs.some(c=>!c.id?.trim())) errors.push('동아리 설정을 확인해 주세요.');
  for(const c of clubs) if(!Number.isInteger(c.min)||!Number.isInteger(c.max)||c.min<0||c.max<1||c.min>c.max) errors.push(`${c.name}: 최소·최대 인원을 확인해 주세요.`);
  for(const s of students) {
    if(ids.has(s.id)) errors.push(`${s.id}: 중복 신청입니다.`); ids.add(s.id);
    if(!s.name?.trim()||![s.grade,s.classNo,s.number].every(v=>Number.isInteger(v)&&v>0)||s.id!==`${s.grade}-${s.classNo}-${s.number}`) errors.push('학생 정보를 확인해 주세요.');
    if(!(fixedIds.has(s.id)&&Array.isArray(s.choices)&&s.choices.length===0)&&(!Array.isArray(s.choices)||s.choices.length!==3||new Set(s.choices).size!==3||s.choices.some(c=>!clubIds.has(c)))) errors.push(`${s.id}: 서로 다른 동아리 3개를 선택해 주세요.`);
  }
  const fixedAssignments = new Map<string, string>();
  for(const club of clubs) {
    if(club.allocationMode!==undefined && club.allocationMode!=='lottery' && club.allocationMode!=='fixed') errors.push(`${club.name}: 배정 방식을 확인해 주세요.`);
    if(club.fixedStudentIds!==undefined && !Array.isArray(club.fixedStudentIds)) {
      errors.push(`${club.name}: 고정 명단을 확인해 주세요.`);
      continue;
    }
    const fixedIds = club.fixedStudentIds ?? [];
    if(club.allocationMode!=='fixed') {
      if(fixedIds.length) errors.push(`${club.name}: 추첨 동아리에는 고정 명단을 지정할 수 없습니다.`);
      continue;
    }
    if(fixedIds.length>club.max) errors.push(`${club.name}: 고정 명단이 최대 정원을 초과했습니다.`);
    const rosterIds = new Set<string>();
    for(const id of fixedIds) {
      if(!ids.has(id)) errors.push(`${club.name}: 고정 명단의 학생 ${id}를 찾을 수 없습니다.`);
      if(rosterIds.has(id)) errors.push(`${club.name}: 고정 명단에 ${id}가 중복되었습니다.`);
      else if(fixedAssignments.has(id)) errors.push(`${id}: 여러 동아리의 고정 명단에 포함되어 있습니다.`);
      rosterIds.add(id);
      fixedAssignments.set(id,club.id);
    }
  }
  return errors;
}
export function allocate(students: Student[], clubs: Club[], seed: string): Result {
  let result = allocateNext(students, clubs, seed);
  result = allocateNext(students, clubs, seed, result);
  return allocateNext(students, clubs, seed, result);
}
export function allocateNext(students: Student[], clubs: Club[], seed: string, previous: Result | null = null): Result {
  const errors=validate(students,clubs); if(errors.length) throw new Error(errors[0]);
  if(!seed.trim()) throw new Error('추첨 번호를 입력해 주세요.');
  const rank = completedRank(previous) + 1;
  if(rank > 3) throw new Error('3지망 배정까지 이미 완료했어요.');
  if(previous && previous.seed !== seed) throw new Error('처음 배정할 때 사용한 추첨 번호를 유지해 주세요.');
  const placements: Record<string,Placement> = previous ? {...previous.placements} : Object.fromEntries(students.map(s=>[s.id,{club:null,rank:null}]));
  if(!previous) for(const club of clubs.filter(c=>c.allocationMode==='fixed')) {
    for(const id of club.fixedStudentIds ?? []) placements[id]={club:club.id,rank:0,reason:'명단 고정',assignmentType:'fixed'};
  }
  const rounds: Round[]=[...(previous?.rounds ?? [])];
  for(const club of [...clubs].sort((a,b)=>a.id.localeCompare(b.id))) {
    const occupied=Object.values(placements).filter(p=>p.club===club.id).length, seats=club.max-occupied;
    const candidates=students.filter(s=>!placements[s.id].club&&s.choices[rank-1]===club.id).map(s=>s.id).sort();
    const ordered=[...candidates], rng=random(`${seed}|${rank}|${club.id}`);
    for(let i=ordered.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[ordered[i],ordered[j]]=[ordered[j],ordered[i]];}
    const winners=ordered.slice(0,Math.max(0,seats));
    for(const id of winners) placements[id]={club:club.id,rank};
    rounds.push({rank,club:club.id,candidates,winners,seats});
  }
  return {seed,placements,rounds,completedRank:rank};
}
export function applyFixedRoster(result: Result, before: Club[], after: Club[]): Result {
  const fixedMap = (clubs: Club[]) => new Map(clubs.filter(c=>c.allocationMode==='fixed').flatMap(c=>(c.fixedStudentIds??[]).map(id=>[id,c.id] as const)));
  const oldFixed = fixedMap(before), newFixed = fixedMap(after);
  const placements = {...result.placements};
  for(const id of new Set([...oldFixed.keys(), ...newFixed.keys()])) {
    if(oldFixed.get(id) === newFixed.get(id)) continue;
    const destination = newFixed.get(id);
    placements[id] = destination ? {club:destination,rank:0,reason:'명단 고정',assignmentType:'fixed'} : {club:null,rank:null,reason:'고정 해제'};
  }
  for(const club of after) if(Object.values(placements).filter(p=>p.club===club.id).length>club.max) throw new Error(`${club.name}: 기존 배정과 고정 명단을 합치면 최대 정원을 초과해요. 먼저 배정을 조정해 주세요.`);
  return {...result,placements};
}
export function moveStudent(result:Result, students:Student[], clubs:Club[], id:string, destination:string, reason:string): Result {
  if(!students.some(s=>s.id===id)||!result.placements[id]) throw new Error('학생을 찾을 수 없습니다.');
  if(!reason.trim()) throw new Error('조정 사유를 입력해 주세요.');
  const club=clubs.find(c=>c.id===destination); if(!club) throw new Error('동아리를 선택해 주세요.');
  const previous=result.placements[id];
  if(previous.assignmentType==='fixed'||clubs.some(c=>c.allocationMode==='fixed'&&c.fixedStudentIds?.includes(id))) throw new Error('고정 명단에 지정된 학생은 이동할 수 없습니다. 고정하지 않은 학생만 배정을 조정할 수 있어요.');
  if(previous.club===destination) throw new Error('현재 배정과 같은 동아리입니다.');
  if(Object.values(result.placements).filter(p=>p.club===destination).length>=club.max) throw new Error('선택한 동아리의 정원이 찼습니다.');
  return {...result,placements:{...result.placements,[id]:{club:destination,rank:0,reason:reason.trim(),assignmentType:'manual'}}};
}
