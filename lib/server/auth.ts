export type PortalEnv = { DB: D1Database; TEACHER_PASSWORD_HASH: string };
export type Role = 'teacher' | 'student';
export type Session = { role: Role; studentId: string | null; tokenHash: string };

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) { super(message); this.status = status; }
}

const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 100_000;
const WINDOW_MS = 15 * 60 * 1000;
const cookieName = (role: Role) => `club_${role}_session`;
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string) => new Uint8Array(value.match(/.{2}/g)?.map(byte => parseInt(byte, 16)) ?? []);
const randomSecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));

export async function hashSecret(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256));
}

export async function createPasswordHash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${hex(salt)}$${hex(await derivePassword(password, salt, PASSWORD_ITERATIONS))}`;
}

async function verifyPassword(password: string, saved: string) {
  if (!/^pbkdf2-sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(saved)) throw new AuthError('교사 로그인 설정을 확인해 주세요.', 503);
  const [, iterations, salt, expected] = saved.split('$');
  const actual = await derivePassword(password, fromHex(salt), Number(iterations));
  const expectedBytes = fromHex(expected);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expectedBytes[i];
  return difference === 0;
}

export function normalizeStudentCode(value: string) {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function generateStudentCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // Rejection sampling avoids modulo bias. Sixteen symbols contain 80 bits of entropy.
  let result = '';
  while (result.length < 16) {
    for (const value of crypto.getRandomValues(new Uint8Array(24))) {
      if (value < Math.floor(256 / alphabet.length) * alphabet.length && result.length < 16) result += alphabet[value % alphabet.length];
    }
  }
  return result.match(/.{4}/g)!.join('-');
}

export function assertSameOrigin(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AuthError('같은 사이트에서 다시 시도해 주세요.', 403);
  }
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw new AuthError('올바른 요청 형식이 아니에요.', 415);
  }
}

export async function checkLoginRate(request: Request, env: PortalEnv, role: Role, studentId?: string) {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const now = Date.now();
  const subjects = [`ip:${role}:${ip}`];
  if (studentId) subjects.push(`student:${studentId}`);
  for (const subject of subjects) {
    const key = await hashSecret(subject);
    const result = await env.DB.prepare(`INSERT INTO rate_limits (key, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN rate_limits.expires_at <= ? THEN 1 ELSE rate_limits.attempts + 1 END,
      expires_at = CASE WHEN rate_limits.expires_at <= ? THEN excluded.expires_at ELSE rate_limits.expires_at END
      RETURNING attempts`).bind(key, now + WINDOW_MS, now, now).first<{ attempts: number }>();
    if (!result || result.attempts > (subject.startsWith('student:') ? 10 : role === 'student' ? 1000 : 10)) {
      throw new AuthError('로그인 시도가 너무 많아요. 15분 후 다시 시도해 주세요.', 429);
    }
  }
}

function readCookie(request: Request, role: Role): string | null {
  const values = (request.headers.get('cookie') ?? '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${cookieName(role)}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(cookieName(role).length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function sessionCookie(request: Request, role: Role, value: string, age: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName(role)}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict${secure}`;
}

async function issueSession(request: Request, env: PortalEnv, role: Role, studentId: string | null, credentialVersion: string) {
  const token = randomSecret();
  const tokenHash = await hashSecret(token);
  const age = role === 'teacher' ? 4 * 60 * 60 : 2 * 60 * 60;
  const previous = readCookie(request, role);
  const statements = [env.DB.prepare('INSERT INTO sessions (token_hash, role, student_id, credential_version, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(tokenHash, role, studentId, credentialVersion, Date.now() + age * 1000)];
  if (previous) statements.push(env.DB.prepare('DELETE FROM sessions WHERE token_hash = ? AND role = ?').bind(await hashSecret(previous), role));
  statements.push(env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()));
  await env.DB.batch(statements);
  return sessionCookie(request, role, token, age);
}

export async function loginTeacher(request: Request, env: PortalEnv, password: string) {
  await checkLoginRate(request, env, 'teacher');
  if (!password || password.length > 256 || !await verifyPassword(password, env.TEACHER_PASSWORD_HASH ?? '')) {
    throw new AuthError('비밀번호가 맞지 않아요.');
  }
  return issueSession(request, env, 'teacher', null, await hashSecret(env.TEACHER_PASSWORD_HASH));
}

export async function loginStudent(request: Request, env: PortalEnv, studentId: string, code: string) {
  await checkLoginRate(request, env, 'student', studentId);
  const normalized = normalizeStudentCode(code);
  const codeHash = await hashSecret(normalized);
  const student = await env.DB.prepare('SELECT id, code_hash, code_version FROM students WHERE id = ?').bind(studentId).first<{ id: string; code_hash: string; code_version: number }>();
  if (!/^[A-HJ-NP-Z2-9]{16}$/.test(normalized) || !student || student.code_hash !== codeHash) {
    throw new AuthError('학년·반·번호 또는 신청 코드가 맞지 않아요.');
  }
  return issueSession(request, env, 'student', student.id, String(student.code_version));
}

export async function authenticate(request: Request, env: PortalEnv, role: Role): Promise<Session | null> {
  const token = readCookie(request, role);
  if (!token) return null;
  const tokenHash = await hashSecret(token);
  const session = await env.DB.prepare(`SELECT s.role, s.student_id, s.credential_version, r.code_version
      FROM sessions s LEFT JOIN students r ON r.id = s.student_id
      WHERE s.token_hash = ? AND s.role = ? AND s.expires_at > ?`)
    .bind(tokenHash, role, Date.now()).first<{ role: Role; student_id: string | null; credential_version: string; code_version: number | null }>();
  if (!session) return null;
  if (role === 'teacher') {
    if (!env.TEACHER_PASSWORD_HASH || session.credential_version !== await hashSecret(env.TEACHER_PASSWORD_HASH)) return null;
  } else if (!session.student_id || session.code_version === null || session.credential_version !== String(session.code_version)) return null;
  return { role, studentId: session.student_id, tokenHash };
}

export async function requireSession(request: Request, env: PortalEnv, role: Role) {
  const session = await authenticate(request, env, role);
  if (!session) throw new AuthError(role === 'teacher' ? '선생님 로그인이 필요해요.' : '신청 코드로 다시 로그인해 주세요.');
  return session;
}

export async function logout(request: Request, env: PortalEnv, role: Role) {
  const token = readCookie(request, role);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ? AND role = ?').bind(await hashSecret(token), role).run();
  return sessionCookie(request, role, '', 0);
}
