import type { Middleware } from '@mastra/core/server';

/**
 * `MiddlewareHandler` as typed by @mastra/core ITSELF — extracted from the
 * public `Middleware` union so route middleware sits on the SAME (bundled)
 * copy of Hono's types that `registerApiRoute` expects.
 *
 * Pitfall: `import type { MiddlewareHandler } from 'hono'` resolves the
 * app-level hoisted copy (4.13.7) and the two `Context` declarations are
 * structurally INCOMPATIBLE (`@mastra/core/dist/_types/hono` requires
 * `HonoRequest[GET_MATCH_RESULT]`, the hoisted copy does not) →
 * `npx tsc --noEmit` fails on every assignment. The same split explains why
 * the gate-finding-08-1 `declare module 'hono' { interface ContextVariableMap }`
 * augmentation cannot work here (wrong copy): we ship its approved
 * alternative — the webhook handler re-reads `await c.req.text()`, Hono
 * caches the body, still ONE underlying read (never both paths).
 */
export type RouteMiddleware = Extract<Middleware, (...args: never[]) => unknown>;
