import type { ApiRoute, CorsOptions, Middleware } from '@mastra/core/server';

import type { ServiceRegistry } from '../shared/config/service-status';
import { logger } from '../shared/logger';
import { agentChatRoute } from './chat';
import { healthVersionRoute } from './health';
import { webhookRoute } from './webhook';
import { createRateLimiter, readRateLimitConfig } from './middleware/rate-limit';
import { requestContextPopulator } from './middleware/request-context';
import { requestTrace } from './middleware/request-trace';

export { webhookRoute } from './webhook';
export { healthVersionRoute } from './health';
export { agentChatRoute } from './chat';

/** Everything the `server` config of `new Mastra({ ... })` gains from this surface. */
export interface ServerSurface {
  cors?: CorsOptions;
  middleware: Middleware[];
  apiRoutes: ApiRoute[];
}

/**
 * `CORS_ORIGIN` is comma-separated and Hono matches origins EXACTLY — a bare
 * CSV string would match nothing, so it must be split into a string[].
 * Each entry trimmed; empties dropped; whole value unset/blank ⇒ no cors key
 * (Mastra's documented permissive `origin: '*'` default is preserved).
 */
export function parseCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CORS_ORIGIN ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

/**
 * Composition of the custom HTTP surface (spec 08 §3.3), mirroring
 * `buildInfrastructure`'s contract: pure function over env, pushes ONE
 * ServiceStatus line per service in BOTH branches (inactive strings are
 * verbatim from §3.7 so the banner matches the spec), returns a plain object
 * the composition root `Object.assign`s onto `serverConfig` (the imperative
 * pattern — `mastra dev` statically extracts the `server` literal, so NO
 * local identifier may appear inside it; see src/mastra/index.ts note).
 *
 * Lives here (not shared/config/) because these statuses describe the HTTP
 * surface, not pluggable infrastructure.
 */
export function buildServerSurface(services: ServiceRegistry): ServerSurface {
  // ── CORS ──────────────────────────────────────────────────────────────
  const origins = parseCorsOrigins();
  let cors: CorsOptions | undefined;
  if (origins.length > 0) {
    cors = { origin: origins }; // methods/headers/maxAge: Mastra's documented defaults merge in
    services.push({ name: 'CORS', active: true, detail: `allow-list: ${origins.join(', ')}` });
  } else {
    services.push({
      name: 'CORS',
      active: false,
      detail: "permissive default '*' — set CORS_ORIGIN in production",
    });
    // Deliberate WARN-not-fail-fast (spec §3.0): CORS is a browser-only
    // mechanism whose '*' default leaks nothing on its own (no credentials by
    // default; a cross-origin page cannot attach the user's Authorization
    // header). Failing the boot would break the founding zero-config promise.
    if (process.env.NODE_ENV === 'production') {
      logger.warn(
        'CORS_ORIGIN is unset in production — the permissive "*" CORS default stays active. ' +
          'Set CORS_ORIGIN to a comma-separated allow-list (docker-compose.prod.yml passes it ' +
          'through) — this is a hardening gap, not an auth hole.'
      );
    }
  }

  // ── Rate limiting (GLOBAL middleware ⇒ authed routes only; public routes
  //    carry their own instance — skipIfFrameworkPublic, spec §3.3) ──────
  const rate = readRateLimitConfig();
  // requestTrace FIRST: mide el request completo (entrada → cierre del stream).
  const middleware: Middleware[] = [requestTrace, requestContextPopulator];
  if (rate.enabled) {
    middleware.push(createRateLimiter());
    services.push({
      name: 'Rate limiting',
      active: true,
      detail: `${rate.max} req / ${rate.windowMs} ms fixed window per IP — in-process, per replica`,
    });
  } else {
    const partial = Boolean(
      (process.env.RATE_LIMIT_WINDOW_MS ?? '').trim() ||
      (process.env.RATE_LIMIT_MAX_REQUESTS ?? '').trim()
    );
    services.push({
      name: 'Rate limiting',
      active: false,
      detail: partial
        ? 'partial config — set BOTH RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX_REQUESTS'
        : 'disabled (set RATE_LIMIT_WINDOW_MS + RATE_LIMIT_MAX_REQUESTS)',
    });
  }

  // ── Webhook signing ───────────────────────────────────────────────────
  const webhookSecret = (process.env.WEBHOOK_SECRET ?? '').trim();
  services.push(
    webhookSecret
      ? {
          name: 'Webhook signing',
          active: true,
          detail: 'HMAC-SHA256 enforced on /hooks/* (x-webhook-signature)',
        }
      : {
          name: 'Webhook signing',
          active: false,
          detail: 'no WEBHOOK_SECRET — /hooks/* rejects 401',
        }
  );

  return {
    ...(cors && { cors }),
    middleware,
    apiRoutes: [webhookRoute, healthVersionRoute, agentChatRoute],
  };
}
