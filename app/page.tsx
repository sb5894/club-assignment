import { headers } from 'next/headers';
import { StudentPortal } from '@/components/student-portal';
import { authenticate } from '@/lib/server/auth';
import { portalEnv } from '@/lib/server/runtime';
import { getStudentState } from '@/lib/server/store';

export const dynamic = 'force-dynamic';
export default async function StudentPage() {
  const request = new Request('https://portal.invalid/', { headers: new Headers(await headers()) });
  const environment = portalEnv();
  const session = await authenticate(request, environment, 'student');
  const state = session?.studentId ? await getStudentState(environment.DB, session.studentId) : null;
  return <StudentPortal initialState={state}/>;
}
