// Mastra server auth: https://mastra.ai/docs/server/auth
import { MastraJwtAuth } from '@mastra/auth';
import { CompositeAuth, SimpleAuth } from '@mastra/core/server';
import type { IMastraAuthProvider, MastraAuthConfig } from '@mastra/core/server';
import { logger } from '../logger';

export type AuthConfig = MastraAuthConfig<unknown> | IMastraAuthProvider<unknown>;

export const FATAL_NO_AUTH_PRODUCTION =
  'FATAL [auth]: NODE_ENV=production but no auth is configured. Set MASTRA_JWT_SECRET or AUTH_DISABLED=true.';

export const UNAUTHENTICATED_BANNER =
  '⚠️ Server is UNAUTHENTICATED — every /api/* route and Studio are public. Set MASTRA_JWT_SECRET before deploying.';

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function buildAuth(): AuthConfig | undefined {
  if (env('AUTH_DISABLED') === 'true') {
    logger.warn('Auth is EXPLICITLY DISABLED via AUTH_DISABLED=true — never ship this to production.');
    return undefined;
  }

  const secret = env('MASTRA_JWT_SECRET');
  if (secret) {
    const jwt = new MastraJwtAuth({
      secret,
      mapUserToResourceId: (user: { id?: string; sub?: string }) => user?.id ?? user?.sub,
    });
    const workerToken = env('MASTRA_WORKER_AUTH_TOKEN');
    if (!workerToken) return jwt;
    return new CompositeAuth([
      jwt,
      new SimpleAuth<{ id: string; name: string }>({
        tokens: { [workerToken]: { id: 'mastra-worker', name: 'Mastra Worker' } },
        mapUserToResourceId: user => user?.id,
      }),
    ]);
  }

  if (process.env.NODE_ENV === 'production') throw new Error(FATAL_NO_AUTH_PRODUCTION);
  logger.warn(UNAUTHENTICATED_BANNER);
  return undefined;
}
