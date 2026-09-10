import { handlePortalRequest } from '@/lib/server/portal-api';
import { portalEnv } from '@/lib/server/runtime';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handlePortalRequest(request, portalEnv());
export const POST = (request: Request) => handlePortalRequest(request, portalEnv());
