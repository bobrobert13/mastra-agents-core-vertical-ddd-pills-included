import type { RouteMiddleware } from './types'; // same (bundled) Hono type copy — see note there

/**
 * In-memory FIXED-window rate limiter, per process (not sliding).
 *
 * Enabled only when BOTH `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS`
 * are valid integers > 0; anything else (unset, partial, garbage) is a no-op
 * passthrough so the zero-config dev experience never changes. Env is read
 * per request (cheap) instead of at construction so the surface can be
 * booted before the env story lands (and tests can flip config without
 * re-importing the module graph).
 *
 * KNOWN LIMITATIONS (spec 08 §3.7 — banner + README + root AGENTS.md gotcha):
 * 1. State is IN-PROCESS memory: `docker-compose.prod.yml` runs api with
 *    `deploy.replicas: 3`, so the effective cluster limit is ~3 ×
 *    RATE_LIMIT_MAX_REQUESTS with per-replica counters; state is lost on
 *    restart (best-effort by design). Redis-backed global limiting is an
 *    unassigned follow-up riding on Spec 02's `REDIS_URL` convention.
 * 2. XFF TRUST: the key is the FIRST hop of `x-forwarded-for`, which is
 *    trivially spoofable unless a trusted-proxy hop count is configured in
 *    front of this server (it is not — spec 08 Phase 4 OQ3). Fallback key
 *    for direct requests is `'local'`.
 */

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  max: number;
}

function positiveInt(raw: string | undefined): number | undefined {
  const value = (raw ?? '').trim();
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Pure parse of the two env vars — exported for banner + unit tests. */
export function readRateLimitConfig(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  const windowMs = positiveInt(env.RATE_LIMIT_WINDOW_MS);
  const max = positiveInt(env.RATE_LIMIT_MAX_REQUESTS);
  return {
    enabled: windowMs !== undefined && max !== undefined,
    windowMs: windowMs ?? 0,
    max: max ?? 0,
  };
}

interface WindowState {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  /** Injectable clock for deterministic tests (fake timers allowed). */
  now?: () => number;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RouteMiddleware {
  const now = options.now ?? Date.now;
  const windows = new Map<string, WindowState>();

  return async (c, next) => {
    const config = readRateLimitConfig();
    if (!config.enabled) return next();

    const xff = c.req.header('x-forwarded-for');
    const key = xff?.split(',')[0]?.trim() || 'local';
    const at = now();

    const state = windows.get(key);
    if (!state || at >= state.resetAt) {
      // Lazy window eviction: an expired slot is simply overwritten on the
      // next hit — O(1) per request, no sweeper interval (spec §3.3).
      windows.set(key, { count: 1, resetAt: at + config.windowMs });
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (at >= w.resetAt) windows.delete(k);
      }
      return next();
    }

    state.count += 1;
    if (state.count > config.max) {
      const retryAfterSec = Math.max(1, Math.ceil((state.resetAt - at) / 1000));
      const response = c.json({ error: 'rate limit exceeded' }, 429);
      response.headers.set('Retry-After', String(retryAfterSec));
      return response;
    }

    return next();
  };
}
