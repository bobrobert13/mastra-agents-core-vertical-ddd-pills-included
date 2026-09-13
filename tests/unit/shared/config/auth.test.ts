import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mastra } from '@mastra/core/mastra';
import type { IMastraAuthProvider } from '@mastra/core/server';

import {
  buildAuth,
  FATAL_NO_AUTH_PRODUCTION,
  UNAUTHENTICATED_BANNER,
  type AuthConfig,
} from '../../../../src/mastra/shared/config/auth';
import { logServiceAvailability, type ServiceStatus } from '../../../../src/mastra/shared/config/service-status';
import { logger } from '../../../../src/mastra/shared/logger';

const AUTH_ENV_KEYS = ['MASTRA_JWT_SECRET', 'AUTH_PROVIDER', 'AUTH_DISABLED', 'MASTRA_WORKER_AUTH_TOKEN', 'MASTRA_API_PREFIX'] as const;

/** Self-contained HS256 signer: proves the JWT branch really verifies tokens
 *  without depending on any transitive JWT package (spec: no transitive imports). */
function signHs256(payload: Record<string, unknown>, secret: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode(payload);
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

const request = new Request('http://localhost:4111/api/workflows/events');

function authStatuses(services: ServiceStatus[]): ServiceStatus[] {
  return services.filter(s => s.name === 'Auth');
}

describe('buildAuth', () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = {};
    for (const key of [...AUTH_ENV_KEYS, 'NODE_ENV']) {
      envSnapshot[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  it('returns a working JWT provider when MASTRA_JWT_SECRET is set (dev)', async () => {
    process.env.MASTRA_JWT_SECRET = 'test-secret-value';
    const services: ServiceStatus[] = [];

    const auth = buildAuth(services);

    expect(auth).toBeDefined();
    expect(typeof auth?.authenticateToken).toBe('function');

    const provider = auth as IMastraAuthProvider<{ id?: string; sub?: string }>;
    const user = await provider.authenticateToken(
      signHs256({ id: 'user-1', sub: 'user-1' }, 'test-secret-value'),
      request,
    );
    expect(user?.id).toBe('user-1');
    expect(provider.mapUserToResourceId?.({ id: 'user-1' })).toBe('user-1');
    expect(provider.mapUserToResourceId?.({ sub: 'sub-9' })).toBe('sub-9');
    await expect(provider.authenticateToken('garbage.token.here', request)).rejects.toBeTruthy();

    expect(authStatuses(services)).toEqual([
      { name: 'Auth', active: true, detail: 'JWT (MASTRA_JWT_SECRET) — /api/* + Studio protected' },
    ]);
  });

  it('does not fail-fast in production when a JWT secret is configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.MASTRA_JWT_SECRET = 'prod-secret';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    expect(buildAuth([])).toBeDefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits 1 with the exact Scenario-2 message when nothing is set in production', () => {
    process.env.NODE_ENV = 'production';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    expect(() => buildAuth([])).toThrow(FATAL_NO_AUTH_PRODUCTION);
    expect(errorSpy).toHaveBeenCalledWith(FATAL_NO_AUTH_PRODUCTION);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('returns undefined in dev and emits the exact ⚠️ warning + one Auth status line', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const services: ServiceStatus[] = [];

    expect(buildAuth(services)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(UNAUTHENTICATED_BANNER);
    expect(authStatuses(services)).toEqual([
      { name: 'Auth', active: false, detail: 'NONE — public. set MASTRA_JWT_SECRET for production' },
    ]);
  });

  it('treats an empty MASTRA_JWT_SECRET as unset (dev stays inert)', () => {
    process.env.MASTRA_JWT_SECRET = '   ';
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    expect(buildAuth([])).toBeUndefined();
  });

  it('AUTH_DISABLED=true opts out in production without exiting', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_DISABLED = 'true';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const services: ServiceStatus[] = [];

    expect(buildAuth(services)).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('AUTH_DISABLED=true'));
    expect(authStatuses(services)).toEqual([
      { name: 'Auth', active: false, detail: 'EXPLICITLY DISABLED via AUTH_DISABLED=true — do not ship to prod' },
    ]);
  });

  it('AUTH_PROVIDER names a wired extension point and refuses to boot silently', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    process.env.AUTH_PROVIDER = 'clerk';

    expect(() => buildAuth([])).toThrow(/AUTH_PROVIDER="clerk" is a documented extension point/);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('FATAL [auth]'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects an unrecognized AUTH_PROVIDER with the same fatal shape', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    process.env.AUTH_PROVIDER = 'not-a-real-provider';

    expect(() => buildAuth([])).toThrow(/AUTH_PROVIDER="not-a-real-provider" is unrecognized/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('wires the Spec 02 worker bearer token through CompositeAuth when both envs are set', async () => {
    process.env.MASTRA_JWT_SECRET = 'shared-secret';
    process.env.MASTRA_WORKER_AUTH_TOKEN = 'worker-token-abc';
    const services: ServiceStatus[] = [];

    const auth = buildAuth(services);

    expect(auth).toBeDefined();
    const provider = auth as IMastraAuthProvider<{ id?: string; name?: string }>;
    await expect(provider.authenticateToken('worker-token-abc', request)).resolves.toMatchObject({
      id: 'mastra-worker',
    });
    expect(authStatuses(services)[0]?.detail).toContain('worker bearer token');
  });

  it('rewrites protected/public when a custom api prefix is configured', () => {
    process.env.MASTRA_JWT_SECRET = 'prefix-secret';
    process.env.MASTRA_API_PREFIX = 'mastra';
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const auth = buildAuth([]) as AuthConfig;

    expect(auth.protected).toEqual(['/mastra/*']);
    expect(auth.public).toEqual(['/mastra', '/mastra/auth/*']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('server.apiPrefix="/mastra"'));
  });

  it('returns a value that fits the real server.auth slot when spread into server', () => {
    process.env.MASTRA_JWT_SECRET = 'shape-secret';
    const auth: AuthConfig | undefined = buildAuth([]);

    // Compile-time proof of the wiring contract the orchestrator applies in
    // src/mastra/index.ts: the result spreads straight into `server`.
    const options: ConstructorParameters<typeof Mastra>[0] = {
      server: { port: 4111, ...(auth && { auth }) },
    };
    expect(options.server?.auth).toBeDefined();
  });

  it('renders the Auth row through the existing logServiceAvailability banner', () => {
    const rawSpy = vi.spyOn(logger, 'raw').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const services: ServiceStatus[] = [];
    buildAuth(services);

    logServiceAvailability(services);

    const banner = rawSpy.mock.calls[0]?.[0] as string;
    expect(banner).toContain('○ Auth             NONE — public. set MASTRA_JWT_SECRET for production');
    expect(UNAUTHENTICATED_BANNER).toBe(
      '⚠️  Server is UNAUTHENTICATED — every /api/* route and Studio are public. Set MASTRA_JWT_SECRET before deploying.',
    );
  });
});
