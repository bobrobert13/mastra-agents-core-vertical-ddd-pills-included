<!-- Generated: 2026-09-14 | Spec 08 -->
# routes

## Purpose

Custom HTTP surface (peer of `domains/` and `shared/`, per spec 08 §3.0): signed
webhooks, version probe, AI-SDK streaming, plus the route-level middleware the
framework cannot carry for public routes. `index.ts` imports ONE symbol from
here — `buildServerSurface(services)` — and `Object.assign`s its result onto
the imperative `serverConfig` (never put a local identifier inside a `server`
object literal: `mastra dev` statically extracts it).

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | `buildServerSurface(services)` → `{ cors?, middleware, apiRoutes }`; pushes the CORS / Rate limiting / Webhook signing `ServiceStatus` rows (inactive strings verbatim from spec 08 §3.7) |
| `webhook.ts` | `POST /hooks/:source` — HMAC-verified raw body → exactly one `webhook.received` publish; NO domain logic here (vertical-slice rule) |
| `health.ts` | `GET /health/version` — status/version/env + Spec 01 `requestContext.get('user')` read contract demo |
| `chat.ts` | `POST /chat/:agentId` — `chatRoute({ version: 'v7' })` from `@mastra/ai-sdk`: AI-SDK v7 UI-message SSE over `{ messages: UIMessage[], memory }`. The package owns the wire format, so no serializer lives here |
| `middleware/types.ts` | `RouteMiddleware` = `MiddlewareHandler` extracted from @mastra/core's own `Middleware` union — the ONLY way to satisfy `tsc --noEmit` (two incompatible Hono type copies exist; `declare module 'hono'` augments the WRONG one — gate finding 08-1 alternative instead) |
| `middleware/webhook-signature.ts` | `computeSignature`/`verifySignature` (`timingSafeEqual`) + fail-closed `requireSignedRequest()` (unset secret ⇒ identical 401) |
| `middleware/rate-limit.ts` | in-memory FIXED-window limiter; both env vars required together; XFF first hop (spoofable without trusted-proxy) |
| `middleware/request-context.ts` | global `requestContextPopulator`: maps Spec 01 `user.id` → `MASTRA_RESOURCE_ID_KEY` (bare id) |
| `middleware/request-trace.ts` | global `requestTrace` (FIRST in the array): one-line-per-event pipeline trace of `/chat/:agentId` — entry (`msgs=`, `thread=` read from a body CLONE), TTFB (when the handler returned the `Response`: the end of the guardrail prelude), first byte and close/cancel with byte count; the short id goes back as `x-mastra-trace`. Dev diagnostics: on outside production, `CHAT_TRACE=on|off` overrides. Non-chat routes are untouched |

## For AI Agents

### Working In This Directory
- **Custom route paths MUST NOT start with `/api`** — Mastra 1.66 throws at boot
  (`validateCustomRoutePaths`). Root-level is the contract.
- **Global `server.middleware` is skipped on `requiresAuth: false` routes**
  (`skipIfFrameworkPublic`) — public routes carry their own middleware array.
- Raw-body integrity: never parse-and-reserialize before HMAC verification.
  `requireSignedRequest()` reads `c.req.text()` once; the handler re-reads it
  (Hono caches the body ⇒ still ONE underlying read — the approved 08-1
  alternative; do NOT introduce a `ContextVariableMap` augmentation, it
  cannot type the bundled Hono copy).
- New services activated from here still follow env-optional + banner rows
  (root `AGENTS.md` rule).
- Never import `domains/**` from here — inbound events cross boundaries ONLY
  via `shared/events` (`webhook.received` envelope).

<!-- MANUAL: -->
