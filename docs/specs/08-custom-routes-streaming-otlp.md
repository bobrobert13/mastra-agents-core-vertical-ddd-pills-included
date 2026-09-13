# Spec+: Custom Routes, Streaming & OTLP Export (Phase 8)

> **ID:** 08 · **Phase:** 8 · **Status:** DRAFT
> **Depends on:** Spec 01 (Auth — JWT identity + `requestContext.user`), Spec 02 (Redis pub/sub bridge — cross-process delivery of `webhook.received`; it establishes only the `REDIS_URL` convention + pubsub builder — Redis-backed rate limiting is an **unassigned follow-up** riding on that convention, not part of Spec 02, whose Non-goals explicitly exclude it)
> **Grounds:** `docs/PRODUCTION-GAP-ANALYSIS.md` §2.4 (custom routes/middleware/request context), §3.5 (streaming as product API), §3.6 (exportable OTLP), and the **server-surface slice of §1.3** (`CORS_ORIGIN`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` become real here; `MASTRA_JWT_SECRET` is Spec 01, `MASTRA_STEP_EXECUTION_URL` §1.1/Spec 02, `ENABLE_MULTI_REGION` deletion Spec 01).
> **API verification:** every symbol below was checked against the docs bundled inside `@mastra/core@1.66.0` (`node_modules/@mastra/core/dist/docs/references/*`), the installed typings, and the live pages cited in §3.1 — nothing was taken from training data.

## Phase 1: Strategic Vision

* **Vision:** A cloned boilerplate is already a *product surface*: third-party systems can push signed events into the domain bus, a frontend can stream an agent answer token-by-token without writing glue, and operators can point traces at Tempo/Datadog with one env var — all without touching framework code.

* **OKR / Goal (PROPOSED — owner to confirm; per subagent brief):**
  * **O:** "The HTTP surface of this boilerplate is integrable, not just inspectable."
  * **KR1:** a frontend can consume a streaming agent answer with the documented `@mastra/client-js` example in **< 30 lines of consumer code** (measured: meaningful lines of `examples/stream-consumer.mjs`).
  * **KR2:** **every** inbound integration lands on the domain event bus through **exactly one** signed-route mechanism — 0 handler executions without a verified signature in the test suite.
  * **KR3:** traces export to an OTLP collector by setting `OTEL_EXPORTER_OTLP_ENDPOINT` + installing one package: **0 code changes**; with every new env var unset the server's route behavior, the Observability banner line, and the exporter set per config are **identical to today**, and the boot only **additionally** prints the new services in their `○` inactive state (additive banner; zero-config smoke keeps passing unmodified).

## Phase 2: Functional Spec (BDD)

* **User Story:** As a **full-stack developer integrating the agent backend into a product** (frontend + third-party services), I want signed webhook routes, working CORS/rate-limit env knobs, a streaming endpoint, and opt-in OTLP export, so that I can wire real inbound traffic and a real UI to this server without editing its source.

### Acceptance Criteria

> Paths below are **root-level**: Mastra 1.66 hard-throws at boot for any custom route starting with the `apiPrefix` (`/api`) — see §3.0 decision "root-level paths" for evidence. This supersedes the `/api/...` naming from the feature brief.

* **Scenario 1: Signed webhook accepted → event published → subscriber side effect (happy path)**
  * **Given** `WEBHOOK_SECRET=whsec_test_secret` is set, a test subscriber is registered on `eventBus` for `webhook.received`, and the `x-webhook-signature` header contains `sha256=` + HMAC-SHA256 of the raw JSON body computed with that secret
  * **When** `POST /hooks/stripe` arrives with body `{"event":"payment.succeeded","data":{"amount":42}}`
  * **Then** the response is `200` with body exactly `{"received":true,"source":"stripe","type":"webhook.received"}`
  * **And** the subscriber received exactly one event with `payload.source === 'stripe'`, `payload.event === 'payment.succeeded'`, `payload.data.amount === 42` (the handler touches nothing else — side effects belong to whichever domain subscribes, preserving vertical-slice rules).

* **Scenario 2: Bad, missing, or unconfigured HMAC → exact 401 shape, no handler executed**
  * **Given** `WEBHOOK_SECRET` is set and `eventBus.publish` is spied on
  * **When** `POST /hooks/stripe` arrives with a signature header that is absent, malformed (not `sha256=<64 lowercase hex>`), or computed with a wrong secret
  * **Then** the response is `401` with JSON body exactly `{"error":"invalid webhook signature"}` — all three variants byte-identical (no oracle distinguishing "missing" from "wrong")
  * **And** the spy confirms `eventBus.publish` was **not** called and the handler never executed.
  * **Separate scenario instance:** with `WEBHOOK_SECRET` **unset**, `POST /hooks/stripe` with any signature returns the same `401` + same body shape (fail-closed, route still registered — see §3.0).

* **Scenario 3: CORS preflight decided by the `CORS_ORIGIN` allow-list**
  * **Given** `CORS_ORIGIN=https://app.example.com,https://admin.example.com`
  * **When** an `OPTIONS` preflight arrives with `Origin: https://app.example.com` and `Access-Control-Request-Method: POST`
  * **Then** the response includes `Access-Control-Allow-Origin: https://app.example.com`, an `Access-Control-Allow-Methods` containing `POST`, and `Access-Control-Max-Age: 3600` (Mastra injects that default when `cors` is configured)
  * **Examples (one behavior, two cases):** with `Origin: https://evil.example.com` the response carries **no** `Access-Control-Allow-Origin` header (the browser then blocks the call); with `CORS_ORIGIN` unset the built-in permissive `Access-Control-Allow-Origin: *` default is preserved (banner `○` + production WARN per §3.7).

* **Scenario 4: Streaming route returns AI-SDK-compatible SSE chunks**
  * **Given** the server is booted in the integration harness (skipIf-gated, §3.9) with a live provider key or a stubbed model
  * **When** `POST /stream/research` sends `{"messages":[{"role":"user","content":"say hi"}]}`
  * **Then** the response `Content-Type` starts with `text/event-stream`
  * **And** the first SSE `data:` frame parses to a JSON object with `"type":"start"` — the AI SDK UI-message-stream start part emitted by `toAISdkStream(stream, { from: 'agent' })` (default `version: 'v5'`, `sendStart: true`) — with text/finish frames beyond it **not** asserted (no model-output coupling).

* **Scenario 5: OTLP unset → behavior identical to today (regression guard)**
  * **Given** `OTEL_EXPORTER_OTLP_ENDPOINT` is unset (the zero-config smoke boot; `NODE_ENV` unset ⇒ the `development` config is selected by `configSelector`)
  * **When** the Mastra instance is constructed
  * **Then** `buildObservability` returns an `Observability` whose exporter set is exactly `[new MastraStorageExporter()]` per config — the current `development` config (no `SensitiveDataFilter` there, it is production-only and is a `spanOutputProcessors` entry, not an exporter), and **no require or construction of `@mastra/otel-exporter` happens unless the var is set** (the env read itself occurs unconditionally, like every other env check in the builder — Scenario 5 guards the package side-effect, not the `process.env` lookup)
  * **And** the Observability banner line text is unchanged from today, and `tests/smoke/boots.test.ts` passes with **no modification to its existing assertions** (new cases are added alongside, per KR3's "additive banner" wording).

## Phase 3: Technical Contract & DoD

### 3.0 Decisions with justification (REPO CONVENTIONS items)

| Decision | Choice | Justification |
|---|---|---|
| **Root-level paths** (overrides brief) | `/hooks/:source`, `/health/version`, `/stream/:agentId` — **not** `/api/...` | Hard constraint, verified twice: `@mastra/core` bundled `reference-server-register-api-route.md` — *"Custom route paths can't start with the server's configured `apiPrefix` (default: `/api`)"* — and `@mastra/server/dist/server/server-adapter/index.js:1041-1046` `validateCustomRoutePaths()` **throws at boot** (`Custom API route "/api/..." must not start with "/api"`), called on every `registerSchemaApiRoutes()`. The brief's paths would crash `npm run dev` and the smoke gate. Root-level is also what the official docs use (`/webhooks/github`). Consequence for Spec 01: default auth protects `/api/*` patterns; custom routes rely on their per-route `requiresAuth` flag, which the server tracks independently (confirmed in `.mastra/output/index.mjs` `customRouteAuthConfig`). |
| Where routes live | **New `src/mastra/routes/` (peer of `domains/` and `shared/`)** | `shared/AGENTS.md` reserves `shared/` for *cross-domain utilities used by ≥2 domains or the composition root*, "exactly one reason to change". HTTP surface is not a utility; webhook code must never import `domains/` (vertical-slice rule). `routes/` keeps `shared/` minimal and gives `index.ts` a single barrel import. |
| No `WEBHOOK_SECRET` → **401 (route present)**, not route-absent | Fail-closed `401` on every request when the secret is unset | 1) An inbound endpoint that silently works *unsigned* when a deploy forgets the secret inverts the repo's env-optional promise into a security hole — env-optional means "degrade safely", not "degrade open". 2) A present-but-rejecting route keeps the OpenAPI/route table stable: ops see 401 + banner `○` line + WARN instead of a confusing 404 flicker that also breaks the smoke test depending on boot order. 3) Disabling the *integration*, not deleting the *surface*, matches how `SCOPE_GUARD=off` keeps behavior explicit. |
| CORS unset in production → **WARN, not fail-fast** (deliberate asymmetry vs Spec 01) | Banner `○ CORS` + one WARN line when `NODE_ENV=production && !CORS_ORIGIN` | Spec 01 chose boot fail-fast *for auth* because auth is the security boundary — without it the server itself is unguarded. CORS is categorically different: a browser-only mechanism whose `'*'` default leaks nothing on its own (a cross-origin page can never attach the user's `Authorization` header automatically; Mastra's default is `credentials: false`). Failing the boot over it would break the founding zero-config promise ("no env var ⇒ no error", root `AGENTS.md`) and Studio-on-localhost for a non-boundary. The hard gate belongs in config, not code: `docker-compose.prod.yml` should pass `CORS_ORIGIN` the same way it already passes `MASTRA_JWT_SECRET` (that compose edit is listed in the DoD docs item as a check). |
| Streaming artifact | **Both**: route `/stream/:agentId` (`toAISdkStream`) **and** `examples/stream-consumer.mjs` (`@mastra/client-js`) — no React app | The scenario table needs a server-side assertion target; the client script answers the 90% "connect my UI" question from §3.5. The route alone leaves frontend users guessing the client API; the script alone leaves no server example. Each ≤ ~70 LOC. |
| `registerApiRoute` over `createRoute` | All custom routes via `registerApiRoute` + manual zod parsing | `createRoute` (from `@mastra/server/server-adapter`, zod peer `^3.25.0 \|\| ^4.0.0` vs our direct `zod@^3.23.8`) pre-parses the JSON body **before** the handler — but HMAC must be computed over **raw bytes** (re-serialization changes whitespace and breaks signatures). And importing `@mastra/server` today means leaning on a transitive dep of the `mastra` CLI. Promote it later if more schema-first routes appear. |
| ADR needed? | **No** | ADR-001 (vertical slicing) and ADR-003 (event-driven) already fix the architecture; Phase 8 wires documented Mastra features and revives declared env vars. `docs/AGENTS.md` demands an ADR only for a *new architectural decision* — this is feature-level integration. Stated here so the implementer doesn't pad the record. |

### 3.1 *Interface / Data Schema —* verified real API names (the anti-hallucination table)

| Concern | Symbol (verified) | Import path | Doc URL |
|---|---|---|---|
| Custom route registration | `registerApiRoute(path, { method, handler(c) \| createHandler, middleware?, openapi?, requiresAuth?, cors? })` | `@mastra/core/server` (in installed typings: `dist/server/index.d.ts:53`) | [docs/server/custom-api-routes](https://mastra.ai/docs/server/custom-api-routes), [reference/server/register-api-route](https://mastra.ai/reference/server/register-api-route) |
| Schema-first alternative (NOT used) | `createRoute({ method, path, bodySchema, responseSchema, responseType })` — zod-validated, 400 on failure, `onValidationError` override | `@mastra/server/server-adapter` — package `@mastra/server@1.66.0` exists only **transitively** (via `mastra` CLI); using it requires promoting it to a direct dep | [reference/server/create-route](https://mastra.ai/reference/server/create-route) |
| Attachment | `new Mastra({ server: { apiRoutes: [...] } })`; paths mount verbatim at the Hono root (`app.on(route.method, route.path, …)` in `.mastra/output/index.mjs:49045`) but **must not start with `apiPrefix`** (throws — §3.0) | — | docs above |
| Global middleware | `server.middleware` — array of Hono `(c, next)` handlers or `{ path, handler }` objects; **skipped on `requiresAuth: false` routes** (`skipIfFrameworkPublic`, `@mastra/core/dist/server/types.d.ts:270-280`) | `@mastra/core` config | [docs/server/middleware](https://mastra.ai/docs/server/middleware) |
| Request context | `c.get('requestContext')` in handlers; authed user at `requestContext.get('user')`; reserved keys `MASTRA_RESOURCE_ID_KEY`, `MASTRA_THREAD_ID_KEY` | `@mastra/core/request-context` | [docs/server/request-context](https://mastra.ai/docs/server/request-context) |
| CORS | First-class `server: { cors: { origin, allowMethods, allowHeaders, exposeHeaders, credentials } }`; documented default (installed typings JSDoc) is permissive `origin: '*'` + `maxAge: 3600`-capable merge; Hono matches origin **exactly**, so `CORS_ORIGIN` must be `split(',')` → `string[]` | `@mastra/core` config | [docs/server/middleware](https://mastra.ai/docs/server/middleware) (CORS section) |
| Agent streaming | `agent.stream(messages, opts)` — the **current standard** (the legacy survivor is `streamLegacy()`), returns `MastraModelOutput`: `textStream`, `text`, `steps`, `usage`, `toTextStreamResponse()`, `consumeStream()`; accepts `abortSignal`, `memory`, `requestContext` | `@mastra/core/agent` (via `mastra.getAgent(id)` — note: **throws** for unknown ids, §3.2) | [docs/guides/streaming](https://mastra.ai/docs/guides/streaming) |
| AI SDK adapter | `toAISdkStream(stream, { from: 'agent', version?: 'v5'\|'v6'\|'v7', sendStart?, ... })` + `createUIMessageStream` / `createUIMessageStreamResponse` from `ai` | **`@mastra/ai-sdk`** (NOT `@mastra/core/stream`) | [reference/ai-sdk/to-ai-sdk-stream](https://mastra.ai/reference/ai-sdk/to-ai-sdk-stream) (brief URL `…/toAISdkStream` 404s; canonical slug is kebab-case; class/function name itself confirmed: `toAISdkStream`) |
| Client streaming | `client.getAgent(id).stream(prompt, { memory })` → `response.processDataStream({ onChunk })`; chunks `{ type: 'text-delta', payload: { text } }` | `@mastra/client-js` (npm latest `1.45.0`) | [reference/client-js/agents](https://mastra.ai/reference/client-js/agents) |
| OTLP export | **`OtelExporter`** — `new OtelExporter({ provider: { custom: { endpoint, protocol?, headers? } }, signals?, timeout?, batchSize? })` from **`@mastra/otel-exporter`** (npm latest `1.3.15`). ⚠️ Correction to the brief's guess: **no `OTLPTraceExporter` exists in `@mastra/observability`** — its `exporters/` ships `MastraStorageExporter`, `ConsoleExporter`, `MastraPlatformExporter`, etc. only; `OTLPTraceExporter` is the raw `@opentelemetry/exporter-trace-otlp-http` SDK class that `@mastra/otel-exporter` wraps. Protocol peers per its docs table: trace pkg per protocol (`otlp-http` / `otlp-proto` / `otlp-grpc` + `@grpc/grpc-js` / `zipkin`); `protocol` selects among them (no documented default claim). A separate experimental `OtelBridge` (`@mastra/otel-bridge`) handles bidirectional context — out of scope, mention only. | `@mastra/otel-exporter` (optional peer — never in `dependencies`, §3.5) | [reference/observability/tracing/exporters/otel](https://mastra.ai/reference/observability/tracing/exporters/otel), [docs/observability/tracing/overview](https://mastra.ai/docs/observability/tracing/overview) |

### 3.2 Route contracts (`src/mastra/routes/`)

```typescript
// src/mastra/routes/webhook.ts
import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import { eventBus } from '../shared/events';
import type { InboundWebhookEvent } from '../shared/events';
import { requireSignedRequest } from './middleware/webhook-signature';
import { createRateLimiter } from './middleware/rate-limit';

const webhookBodySchema = z.object({
  event: z.string().min(1).max(128),
  data: z.record(z.unknown()),
});
export interface WebhookHeaders { 'x-webhook-signature'?: string } // contract: 'sha256=' + 64-hex

export const webhookRoute = registerApiRoute('/hooks/:source', {
  method: 'POST',
  requiresAuth: false,                        // inbound systems hold no JWT (Spec 01) — HMAC is the auth
  middleware: [createRateLimiter(), requireSignedRequest()], // global server.middleware is SKIPPED for
  handler: async c => {                       // requiresAuth:false routes (docs/server/middleware), so the
    const raw = String(c.get('webhook.raw')); // raw body captured ONCE by the signature middleware —
    let json: unknown;                        // see §3.3 typing note (ContextVariableMap augmentation)
    try { json = JSON.parse(raw); }
    catch { return c.json({ error: 'invalid webhook payload' }, 400); }
    const parsed = webhookBodySchema.safeParse(json);
    if (!parsed.success) return c.json({ error: 'invalid webhook payload' }, 400);
    const event: InboundWebhookEvent = {
      type: 'webhook.received',
      payload: { source: c.req.param('source'), event: parsed.data.event,
                 data: parsed.data.data, receivedAt: new Date() },
    };
    await eventBus.publish(event);            // local bus now; Spec 02's bridge fans out cross-process
    return c.json({ received: true, source: event.payload.source, type: 'webhook.received' });
  },
  openapi: { summary: 'Inbound signed webhook', tags: ['Webhooks'] },
});
```

```typescript
// src/mastra/routes/health.ts — version companion to the built-in GET /health (compose healthcheck uses /health; untouched)
export const healthVersionRoute = registerApiRoute('/health/version', {
  method: 'GET',
  requiresAuth: false,                        // LB / uptime probes hold no JWT; payload is non-sensitive
  handler: async c => {
    const user = c.get('requestContext').get('user'); // present only when Spec 01 auth verified a token —
    return c.json({                            // this route demonstrates the Spec 01 read contract:
      status: 'ok',                            //   requestContext.get('user') → { id, ... } | undefined
      version: process.env.npm_package_version ?? '1.0.0',
      env: process.env.NODE_ENV ?? 'development',
      user: user ? { id: user.id } : null,     // reflects THIS request's auth — no cross-user leak
    });
  },
});
```

```typescript
// src/mastra/routes/stream.ts — AI-SDK-compatible SSE (Scenario 4). requiresAuth default (true) — protected once Spec 01 lands.
import { toAISdkStream } from '@mastra/ai-sdk';    // NEW direct dep
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'; // NEW direct dep
import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';

const streamBodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant', 'system']), content: z.string() })).min(1),
  memory: z.object({ thread: z.string(), resource: z.string() }).optional(),
});

export const agentStreamRoute = registerApiRoute('/stream/:agentId', {
  method: 'POST',
  openapi: { summary: 'Stream an agent answer as AI-SDK UI chunks', tags: ['Streaming'] },
  handler: async c => {
    const parsed = streamBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid stream payload' }, 400);
    const mastra = c.get('mastra');
    let agent;                                  // mastra.getAgent(id) THROWS for unknown ids (verified runtime);
    try { agent = mastra.getAgent(c.req.param('agentId')); }   // an uncaught throw would surface as 500 via
    catch { return c.json({ error: `agent "${c.req.param('agentId')}" not found` }, 404); } // onError — catch it here
    const stream = await agent.stream(parsed.data.messages, {
      memory: parsed.data.memory,
      abortSignal: c.req.raw.signal,            // client disconnect cancels generation (docs pattern)
    });
    return createUIMessageStreamResponse({
      stream: createUIMessageStream({
        execute: async ({ writer }) => {
          for await (const part of toAISdkStream(stream, { from: 'agent' })) await writer.write(part);
        },
      }),
    });
  },
});
```

### 3.3 Middleware contracts (`src/mastra/routes/middleware/`)

```typescript
// webhook-signature.ts — deterministic, unit-testable
import { createHmac, timingSafeEqual } from 'crypto';
import type { MiddlewareHandler } from 'hono'; // hono stays a transitive dep: type-only imports are erased

export function computeSignature(rawBody: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}
export function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(computeSignature(rawBody, secret));
  const actual = Buffer.from(header);            // both fixed-shape ('sha256=' + 64 hex) → equal length,
  return expected.length === actual.length && timingSafeEqual(expected, actual); // timing-safe (NFR §5)
}
// requireSignedRequest(): MiddlewareHandler
//   reads WEBHOOK_SECRET; caches c.req.text() ONCE, verifies, then c.set('webhook.raw', raw) and next();
//   secret unset OR verification fails → return c.json({ error: 'invalid webhook signature' }, 401)
//   (identical shape either way — fail closed, no oracle; handler never runs).
// typing (gate finding 08-1): c.get/c.set keys are restricted to Variables/ContextVariableMap under
//   Hono 4.13.7 — a bare c.set('webhook.raw', …) FAILS `npx tsc --noEmit`. Required:
//   src/mastra/routes/hono-variables.d.ts →
//   declare module 'hono' { interface ContextVariableMap { 'webhook.raw': string } }
//   Approved alternative (pick one in the PR, never both): drop the set/get pair — the handler simply
//   re-reads `await c.req.text()` (Hono caches the body, so it is still ONE underlying read).
```

```typescript
// rate-limit.ts — in-memory FIXED-window counter, per process (not sliding; see §3.7 caveat)
export function createRateLimiter(): MiddlewareHandler {
  // Both RATE_LIMIT_WINDOW_MS + RATE_LIMIT_MAX_REQUESTS valid ints > 0 → enable; otherwise no-op passthrough
  // (zero-config unchanged; banner notes partial config). Key: x-forwarded-for first hop, fallback 'local'.
  // Map<key,{count,resetAt}>; over limit → c.json({ error: 'rate limit exceeded' }, 429)
  //   .header('Retry-After', String(Math.ceil((resetAt - now) / 1000)));  // lazy window eviction, O(1)
}
```

```typescript
// request-context.ts — global server.middleware (authed routes only; per-route auth runs later, so
// Spec 01's user is read here when a route group already resolved it — see contract table below)
import { MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';
export const requestContextPopulator = async (c: Context, next: () => Promise<void>) => {
  const rc = c.get('requestContext');
  const user = rc.get('user');                      // { id, ... } guaranteed by Spec 01's auth provider
  if (user?.id && !rc.get(MASTRA_RESOURCE_ID_KEY))  // never override a server-set mapping (mapUserToResourceId)
    rc.set(MASTRA_RESOURCE_ID_KEY, user.id);        // BARE id — byte-identical to Spec 01's
  await next();                                     // mapUserToResourceId(user => user?.id) (01 §auth, :99)
};                                                   // so the two writers can never disagree per request
```

> **Cross-spec format note (gate finding 08-3):** a namespaced resource (`user:${user.id}`) would be a **PROPOSED refinement to Spec 01's mapping** — it must come from 01's `mapUserToResourceId` itself, never from this populator writing a different format behind 01's back. Needs 01-owner sign-off before adoption; v1 ships the bare id.

**requestContext key contract (shared with Spec 01):**

| Key | Written by | Read by | Value |
|---|---|---|---|
| `'user'` | Spec 01 auth provider | custom routes (`/health/version`, `/stream/:agentId`, future protected routes) | `{ id: string; roles?: string[] } \| undefined` |
| `MASTRA_RESOURCE_ID_KEY` (`@mastra/core/request-context`) | Spec 01 `mapUserToResourceId`; else our `requestContextPopulator` (same bare-id format — see cross-spec note) | server-enforced memory/thread isolation (403 on cross-resource) | `user.id` (bare; namespacing is PROPOSED, not fact) |
| `'webhook.raw'` | `requireSignedRequest()` middleware | webhook handler (avoids a second body read) | `string` (raw bytes) |

Composition in `src/mastra/index.ts` (stays declarative — one import, one call):

```typescript
import { buildServerSurface } from './routes'; // routes/index.ts: buildServerSurface(services) →
// { apiRoutes, middleware, cors } — pushes the Webhook/CORS/Rate-limit ServiceStatus lines (both
const infra = buildInfrastructure();           // branches — see root AGENTS.md "new services must
// new Mastra({ ..., server: { port, host, ...buildServerSurface(infra.services) } })   report in banner)
```

`buildServerSurface` lives in `routes/index.ts` (not `shared/config/`) because these statuses describe the HTTP surface, not pluggable infrastructure; it obeys the same contract: one line per service, `ServiceStatus` in **both** branches, wired through `index.ts` exactly like `buildInfrastructure`.

### 3.4 Event-bus contract addition (`shared/events`)

```typescript
// src/mastra/shared/events/webhook-events.ts — lives in shared/ because NO domain may be imported by
// the webhook and no domain owns this envelope; domains subscribe and map it to their own typed events.
export interface InboundWebhookEvent {
  type: 'webhook.received';
  payload: { source: string; event: string; data: Record<string, unknown>; receivedAt: Date };
}
```

Also: re-export it from the `shared/events/index.ts` barrel (currently exports `eventBus` only). `eventBus.publish` is a local `emit` today (single process, gap §1.2); Spec 02's Redis bridge turns this exact publish into the cross-process fan-out point — Phase 8 guarantees only *"every inbound HTTP integration lands on `eventBus` as exactly one `webhook.received`"*.

### 3.5 OTLP export — config diff in `shared/config/observability.ts`

Purely additive; **all branches push a `ServiceStatus`**; opt-in, optional peer, never crashes:

```diff
+import { createRequire } from 'module';
+import { logger } from '../logger'; // NEW import — this module currently logs nothing
 import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability';

 export function buildObservability(services: ServiceRegistry): Observability | undefined {
   // ... unchanged ENABLE_OBSERVABILITY=false branch (returns early, no OTLP probe) ...
+  const exporters: ObservabilityExporter[] = [new MastraStorageExporter()];
+  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
+  if (otlpEndpoint) {
+    // Optional peer — intentionally NOT in dependencies (no forced deps). A SYNC probe keeps the
+    // builder signature untouched (no async churn in the composition root):
+    const requireOptional = createRequire(import.meta.url); // 'module' — resolved at runtime only
+    try {
+      const { OtelExporter } = requireOptional('@mastra/otel-exporter');
+      exporters.push(new OtelExporter({ provider: { custom: { endpoint: normalizeTracesUrl(otlpEndpoint) } } }));
+      services.push({ name: 'OTLP export', active: true, detail: `traces → ${otlpEndpoint}` });
+    } catch {
+      logger.warn('OTEL_EXPORTER_OTLP_ENDPOINT is set but @mastra/otel-exporter (or its OTLP protocol ' +
+        'peer) is not installed — traces stay storage-only. Opt in: npm i @mastra/otel-exporter --legacy-peer-deps');
+      services.push({ name: 'OTLP export', active: false, detail: 'endpoint set, package missing' });
+    }
+  } else {
+    services.push({ name: 'OTLP export', active: false, detail: 'set OTEL_EXPORTER_OTLP_ENDPOINT to export' });
+  }
   return new Observability({ configs: {
-    production:  { … exporters: [new MastraStorageExporter()], … },
-    development: { exporters: [new MastraStorageExporter()], … },
+    production:  { … exporters, … },   // array only GROWS — MastraStorageExporter kept in BOTH configs
+    development: { exporters, … },     // (Studio keeps working; unset env ⇒ identical content to today)
```

* `normalizeTracesUrl(endpoint)`: `OtelExporter`'s `custom.endpoint` expects the full traces URL (`…/v1/traces`, per the exporter/migration docs), while the standard OTLP env-var convention is a **base URL** — the helper appends `/v1/traces` only when the value has no path; spike confirms against a local collector.
* Protocol peers: traces over HTTP/JSON vs HTTP/protobuf vs gRPC each need their own `@opentelemetry/exporter-trace-otlp-*` package (gRPC also `@grpc/grpc-js`; Zipkin no logs) — documented in README, not resolved here (`protocol` omitted ⇒ package default).
* **Metrics:** automatic Metrics exist ([docs/observability/metrics/overview](https://mastra.ai/docs/observability/metrics/overview)) — **out of scope, doc-only pointer** from README's Observability section.
* No forced deps: the guarded `createRequire` probe means a missing/conflicting optional package can never block boot or the build (implementation spike verifies behavior under `mastra build`'s bundler; fallback if the bundler rejects the runtime lookup: try/catch around a lazy path resolved at startup — must stay sync to keep the builder signature).

### 3.6 Streaming consumer (`examples/stream-consumer.mjs`)

```javascript
// Run against a live server: node examples/stream-consumer.mjs [agentId] [baseUrl]
// Consumer dep (documented, dev-only): npm i @mastra/client-js --legacy-peer-deps
import { MastraClient } from '@mastra/client-js';
const client = new MastraClient({ baseUrl: process.argv[3] ?? 'http://localhost:4111' });
const agent = client.getAgent(process.argv[2] ?? 'research');
const response = await agent.stream('Summarize your scope in one line', {
  memory: { thread: 'example-thread', resource: 'example-user' },
});
await response.processDataStream({
  onChunk: async chunk => { if (chunk.type === 'text-delta') process.stdout.write(chunk.payload.text); },
});
```

Meaningful lines ≤ 30 — KR1's proof. The SSE route variant is exercised by the integration test, not a second example.

### 3.7 Environment table — `.env.example` (the §1.3 server-surface vars become REAL here)

| Var | Old state | New semantics | Unset behavior |
|---|---|---|---|
| `CORS_ORIGIN` | **dead** (§1.3) | comma-separated allow-list → `split(',')` → `server.cors.origin: string[]` (Hono exact-match — CSV string would match nothing) | permissive `*` default retained + banner `○ CORS` + WARN if `NODE_ENV=production` |
| `RATE_LIMIT_WINDOW_MS` | **dead** (§1.3) | fixed-window size in ms; both vars required together (partial config → limiter off + banner note) | limiter off (zero-config dev unaffected) |
| `RATE_LIMIT_MAX_REQUESTS` | **dead** (§1.3) | max requests per key (XFF first hop, fallback `local`) per window | idem |
| `WEBHOOK_SECRET` | **new** | HMAC-SHA256 key over raw body; header `x-webhook-signature: sha256=<64-hex>` | `/hooks/*` registered, rejects every request `401` (fail-closed) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | **new** | OTLP collector URL → `OtelExporter` (`custom` provider; both configs) | observability byte-equal to today (Scenario 5) |

**Known limitations (banner + README gotcha + root AGENTS.md gotchas list):**
1. The rate limiter is **in-process memory**; `docker/docker-compose.prod.yml` runs `api: deploy.replicas: 3` ⇒ effective cluster limit ≈ `3 × RATE_LIMIT_MAX_REQUESTS` and per-replica counters. Redis-backed global limiting is an **unassigned follow-up riding on Spec 02's `REDIS_URL` convention** (Spec 02's Non-goals explicitly exclude rate limiting/RedisCache — it ships only the pubsub builder; §1.2 note).
2. Global `server.middleware` **does not run** on `requiresAuth: false` routes (verified in `@mastra/core` types + docs) — hence the webhook carries its own limiter/signature middleware.

**Banner additions** (`logServiceAvailability` stays in sync — root AGENTS.md rule):

```
○ CORS             permissive default '*' — set CORS_ORIGIN in production
○ Rate limiting    disabled (set RATE_LIMIT_WINDOW_MS + RATE_LIMIT_MAX_REQUESTS)
○ Webhook signing  no WEBHOOK_SECRET — /hooks/* rejects 401
○ OTLP export      set OTEL_EXPORTER_OTLP_ENDPOINT to export
```

### 3.8 Estimated Impact (estimate; bounded by grep — nothing under `src/` imports route/middleware symbols today, so no call-site churn outside the composition root)

* **New (15 files):** `src/mastra/routes/{index,webhook,health,stream}.ts`, `src/mastra/routes/hono-variables.d.ts` (ContextVariableMap augmentation — 08-1), `src/mastra/routes/middleware/{webhook-signature,rate-limit,request-context}.ts`, `src/mastra/shared/events/webhook-events.ts`, `src/mastra/routes/AGENTS.md`, `examples/stream-consumer.mjs`, `tests/unit/routes/{webhook-signature,rate-limit,middleware-overhead.bench}.test.ts`, `tests/integration/http-surface.test.ts` → ~660 LOC.
* **Modified (6 code/config files + 5 doc files):** `src/mastra/index.ts` (+~10), `shared/config/observability.ts` (+~40), `shared/events/index.ts` (+1), `.env.example` (+~16/-4 — own DoD box), `package.json` (deps: `@mastra/ai-sdk`, `ai`; devDep `@mastra/client-js`), `tests/smoke/boots.test.ts` (+~40 new cases, existing ones untouched), then docs: root `AGENTS.md`, `README.md`, `tests/AGENTS.md` (`RUN_HTTP_TESTS` opt-in — 08-4), `src/mastra/AGENTS.md`, `shared/AGENTS.md` (+~95).
* **Total: ~875 LOC added/modified across ~26 files** (~650 code+tests, ~225 docs/config).

### 3.9 Definition of Done (DoD)

**Acceptance criteria → tests (each Phase-2 scenario maps to ≥1):**

- [ ] **Smoke** (`tests/smoke/boots.test.ts` extended; zero-env, offline, deterministic): boots; `mastra.getServer()?.apiRoutes` contains exactly `/hooks/:source`, `/health/version`, `/stream/:agentId` (POST/GET/POST; webhook + health `requiresAuth === false`); health handler invoked with a minimal stub context returns `status:'ok'`; webhook handler chain returns the **exact** body `{"error":"invalid webhook signature"}` with `401` when `WEBHOOK_SECRET` is unset (Scenario 2 instance); `buildObservability` with no env returns today's exporter set (Scenario 5); existing assertions untouched.
- [ ] **Unit** (`tests/unit/routes/webhook-signature.test.ts` — mirrors source layout per `tests/AGENTS.md`): golden vector (fixed secret + fixed body → fixed `sha256=…`), reject on tampered body / wrong secret / malformed header, unset-secret middleware short-circuit. `tests/unit/routes/rate-limit.test.ts`: fake clock — N pass, N+1 → `429` + `Retry-After`, reset after window, no-op when vars unset/partial. Deterministic, no network.
- [ ] **Integration** (`tests/integration/http-surface.test.ts`): **new server-spawn harness** (`npm run dev`-style boot on a test port, torn down after; borrows the `describe.skipIf(...)` idiom from `scope-guard-live.test.ts`, gated on `process.env.RUN_HTTP_TESTS` and — for Scenario 4 only — the same provider-key check): real `POST /hooks/test` valid signature → `200` exact shape + bus subscriber assert (Scenario 1); bad signature → `401` exact shape (Scenario 2); `OPTIONS` preflight allowed/denied header assertions (Scenario 3); streaming `Content-Type: text/event-stream` + first `data:` frame `"type":"start"` (Scenario 4); burst over `RATE_LIMIT_MAX_REQUESTS` → `429`.
- [ ] **Gate opt-in wiring (gate finding 08-4 — a skipped-forever suite is a lying suite):** `tests/AGENTS.md` documents `RUN_HTTP_TESTS=1 npm run test:integration` as the explicit opt-in for `http-surface.test.ts` (what it needs: free port, built artifact or dev boot, provider key only for Scenario 4), **and** the PR names its CI vehicle: a proposed scheduled job (weekly, alongside the existing `auto-update` cadence) running the HTTP tier with `RUN_HTTP_TESTS=1` — or, if Spec 07's live-tier job lands first, piggyback there and cross-reference. Never leave the gate variable set by nobody.
- [ ] **Perf bench artifact (gate finding 08-5 — NFR needs a home):** `tests/unit/routes/middleware-overhead.bench.test.ts`, following Spec 06's `security-stack.bench.test.ts` pattern (unit-level, in-process, **non-CI-gated**): times N ≥ 1000 stubbed `app.fetch()` calls with vs without `requestContextPopulator` and records the with/without delta; the Phase 5 < 5 ms p95 figure stays a **PROPOSAL** threshold until the bench's first numbers are reviewed (same convention as Spec 06's NFR-1).
- [ ] `.env.example` updated — its own box, not just §3.7's table (gate finding 08-6): add `WEBHOOK_SECRET` + `OTEL_EXPORTER_OTLP_ENDPOINT` with their semantics; **re-comment `CORS_ORIGIN` / `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` as RESURRECTED-by-this-spec — this closes gap §1.3's last server-surface dead vars.**
- [ ] Evals tier untouched.
- [ ] Input/Output payload validation implemented: zod on webhook body (`{event,data}`) and stream body (`messages[]`, optional memory); malformed JSON → `400 {"error":"invalid webhook payload"}` / `{"error":"invalid stream payload"}`.
- [ ] `--legacy-peer-deps` respected for the new deps (`@mastra/ai-sdk`, `ai`) + devDep (`@mastra/client-js`); `package-lock.json` stays committed; full gate re-run after any bump (root AGENTS.md rule).
- [ ] Docs: root `AGENTS.md` service table gains **CORS, Rate limiting, Webhook signing, OTLP export** rows (each with "activated by" + fallback columns); **gotchas list** gains the per-process rate-limit caveat (+ `replicas: 3` ⇒ ×3) and the "user middleware skips `requiresAuth:false` routes" trap — numbered as the next free gotcha entries at merge time (other in-flight specs may claim numbers first); `README.md` gains an **"API surface — built-in vs custom"** section (built-in: `/health`, `/api/agents|workflows|tools|memory|observability/*`; custom: `POST /hooks/:source`, `GET /health/version`, `POST /stream/:agentId` with their auth flags); `src/mastra/routes/AGENTS.md` created + `src/mastra/AGENTS.md` subdirectory row updated; `docker/docker-compose.prod.yml` api service gains a `CORS_ORIGIN=${CORS_ORIGIN:-}` env pass-through next to the existing `MASTRA_JWT_SECRET` (prod deployments supply a real list; unset keeps the WARN path); README documents `@mastra/otel-exporter` (+ protocol peer packages) as the optional OTLP companion and links Metrics overview; the rate-limit caveat is recorded in **both** README and root AGENTS.md gotchas.
- [ ] ADR: none (justified in §3.0 — feature-level integration, not an architectural decision).
- [ ] Full gate green: `npm run lint` (0 errors / 0 warnings) · `npx tsc --noEmit` · `npm run test:all` · `npm run build` · `timeout 15 npm run dev` shows the four new banner lines.
- [ ] Work on a branch named `feat/custom-routes-streaming-otlp` (repo convention `feat/<slug>`).
- [ ] Commits staged every 400–800 LOC; never exceed 1400 LOC per commit (suggested: 1) routes+middleware+composition, 2) OTLP+streaming deps+example, 3) tests+docs).
- [ ] Business tests written where applicable; manual/browser verification (curl demos, banner eyeball, Studio stream) left to the user.

## Phase 4: Risks & Open Questions

* **Risks (3):**
  1. **Open webhook route abused before Spec 01 auth lands.** `/hooks/:source` is `requiresAuth:false` by design and today's server has no auth at all. *Mitigation:* fail-closed 401 when `WEBHOOK_SECRET` is unset (Scenario 2), route-scoped rate limiter (global middleware can't cover public routes — verified), the handler executes **no** domain logic itself (one `eventBus.publish` of a bounded `{event,data}` envelope), and this spec's Depends-on header makes the ordering explicit for roadmap planning.
  2. **Streaming API surface churn in Mastra** (vNext→standard migration pages still ship in the 1.66 bundle; `toAISdkStream` carries a `version: 'v5'|'v6'|'v7'` flag; route helpers like `chatRoute()` compete with hand-rolled routes). *Mitigation:* pin only the current documented surface from §3.1 (`agent.stream()` + `toAISdkStream` from `@mastra/ai-sdk`), and let the two cheap canaries — smoke's `apiRoutes` presence check and integration's content-type/first-chunk-type assertion — fail loudly on renames; the weekly `@mastra/codemod` CI job catches deprecations before a human does.
  3. **OTLP exporter dependency conflicts.** `@mastra/otel-exporter` plus protocol peers (`@opentelemetry/exporter-trace-otlp-*`, `@grpc/grpc-js`) are classic ERESOLVE material (the root-`AGENTS.md` `--legacy-peer-deps` gotcha class). *Mitigation:* never in `dependencies` — operator opt-in only; the guarded `createRequire` probe degrades to storage-only with `○` banner + WARN, so a missing/conflicting package can never block boot, build, or the smoke suite (Scenario 5 is the guard).

* **Open Questions / Decisions (owner noted; dates relative to Phase-8 merge):**
  1. **Further exporter opt-ins — doc-only shortlist, no code:** `@mastra/langfuse` (`LangfuseExporter`, seen in the OtelBridge doc), `@mastra/datadog`, PostHog/S3-archive exporters as future one-line companions. Decide **before Phase 8 merge** whether README lists them (recommended: yes, table only — presets creep toward forced surface). Owner: boilerplate maintainer.
  2. **Generic envelope vs per-source mappers.** v1 publishes one `webhook.received`; should example source-mappers (Stripe → `research.started`?) ship? Recommendation: keep v1 generic + one documented subscriber in `examples/`; decide **by Phase 8 merge**, owner: boilerplate maintainer.
  3. **Rate-limit key trust behind proxies.** XFF first-hop is spoofable without a trusted-proxy setting; revisit if/when the unassigned Redis-limiter follow-up (riding on Spec 02's `REDIS_URL` convention — outside Spec 02's scope) is scheduled. Decide **before Phase 8 merge** whether to open a tracking issue for it, owner: platform reviewer.
  4. **Confirm no `docker/` healthcheck change needed** for `/health/version` (compose currently curls built-in `/health`) — trivial doc-level check **before merge**, owner: implementer.
  5. **PROPOSED items awaiting the parent/owner (D3/D4 could not fire in this subagent):** the KR wording (Phase 1), and every §3.0 decision that filled or overrode a brief assumption — above all the **root-level route paths**, which are *forced* by Mastra 1.66's boot-time `apiPrefix` validation (evidence in §3.0), not a preference; a `/api/...` custom route makes the server refuse to start.

## Phase 5: Non-Functional Requirements

* **Performance:** global `requestContextPopulator` adds **< 5 ms p95** per request — a **PROPOSAL** threshold until reviewed, measured by the named artifact `tests/unit/routes/middleware-overhead.bench.test.ts` (non-CI-gated; N ≥ 1000 stubbed `app.fetch()` calls, with/without-middleware delta — relative order-of-magnitude bound, CI-noise tolerant; Spec 06 `security-stack.bench.test.ts` pattern); rate-limiter lookup is O(1); `verifySignature` on a 64 KB body ≤ 1 ms (single `createHmac` + two 72-byte compares — asserted by a loose unit-test bound, not a stopwatch gate).
* **Security:** HMAC uses `timingSafeEqual` on equal-length fixed-shape buffers (length check is over the shared `sha256=` prefix shape only — no meaningful timing oracle); an unauthenticated webhook **never executes the handler** — every 401/400 path provably precedes `eventBus.publish` (spy-asserted, Scenario 2); no secret or signature value in logs/banner (presence only); OTLP `headers` (SaaS keys) must never be echoed in logs; `/stream/:agentId` ships with default `requiresAuth` (protected once Spec 01 lands) and no key material in the URL (messages travel in the POST body, not the query string).
* **Reliability / Availability:** unset-everything boot equals today's behavior (Scenario 5; smoke unmodified); an `OtelExporter` that throws on connect/export must not take down request handling (Mastra's observability layer catches exporter failures — integration asserts the server still answers `/health/version` after pointing `OTEL_EXPORTER_OTLP_ENDPOINT` at a dead port); rate-limiter state loss on restart is accepted (best-effort, per-process — documented).
* **Accessibility / Compatibility:** Accessibility: **N/A** (no UI surface — explicitly not deleted per template rule). Compatibility: Node ≥ 22.13 (existing engines); every symbol used exists in the installed `@mastra/core@1.66.0` (verified in §3.1 against typings + bundled docs); all installs keep `--legacy-peer-deps` (new peers included); built-in routes, Studio, and LibSQL/Postgres modes untouched; the three previously-dead §1.3 vars gain meaning without changing format (`CORS_ORIGIN=http://localhost:3000` keeps working as written in `.env.example`).
