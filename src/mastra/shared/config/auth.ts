import { MastraJwtAuth } from '@mastra/auth';
import { CompositeAuth, SimpleAuth } from '@mastra/core/server';
import type { IMastraAuthProvider, MastraAuthConfig } from '@mastra/core/server';

import { logger } from '../logger';
import type { ServiceRegistry } from './service-status';

/** The real union `new Mastra({ server: { auth } })` accepts in 1.66.0. */
export type AuthConfig = MastraAuthConfig<unknown> | IMastraAuthProvider<unknown>;

/** Documented extension points — wiring switch only, no provider SDK is pulled. */
const PROVIDERS = [
  'clerk',
  'supabase',
  'auth0',
  'workos',
  'firebase',
  'okta',
  'better-auth',
  'google',
] as const;

/** Scenario 2 (spec 01): verbatim — the actionable production fail-fast. */
export const FATAL_NO_AUTH_PRODUCTION =
  'FATAL [auth]: NODE_ENV=production but no auth is configured. Set MASTRA_JWT_SECRET (built-in JWT) or ' +
  'AUTH_PROVIDER=<clerk|supabase|auth0|workos|firebase|okta|better-auth|google>. For a deliberate, documented ' +
  'opt-out set AUTH_DISABLED=true. See docs/adr/004-auth-server-studio.md.';

/** Scenario 3 (spec 01): verbatim — printed above the service-availability table. */
export const UNAUTHENTICATED_BANNER =
  '⚠️  Server is UNAUTHENTICATED — every /api/* route and Studio are public. Set MASTRA_JWT_SECRET before deploying.';

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

/** Log the actionable FATAL line, then refuse to boot (non-zero exit). */
function fatal(message: string): never {
  logger.error(message);
  process.exit(1);
  // Unreachable in a real process. Kept so a stubbed `process.exit` (tests)
  // can never let the builder fall open and boot unauthenticated.
  throw new Error(message);
}

/**
 * Auth selection (env-optional, fail-fast in production — spec 01 Phase 3):
 *   MASTRA_JWT_SECRET             → built-in JWT (`MastraJwtAuth` from @mastra/auth)
 *   MASTRA_WORKER_AUTH_TOKEN      → + SimpleAuth token map via CompositeAuth (worker bearer; Spec 02 contract)
 *   AUTH_PROVIDER=<name>          → third-party wiring switch (extension point only → fatal "not wired")
 *   AUTH_DISABLED=true            → explicit, logged opt-out (also skips the production fail-fast)
 *   nothing + NODE_ENV=production → FATAL exit(1) (Scenario 2)
 *   nothing + dev                 → undefined (inert) + loud ⚠️ banner warning (Scenario 3)
 *
 * The result drops straight into `server.auth`; `undefined` = no auth key at all.
 * `protected`/`public` are NOT overridden by default: Mastra's own defaults
 * (`["/api/*"]` protected, `["/api","/api/auth/*"]` public) already match this
 * server, and root `/health` stays public on purpose (compose healthcheck).
 */
export function buildAuth(services: ServiceRegistry): AuthConfig | undefined {
  const workerToken = env('MASTRA_WORKER_AUTH_TOKEN');

  if (env('AUTH_DISABLED') === 'true') {
    logger.warn(
      'Auth is EXPLICITLY DISABLED via AUTH_DISABLED=true — every /api/* route and Studio are public. Never ship this to production.'
    );
    services.push({
      name: 'Auth',
      active: false,
      detail: 'EXPLICITLY DISABLED via AUTH_DISABLED=true — do not ship to prod',
    });
    return undefined;
  }

  const provider = env('AUTH_PROVIDER');
  if (provider) {
    const known = (PROVIDERS as readonly string[]).includes(provider);
    fatal(
      `FATAL [auth]: AUTH_PROVIDER="${provider}" is ${known ? 'a documented extension point, not shipped in this phase' : 'unrecognized (see the AUTH_PROVIDER list in .env.example)'}. ` +
        'Integrate its provider package and return it from buildAuth(). See docs/auth/overview third-party list.'
    );
  }

  const secret = env('MASTRA_JWT_SECRET');
  if (secret) {
    // `mapUserToResourceId` is required: without it Mastra trusts the caller for
    // ownership (memory/thread isolation). `sub` is the standard JWT identity
    // claim, `id` the Mastra convention; a token carrying neither fails loud
    // (500 from the middleware) instead of silently sharing one resource bucket.
    const jwt = new MastraJwtAuth({
      secret,
      mapUserToResourceId: (user: { id?: string; sub?: string }) => user?.id ?? user?.sub,
    });

    let auth: AuthConfig = jwt;
    if (workerToken) {
      // Workers post `Authorization: Bearer <MASTRA_WORKER_AUTH_TOKEN>` to the
      // step-execution + event endpoints (both `requiresAuth: true`). CompositeAuth
      // tries the JWT provider first and falls through on rejection.
      auth = new CompositeAuth([
        jwt,
        new SimpleAuth<{ id: string; name: string }>({
          tokens: { [workerToken]: { id: 'mastra-worker', name: 'Mastra Worker' } },
          mapUserToResourceId: user => user?.id,
        }),
      ]);
    } else {
      logger.debug(
        'MASTRA_WORKER_AUTH_TOKEN is unset — worker bearer auth is not accepted (single-process dev mode).'
      );
    }

    applyApiPrefixGuard(auth);

    services.push({
      name: 'Auth',
      active: true,
      detail: `JWT (MASTRA_JWT_SECRET) — /api/* + Studio protected${workerToken ? ' + worker bearer token' : ''}`,
    });
    return auth;
  }

  if (process.env.NODE_ENV === 'production') fatal(FATAL_NO_AUTH_PRODUCTION);

  // Inert dev boot: loud warning (renders above the availability table, since
  // buildAuth runs inside buildInfrastructure() before logServiceAvailability()).
  logger.warn(UNAUTHENTICATED_BANNER);
  services.push({
    name: 'Auth',
    active: false,
    detail: 'NONE — public. set MASTRA_JWT_SECRET for production',
  });
  return undefined;
}

/**
 * Guard, not a live path: today `src/mastra/index.ts` sets no `server.apiPrefix`.
 * Mastra merges these patterns *with* its defaults, so adding them is additive
 * and never opens a route — but the server must be wired with the same prefix.
 */
function applyApiPrefixGuard(auth: AuthConfig): void {
  const prefix = env('MASTRA_API_PREFIX');
  if (!prefix) return;

  const base = prefix.startsWith('/') ? prefix : `/${prefix}`;
  auth.protected = [`${base}/*`];
  auth.public = [base, `${base}/auth/*`];
  logger.warn(
    `Custom server.apiPrefix="${base}" — auth.protected/public rewritten to ["${base}/*"] and ["${base}", "${base}/auth/*"]. The same prefix must be set on server.apiPrefix or these patterns match nothing.`
  );
}
