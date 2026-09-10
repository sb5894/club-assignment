import { env } from 'cloudflare:workers';
import type { PortalEnv } from './auth';

export function portalEnv(): PortalEnv {
  return env as unknown as PortalEnv;
}
