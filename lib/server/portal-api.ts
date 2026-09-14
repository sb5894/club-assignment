import { assertSameOrigin, AuthError, createStudentCodeIssuer, loginStudent, loginTeacher, logout, requireSession, type PortalEnv } from './auth.ts';
import { adjustPlacement, changePhase, finalize, getAudit, getHistory, getStudentState, getTeacherState, importStudents, resetStudentCode, runAllocation, runClubAllocation, StoreError, submitApplication, updateClubs, verifyApplication } from './store.ts';
import type { Club } from '../allocation.ts';
import type { IssuedCode, RosterInput } from '../portal-types.ts';

function json(data: unknown, status = 200, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Vary', 'Cookie');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(JSON.stringify(data), { status, headers });
}

function allowed(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some(key => !keys.includes(key))) throw new AuthError('허용되지 않은 요청 항목이 있어요.', 400);
}

function textField(body: Record<string, unknown>, key: string, max = 200) {
  const value = body[key];
  if (typeof value !== 'string' || value.length > max) throw new AuthError('입력 내용을 확인해 주세요.', 400);
  return value;
}

function integer(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new AuthError('화면을 새로고침한 뒤 다시 시도해 주세요.', 400);
  return value;
}

async function readBody(request: Request) {
  assertSameOrigin(request);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError('요청 내용이 없어요.', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 262_144) { await reader.cancel(); throw new AuthError('한 번에 전송할 수 있는 크기를 넘었어요.', 413); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AuthError('요청 내용이 올바르지 않아요.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AuthError('요청 내용이 올바르지 않아요.', 400);
  return body as Record<string, unknown>;
}

export async function handlePortalRequest(request: Request, env: PortalEnv): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    const method = request.method;
    if (!env.DB) return json({ error: '저장소를 준비 중이에요. 잠시 후 다시 시도해 주세요.' }, 503);
    if (!['GET', 'POST'].includes(method)) return json({ error: '지원하지 않는 요청 방식이에요.' }, 405, { Allow: 'GET, POST' });

    if (path.startsWith('/api/auth/')) {
      if (method !== 'POST') return json({ error: '로그인 화면에서 다시 시도해 주세요.' }, 405, { Allow: 'POST' });
      const body = await readBody(request);
      let cookie: string;
      if (path === '/api/auth/teacher') {
        allowed(body, ['password']);
        cookie = await loginTeacher(request, env, textField(body, 'password', 256));
      } else if (path === '/api/auth/student') {
        allowed(body, ['studentId', 'code']);
        const id = textField(body, 'studentId', 12);
        if (!/^\d{1,2}-\d{1,2}-\d{1,2}$/.test(id)) throw new AuthError('학년·반·번호 또는 신청 코드가 맞지 않아요.');
        cookie = await loginStudent(request, env, id, textField(body, 'code', 80));
      } else if (path === '/api/auth/logout') {
        allowed(body, ['role']);
        if (body.role !== 'student' && body.role !== 'teacher') throw new AuthError('로그인 종류를 확인해 주세요.', 400);
        cookie = await logout(request, env, body.role);
      } else return json({ error: '요청한 기능이 없어요.' }, 404);
      return json({ ok: true }, 200, { 'Set-Cookie': cookie });
    }

    if (path.startsWith('/api/student/')) {
      const session = await requireSession(request, env, 'student');
      const id = session.studentId!;
      if (url.search) throw new AuthError('학생 조회에는 다른 학생 번호를 지정할 수 없어요.', 400);
      if (path === '/api/student/me' && method === 'GET') return json(await getStudentState(env.DB, id));
      if (method !== 'POST') return json({ error: '요청한 기능이 없어요.' }, 404);
      const body = await readBody(request);
      if (path === '/api/student/application') {
        allowed(body, ['choices', 'version']);
        if (!Array.isArray(body.choices) || body.choices.some(choice => typeof choice !== 'string')) throw new AuthError('서로 다른 동아리 3개를 선택해 주세요.', 400);
        return json(await submitApplication(env.DB, id, body.choices as string[], integer(body, 'version'), { tokenHash: session.tokenHash }));
      }
      if (path === '/api/student/verify') {
        allowed(body, ['version']);
        return json(await verifyApplication(env.DB, id, integer(body, 'version'), { tokenHash: session.tokenHash }));
      }
      return json({ error: '요청한 기능이 없어요.' }, 404);
    }

    if (path.startsWith('/api/teacher/')) {
      await requireSession(request, env, 'teacher');
      if (method === 'GET') {
        if (path === '/api/teacher/state') return json(await getTeacherState(env.DB));
        if (path === '/api/teacher/history') {
          const id = url.searchParams.get('studentId');
          if (!id || !/^\d{1,2}-\d{1,2}-\d{1,2}$/.test(id)) throw new AuthError('학생 번호를 확인해 주세요.', 400);
          return json({ history: await getHistory(env.DB, id) });
        }
        if (path === '/api/teacher/audit') return json({ audit: await getAudit(env.DB) });
        return json({ error: '요청한 기능이 없어요.' }, 404);
      }
      if (path !== '/api/teacher/action') return json({ error: '요청한 기능이 없어요.' }, 404);
      const body = await readBody(request);
      const revision = integer(body, 'revision');
      const actor = 'teacher';
      switch (body.action) {
        case 'import': {
          allowed(body, ['action', 'rows', 'revision']);
          if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 500) throw new AuthError('한 번에 1~500명의 학생을 등록해 주세요.', 400);
          const codes: IssuedCode[] = [];
          const rows: (RosterInput & { codeHash: string })[] = [];
          const issueCode = await createStudentCodeIssuer(env.DB);
          for (const value of body.rows) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError('학생 명단을 확인해 주세요.', 400);
            const row = value as Record<string, unknown>;
            allowed(row, ['grade', 'classNo', 'number', 'name', 'gender']);
            const student = { grade: integer(row, 'grade'), classNo: integer(row, 'classNo'), number: integer(row, 'number'), name: textField(row, 'name', 80).trim(), gender: textField(row, 'gender', 20) };
            const { code, codeHash } = await issueCode();
            rows.push({ ...student, codeHash });
            codes.push({ id: `${student.grade}-${student.classNo}-${student.number}`, name: student.name, code });
          }
          await importStudents(env.DB, rows, revision, actor);
          return json({ state: await getTeacherState(env.DB), codes });
        }
        case 'settings':
          allowed(body, ['action', 'clubs', 'revision']);
          if (!Array.isArray(body.clubs)) throw new AuthError('동아리 설정을 확인해 주세요.', 400);
          return json({ state: await updateClubs(env.DB, body.clubs as Club[], revision, actor) });
        case 'phase':
          allowed(body, ['action', 'phase', 'revision']);
          if (body.phase !== 'open' && body.phase !== 'closed') throw new AuthError('접수 상태를 확인해 주세요.', 400);
          return json({ state: await changePhase(env.DB, body.phase, revision, actor) });
        case 'allocate':
          allowed(body, ['action', 'seed', 'rank', 'revision']);
          if(integer(body,'rank')!==1) throw new AuthError('2·3지망은 동아리별 배정 화면에서 인원을 지정해 실행해 주세요.',409);
          return json({ state: await runAllocation(env.DB, textField(body, 'seed'), revision, actor, integer(body, 'rank')) });
        case 'allocate-club':
          allowed(body, ['action', 'clubId', 'rank', 'seats', 'revision']);
          return json({ state: await runClubAllocation(env.DB, textField(body,'clubId'), integer(body,'rank'), integer(body,'seats'), revision, actor) });
        case 'adjust':
          allowed(body, ['action', 'studentId', 'destination', 'reason', 'revision']);
          return json({ state: await adjustPlacement(env.DB, textField(body, 'studentId'), textField(body, 'destination'), textField(body, 'reason', 1000), revision, actor) });
        case 'finalize':
          allowed(body, ['action', 'revision']);
          return json({ state: await finalize(env.DB, revision, actor) });
        case 'reset-code': {
          allowed(body, ['action', 'studentId', 'revision']);
          const id = textField(body, 'studentId', 12);
          const issueCode = await createStudentCodeIssuer(env.DB);
          const { code, codeHash } = await issueCode();
          const state = await resetStudentCode(env.DB, id, codeHash, revision, actor);
          return json({ state, codes: [{ id, name: state.students.find(student => student.id === id)!.name, code }] });
        }
        default: throw new AuthError('지원하지 않는 작업이에요.', 400);
      }
    }
    return json({ error: '요청한 기능이 없어요.' }, 404);
  } catch (error) {
    if (error instanceof AuthError || error instanceof StoreError) return json({ error: error.message }, error.status);
    // Never return SQL, request bodies, secrets or other students' data in errors.
    return json({ error: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }, 500);
  }
}
