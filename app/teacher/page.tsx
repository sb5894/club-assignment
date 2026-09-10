import { headers } from 'next/headers';
import { TeacherDashboard } from '@/components/teacher-dashboard';
import { TeacherLogin } from '@/components/teacher-login';
import { authenticate } from '@/lib/server/auth';
import { portalEnv } from '@/lib/server/runtime';
import { getTeacherState } from '@/lib/server/store';

export const dynamic = 'force-dynamic';
export default async function TeacherPage() {
  const request = new Request('https://portal.invalid/teacher', { headers: new Headers(await headers()) });
  const environment = portalEnv();
  const session = await authenticate(request, environment, 'teacher');
  if (!session) return <TeacherLogin/>;
  return <TeacherDashboard initialState={await getTeacherState(environment.DB)}/>;
}
