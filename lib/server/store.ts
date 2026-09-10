import { CLUBS, allocate, moveStudent, validate, type Club, type Result } from '../allocation.ts';
import type { ApplicationRevision, Phase, PortalState, RosterInput, RosterStudent, StudentState } from '../portal-types.ts';
import { StoreError, type SchoolRow, type StudentRow, type AuditEntry } from './store-types.ts';
export { StoreError } from './store-types.ts';

const studentSelect=`SELECT s.id,s.grade,s.class_no,s.number,s.name,s.gender,a.choices_json,a.version,a.submitted_at,a.verified_at,a.verified_version FROM students s LEFT JOIN applications a ON a.student_id=s.id`;
const now=()=>new Date().toISOString();
const conflict=()=>new StoreError('다른 화면에서 자료가 변경되었어요. 새로고침한 뒤 다시 시도해 주세요.',409);
const rosterStudent=(s:StudentRow):RosterStudent=>({id:s.id,grade:s.grade,classNo:s.class_no,number:s.number,name:s.name,gender:s.gender,choices:s.choices_json?JSON.parse(s.choices_json):[],submittedAt:s.submitted_at,applicationVersion:s.version??0,verifiedAt:s.verified_at,verifiedVersion:s.verified_version});
async function initialize(db:D1Database) {
  await db.prepare('INSERT INTO school_state (id,phase,revision,clubs_json,updated_at) VALUES (1,\'setup\',0,?,?) ON CONFLICT(id) DO NOTHING').bind(JSON.stringify(CLUBS),now()).run();
}
export async function getTeacherState(db:D1Database):Promise<PortalState> {
  await initialize(db);
  const rows=await db.batch([db.prepare('SELECT * FROM school_state WHERE id=1'),db.prepare(studentSelect+' ORDER BY s.grade,s.class_no,s.number')]);
  const school=rows[0].results[0] as SchoolRow;
  return {phase:school.phase,revision:school.revision,clubs:JSON.parse(school.clubs_json),students:(rows[1].results as StudentRow[]).map(rosterStudent),result:school.result_json?JSON.parse(school.result_json):null};
}
export async function getStudentState(db:D1Database,id:string):Promise<StudentState> {
  await initialize(db);
  const rows=await db.batch([db.prepare('SELECT * FROM school_state WHERE id=1'),db.prepare(studentSelect+' WHERE s.id=?').bind(id)]);
  const school=rows[0].results[0] as SchoolRow, row=rows[1].results[0] as StudentRow|undefined;
  if(!row) throw new StoreError('학생을 찾을 수 없습니다.',404);
  const clubs:Club[]=JSON.parse(school.clubs_json), result:Result|null=school.result_json?JSON.parse(school.result_json):null;
  return {phase:school.phase,clubs:clubs.map(({fixedStudentIds:_,...club})=>club),student:rosterStudent(row),placement:school.phase==='final'?(result?.placements[id]??null):null};
}
type Mutation = { revision?:number; phases:Phase[]; action:string; actor:string; payload:unknown; phase?:Phase; clubs?:Club[]; result?:Result; guard?:string; guardBinds?:unknown[]; statements?:(operationId:string)=>D1PreparedStatement[] };
async function mutate(db:D1Database,m:Mutation) {
  if(m.revision!==undefined&&(!Number.isInteger(m.revision)||m.revision<0)) throw conflict();
  const operationId=crypto.randomUUID(), timestamp=now();
  const sets=['revision=revision+1','last_operation_id=?','updated_at=?']; const binds:unknown[]=[operationId,timestamp];
  if(m.phase){sets.push('phase=?');binds.push(m.phase);}
  if(m.clubs){sets.push('clubs_json=?');binds.push(JSON.stringify(m.clubs));}
  if(m.result){sets.push('result_json=?');binds.push(JSON.stringify(m.result));}
  if(m.revision!==undefined) binds.push(m.revision);
  binds.push(...m.phases,...(m.guardBinds??[]));
  const update=db.prepare(`UPDATE school_state SET ${sets.join(',')} WHERE id=1 ${m.revision!==undefined?'AND revision=?':''} AND phase IN (${m.phases.map(()=>'?').join(',')}) ${m.guard?'AND ('+m.guard+')':''}`).bind(...binds);
  const log=db.prepare('INSERT INTO operation_log(action,actor,payload_json,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM school_state WHERE id=1 AND last_operation_id=?)').bind(m.action,m.actor,JSON.stringify(m.payload),timestamp,operationId);
  let results:D1Result[];
  try { results=await db.batch([update,...(m.statements?.(operationId)??[]),log]); }
  catch(error) { if(String(error).includes('UNIQUE constraint')) throw new StoreError('학생 번호 또는 접속 코드가 중복되어 저장하지 않았어요.',409); throw error; }
  if(results[0].meta.changes!==1) throw conflict();
}
const operationGuard='EXISTS(SELECT 1 FROM school_state WHERE id=1 AND last_operation_id=?)';
type StudentMutationAuth = { tokenHash:string };
function studentSessionGuard(id:string,auth?:StudentMutationAuth) {
  if(!auth) return {sql:'',binds:[] as unknown[]};
  // Evaluate credentials in the same atomic write as the application. A code reset
  // or logout during body streaming must invalidate this request as well.
  return {sql:" AND EXISTS(SELECT 1 FROM sessions session JOIN students student ON student.id=session.student_id WHERE session.token_hash=? AND session.student_id=? AND session.role='student' AND session.expires_at>? AND session.credential_version=CAST(student.code_version AS TEXT))",binds:[auth.tokenHash,id,Date.now()]};
}
function requirePhase(state:PortalState,phases:Phase[]) { if(!phases.includes(state.phase)) throw new StoreError('현재 단계에서는 이 작업을 할 수 없습니다.',409); }
function requireRevision(state:PortalState,revision:number) { if(state.revision!==revision) throw conflict(); }
function validateClubs(clubs:Club[],students:RosterStudent[]) {
  if(!Array.isArray(clubs)||clubs.length<3||clubs.length>100||clubs.some(c=>!c||typeof c.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>100||typeof c.category!=='string'||c.category.length>100||c.max>999)) throw new StoreError('동아리 설정을 확인해 주세요. 동아리는 3개 이상이어야 합니다.');
  const errors=validate(students.map(s=>({...s,choices:s.choices.length?s.choices:clubs.slice(0,3).map(c=>c.id)})),clubs);
  if(errors.length) throw new StoreError(errors[0]);
}
export async function submitApplication(db:D1Database,id:string,choices:string[],expectedVersion:number,auth?:StudentMutationAuth):Promise<StudentState> {
  const state=await getTeacherState(db); requirePhase(state,['open']);
  const student=state.students.find(s=>s.id===id); if(!student) throw new StoreError('학생을 찾을 수 없습니다.',404);
  if(!Number.isInteger(expectedVersion)||student.applicationVersion!==expectedVersion) throw conflict();
  if(!Array.isArray(choices)||choices.length!==3||new Set(choices).size!==3||choices.some(id=>typeof id!=='string'||!state.clubs.some(c=>c.id===id))) throw new StoreError('서로 다른 동아리 3개를 선택해 주세요.');
  const timestamp=now(),version=expectedVersion+1;
  const session=studentSessionGuard(id,auth);
  await mutate(db,{phases:['open'],action:expectedVersion?'application.update':'application.submit',actor:id,payload:{studentId:id,version},guard:"EXISTS(SELECT 1 FROM students WHERE id=?) AND COALESCE((SELECT version FROM applications WHERE student_id=?),0)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) choice WHERE NOT EXISTS(SELECT 1 FROM json_each(school_state.clubs_json) club WHERE json_extract(club.value,'$.id')=choice.value))"+session.sql,guardBinds:[id,id,expectedVersion,JSON.stringify(choices),...session.binds],statements:op=>[
    db.prepare(`INSERT INTO applications(student_id,choices_json,version,submitted_at,verified_at,verified_version) SELECT ?,?,?,?,NULL,NULL WHERE ${operationGuard} AND EXISTS(SELECT 1 FROM school_state WHERE id=1 AND phase='open') ON CONFLICT(student_id) DO UPDATE SET choices_json=excluded.choices_json,version=excluded.version,submitted_at=excluded.submitted_at,verified_at=NULL,verified_version=NULL WHERE applications.version=?`).bind(id,JSON.stringify(choices),version,timestamp,op,expectedVersion),
  ]});
  return getStudentState(db,id);
}
export async function verifyApplication(db:D1Database,id:string,version:number,auth?:StudentMutationAuth):Promise<StudentState> {
  const state=await getTeacherState(db); requirePhase(state,['open','closed']);
  const student=state.students.find(s=>s.id===id); if(!student) throw new StoreError('학생을 찾을 수 없습니다.',404);
  if(!Number.isInteger(version)||version<1||student.applicationVersion!==version) throw conflict();
  const session=studentSessionGuard(id,auth);
  await mutate(db,{phases:['open','closed'],action:'application.verify',actor:id,payload:{studentId:id,version},guard:'EXISTS(SELECT 1 FROM applications WHERE student_id=? AND version=?)'+session.sql,guardBinds:[id,version,...session.binds],statements:op=>[
    db.prepare(`UPDATE applications SET verified_at=?,verified_version=? WHERE student_id=? AND version=? AND ${operationGuard} AND EXISTS(SELECT 1 FROM school_state WHERE id=1 AND phase IN ('open','closed'))`).bind(now(),version,id,version,op),
  ]});return getStudentState(db,id);
}
export async function importStudents(db:D1Database,rows:(RosterInput&{codeHash:string})[],expectedRevision:number,actor:string):Promise<{id:string;name:string}[]> {
  const state=await getTeacherState(db);requirePhase(state,['setup','open']);requireRevision(state,expectedRevision);
  if(!Array.isArray(rows)||!rows.length||rows.length>1000||state.students.length+rows.length>5000) throw new StoreError('한 번에 1~1,000명, 전체 최대 5,000명까지 등록할 수 있어요.');
  const ids=new Set(state.students.map(s=>s.id)),hashes=new Set<string>();
  const prepared=rows.map(row=>{
    if(!row||![row.grade,row.classNo,row.number].every(v=>Number.isInteger(v)&&v>0&&v<=99)||typeof row.name!=='string'||!row.name.trim()||row.name.length>80||typeof row.gender!=='string'||row.gender.length>20||typeof row.codeHash!=='string'||!row.codeHash||row.codeHash.length>256) throw new StoreError('학생 정보 또는 접속 코드를 확인해 주세요.');
    const id=`${row.grade}-${row.classNo}-${row.number}`;if(ids.has(id)||hashes.has(row.codeHash)) throw new StoreError('중복 학생 또는 접속 코드가 있어 전체 명단을 저장하지 않았어요.',409);ids.add(id);hashes.add(row.codeHash);return {...row,id,name:row.name.trim()};
  });
  await mutate(db,{revision:expectedRevision,phases:['setup','open'],action:'roster.import',actor,payload:{studentIds:prepared.map(s=>s.id)},statements:op=>{
    const statements:D1PreparedStatement[]=[];
    // One JSON bind per chunk keeps each statement below D1's parameter limit.
    for(let offset=0;offset<prepared.length;offset+=100) statements.push(db.prepare(`INSERT INTO students(id,grade,class_no,number,name,gender,code_hash,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.grade'),json_extract(value,'$.classNo'),json_extract(value,'$.number'),json_extract(value,'$.name'),json_extract(value,'$.gender'),json_extract(value,'$.codeHash'),? FROM json_each(?) WHERE ${operationGuard}`).bind(now(),JSON.stringify(prepared.slice(offset,offset+100)),op));
    return statements;
  }});return prepared.map(({id,name})=>({id,name}));
}
export async function updateClubs(db:D1Database,clubs:Club[],expectedRevision:number,actor:string):Promise<PortalState> {
  const state=await getTeacherState(db);requirePhase(state,['setup','open']);requireRevision(state,expectedRevision);validateClubs(clubs,state.students);
  await mutate(db,{revision:expectedRevision,phases:['setup','open'],action:'clubs.update',actor,payload:{clubs},clubs});return getTeacherState(db);
}
export async function changePhase(db:D1Database,phase:'open'|'closed',expectedRevision:number,actor:string):Promise<PortalState> {
  const state=await getTeacherState(db);requireRevision(state,expectedRevision);
  if(phase!=='open'&&phase!=='closed') throw new StoreError('접수 단계를 확인해 주세요.');
  const allowed:Phase[]=phase==='open'?['setup','closed']:['open'];requirePhase(state,allowed);validateClubs(state.clubs,state.students);
  await mutate(db,{revision:expectedRevision,phases:allowed,action:'phase.'+phase,actor,payload:{from:state.phase,to:phase},phase});return getTeacherState(db);
}
export async function runAllocation(db:D1Database,seed:string,expectedRevision:number,actor:string):Promise<PortalState> {
  const state=await getTeacherState(db);requirePhase(state,['closed']);requireRevision(state,expectedRevision);
  if(typeof seed!=='string'||!seed.trim()||seed.length>200) throw new StoreError('추첨 번호를 1~200자로 입력해 주세요.');
  const fixed=new Set(state.clubs.filter(c=>c.allocationMode==='fixed').flatMap(c=>c.fixedStudentIds??[]));
  let result:Result;try { result=allocate(state.students.filter(s=>s.applicationVersion>0||fixed.has(s.id)),state.clubs,seed); } catch(error) {throw new StoreError((error as Error).message);}
  for(const student of state.students) if(!result.placements[student.id]) result.placements[student.id]={club:null,rank:null,reason:'신청 미제출'};
  await mutate(db,{revision:expectedRevision,phases:['closed'],action:'allocation.run',actor,payload:{seed,clubs:state.clubs,students:state.students,result},phase:'allocated',result});return getTeacherState(db);
}
export async function adjustPlacement(db:D1Database,id:string,destination:string,reason:string,expectedRevision:number,actor:string):Promise<PortalState> {
  const state=await getTeacherState(db);requirePhase(state,['allocated']);requireRevision(state,expectedRevision);
  if(!state.result) throw new StoreError('배정 결과가 없습니다.',409);
  if(typeof reason!=='string'||reason.length>1000) throw new StoreError('조정 사유는 1,000자 이내로 입력해 주세요.');
  let result:Result;try {result=moveStudent(state.result,state.students,state.clubs,id,destination,reason);}catch(error){throw new StoreError((error as Error).message);}
  await mutate(db,{revision:expectedRevision,phases:['allocated'],action:'allocation.adjust',actor,payload:{studentId:id,from:state.result.placements[id],to:result.placements[id]},result});return getTeacherState(db);
}
export async function finalize(db:D1Database,expectedRevision:number,actor:string):Promise<PortalState> {
  const state=await getTeacherState(db);requirePhase(state,['allocated']);requireRevision(state,expectedRevision);
  if(!state.result) throw new StoreError('배정 결과가 없습니다.',409);
  await mutate(db,{revision:expectedRevision,phases:['allocated'],action:'allocation.finalize',actor,payload:{result:state.result},phase:'final'});return getTeacherState(db);
}
export async function getHistory(db:D1Database,studentId:string):Promise<ApplicationRevision[]> {
  const {results}=await db.prepare('SELECT id,student_id,version,choices_json,submitted_at FROM application_revisions WHERE student_id=? ORDER BY version').bind(studentId).all<{id:number;student_id:string;version:number;choices_json:string;submitted_at:string}>();
  return results.map(row=>({id:row.id,studentId:row.student_id,version:row.version,choices:JSON.parse(row.choices_json),submittedAt:row.submitted_at}));
}
export async function getAudit(db:D1Database):Promise<AuditEntry[]> {
  const {results}=await db.prepare('SELECT id,action,actor,payload_json,created_at FROM operation_log ORDER BY id').all<{id:number;action:string;actor:string;payload_json:string;created_at:string}>();
  return results.map(row=>({id:row.id,action:row.action,actor:row.actor,payload:JSON.parse(row.payload_json),createdAt:row.created_at}));
}
export async function resetStudentCode(db:D1Database,id:string,codeHash:string,expectedRevision:number,actor:string):Promise<PortalState> {
  const state=await getTeacherState(db);requireRevision(state,expectedRevision);
  if(!state.students.some(s=>s.id===id)) throw new StoreError('학생을 찾을 수 없습니다.',404);
  if(typeof codeHash!=='string'||!codeHash||codeHash.length>256) throw new StoreError('접속 코드를 확인해 주세요.');
  await mutate(db,{revision:expectedRevision,phases:['setup','open','closed','allocated','final'],action:'student.code-reset',actor,payload:{studentId:id},statements:op=>[
    db.prepare(`UPDATE students SET code_hash=?,code_version=code_version+1 WHERE id=? AND ${operationGuard}`).bind(codeHash,id,op),
    db.prepare(`DELETE FROM sessions WHERE student_id=? AND ${operationGuard}`).bind(id,op),
  ]});return getTeacherState(db);
}
