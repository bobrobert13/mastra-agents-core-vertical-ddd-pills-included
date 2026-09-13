# Production Gap Analysis — mastra-boilerplate vs. professional Mastra deployments

<!-- Assessment: 2026-09-15 | Verified against: @mastra/core 1.66.0, mastra CLI 1.29.0 | Canonical docs: mastra.ai/docs -->

Goal: identify what a serious full-scale Mastra working environment **actually needs** that this
boilerplate lacks — and what deliberately should NOT be added even though the ecosystem offers it.

Every claim below was verified against the repository code and the official Mastra 1.x docs.

---

## 0. Short verdict

The architecture (vertical slices, env-optional infrastructure, scope guards, test pyramid,
renovate/codemods) is above average. The real problem is different: **the boilerplate nails the
"how to organize code" but misses four core production Mastra capabilities — Auth, real
PubSub/Workers, MCP and Vectors/RAG — and ships parts that are currently decorative**
(HA that cannot work, tools that don't persist, dead env vars).

---

## 1. Critical findings: things declared but NOT working

These come first because a boilerplate that falsely promises something is worse than one that
doesn't promise it at all.

### 1.1 The "Production HA" stack cannot work as-is
`docker/docker-compose.prod.yml` starts workers with `MASTRA_WORKERS=orchestration|scheduler|background`,
but per [Workers](https://mastra.ai/docs/deployment/workers):

- A split-process deployment **requires a distributed PubSub backend** (`RedisStreamsPubSub` from
  `@mastra/redis-streams`, `ValkeyStreamsPubSub` or `GoogleCloudPubSub`) registered via
  `new Mastra({ pubsub })`. There is no Redis in the compose and no `pubsub` config in
  `src/mastra/index.ts` → the orchestration worker has nothing to pull workflow events from.
- The valid value is **`backgroundTasks`**, not `background` (official `MASTRA_WORKERS` value table).
- Workers must run the artifact produced by `mastra worker build --output-dir .mastra/worker`, not
  the `mastra build` API bundle; the Dockerfile only produces the latter.
- `MASTRA_STEP_EXECUTION_URL=http://api:4111/api` must be set on the orchestration worker (the var
  exists in `.env.example`, dead) plus `MASTRA_WORKER_AUTH_TOKEN` aligned with the API auth.

**Fix:** add `redis` to the compose, a `config/pubsub.ts` builder following the env-optional pattern
(`REDIS_URL` → `RedisStreamsPubSub`, unset → in-process default), a worker-artifact build step, and
correct `backgroundTasks`. This also unlocks §3.2 below.

### 1.2 `eventBus` is single-process while the deployment declares 3 API replicas
`shared/events/event-bus.ts` is an `EventEmitter`: with `replicas: 3` + split workers, an event
published in process A never reaches a subscriber in process B. The cross-domain communication
documented as a central pattern (ADR-003) is only real inside one process.

**Fix (two steps, both needed):**
1. State the limitation explicitly in `shared/AGENTS.md` and ADR-003 (it currently misleads).
2. Bridge the bus to Mastra's `pubsub` when `REDIS_URL` is set (the same
   `PubSub`/`EventEmitterPubSub` primitives the runtime uses —
   [reference](https://mastra.ai/reference/pubsub/base)). The event-bus keeps its current API and
   gains multi-process reach through the very env-optional pattern that is this repo's signature.

### 1.3 Dead environment variables
Verified by grep: `MASTRA_JWT_SECRET`, `CORS_ORIGIN`, `RATE_LIMIT_WINDOW_MS`,
`RATE_LIMIT_MAX_REQUESTS`, `MASTRA_STEP_EXECUTION_URL` **are never read in any file under `src/`**.
`ENABLE_MULTI_REGION` is self-declared "reported as ignored". A boilerplate with knobs that do
nothing trains its cloner to distrust `.env.example`.

**Fix:** make each one real (auth → §2.1, CORS/rate-limit → middleware §2.4, step-execution → §1.1)
or delete it (`ENABLE_MULTI_REGION`: deleting is legitimate — multi-region replication is a DB
infrastructure decision, not a Mastra feature).

### 1.4 The task-management tools do nothing
`create-task.ts` generates an id with `Math.random()` and **persists nothing**;
`update-task`/`schedule-task` likewise. The domain is advertised as "Task entity with lifecycle
events" but there is no entity store.

**Fix:** real persistence via custom tables in the Mastra storage adapter
([Storage overview](https://mastra.ai/reference/storage/overview) — `getStore()` + drizzle custom
tables on the same `DATABASE_URL`), or real scheduling through `mastra.schedules` (§2.5). This is
the canonical example everyone clones — if the example lies, the anti-pattern propagates.

---

## 2. Missing Mastra capabilities a complete working environment requires

### 2.1 Server & Studio auth — priority #1
Today `new Mastra({ server: { host: '0.0.0.0' } })` has **no `auth`**: every `/api/agents/*`,
`/api/workflows/*` route and the Studio itself are public by design ("If no auth is configured,
all routes and Studio are publicly accessible" — [Auth](https://mastra.ai/docs/auth/overview)).
The "production HA" deployment exposes agent/workflow execution to whoever reaches the port.

**Add (following the env-optional pattern):**
- `config/auth.ts`: with `MASTRA_JWT_SECRET` → built-in **JWT auth** (Studio login + protected
  routes); with `AUTH_PROVIDER=clerk|supabase|auth0|workos|firebase|okta|better-auth|google` → the
  matching integration (all under docs/auth). No env → no auth but a loud **banner warning**
  (the scope guard's "inert" pattern already exists).
- Worker token: accept `MASTRA_WORKER_AUTH_TOKEN` from the orchestration worker
  ([Workers auth](https://mastra.ai/docs/auth/workers)).
- Point to Fine-Grained Authorization as the next level for teams with roles
  ([FGA](https://mastra.ai/docs/auth/fga)).

### 2.2 MCP (`@mastra/mcp`) — the ecosystem's standard connector
Large projects don't hand-write 40 integrations: they consume **MCP servers** and expose their own
system as an **MCP server** ([docs](https://mastra.ai/docs/connections/mcp)). It fits the repo's
philosophy exactly:

- `MCPClient` configured from a JSON env var
  (`MCP_SERVERS='{"wikipedia":{"command":"npx","args":["-y","wikipedia-mcp"]}}'`) → static tools
  (`listTools()`) or per-request toolsets (`listToolsets()` with user credentials via requestContext).
- `requireToolApproval` (boolean or `({ toolName }) => ...` callback) for dangerous tools —
  directly connects to the gotcha #7 incident pattern.
- An `MCPServer` exposing the boilerplate's agents/tools/workflows: any MCP client (Claude, IDEs,
  teammates' agents) consumes your system without a proprietary SDK.
- Security: `allowedHosts`, `inheritDefaultEnv: false` — document them in the corresponding ADR.

### 2.3 Vectors + RAG + semantic recall — pgvector installed and unused
The compose ships `pgvector/pgvector:pg16`… and the code never creates a vector index. Three
always-used production capabilities are missing:

1. **`semanticRecall` on Memory** ([docs](https://mastra.ai/docs/memory/semantic-recall)): today
   Memory only retrieves recent messages; agents "forget" long threads. Config:
   `new Memory({ vector: new PgVector(...), embedder: new ModelRouterEmbeddingModel('openai/text-embedding-3-small'), options: { semanticRecall: { topK, messageRange, scope: 'resource', indexConfig: { type: 'hnsw' } } } })`.
   For the zero-config key-less mode: `@mastra/fastembed` (local, multilingual E5 — ideal for a
   project answering in Spanish).
2. **A `knowledge` domain (real RAG)** with `@mastra/rag`: `MDocument` + chunking → index docs →
   `createVectorQueryTool()` wired into the research agent → `rerank()`. It is the #1 use case in
   Mastra's official use-cases page (chat-with-docs) and the best slice example featuring an
   indexing worker.
3. **`vectors` registered on `new Mastra({ vectors })`** so Studio/`getVector()` see them.

All behind `EMBEDDING_MODEL` / `DATABASE_URL`, with banner and clean degradation to "recall off".

### 2.4 Custom API routes, middleware and request context
A complete team needs endpoints of its own beyond the generated API: inbound webhooks, a chat
endpoint for the frontend, custom health/version.
- `registerApiRoute()` / `createRoute()`
  ([ref](https://mastra.ai/reference/server/registerApiRoute)) with per-route `requiresAuth`, and
  middleware (the server is Hono: CORS from `CORS_ORIGIN`, rate limiting from `RATE_LIMIT_*` —
  resurrect those vars or delete them).
- `requestContext` as the typed per-request identity/tenant channel
  ([Request Context](https://mastra.ai/docs/server/request-context)): it is what connects auth →
  memory `resourceId` → per-user MCP toolsets. Without it, real multi-user doesn't exist.

### 2.5 First-class scheduling (the replacement for the "invented" worker)
[Workflow `schedule`](https://mastra.ai/docs/workflows/scheduled-workflows): `schedule: { cron,
timezone, inputData }` on `createWorkflow` → the scheduler worker picks it up at boot, Studio shows
it at `/workflows/schedules`, and `client.pauseSchedule()` operates it at runtime. Day-1 proof for
the boilerplate: a `daily-digest` workflow with a `schedule` makes the scheduler worker testable.
The `schedule-task` tool in task-management should create real schedules via `mastra.schedules`,
not return a pretty object.

### 2.6 Human-in-the-loop with suspend/resume (not just an ask tool)
`ask_user` replies with text; in production a workflow **suspends**: `suspendSchema` +
`step.suspend()` + `run.resume()` ([docs](https://mastra.ai/docs/workflows/suspend-and-resume)),
persisted in storage (survives restarts), visible in Studio, operable from `@mastra/client-js`.
Natural boilerplate use case: approving `file-operations` writes and MCP tool approvals (§2.2).
There is also `requireToolApproval` at the tool level for the agent-side flow
([HITL agents](https://mastra.ai/docs/agents/human-in-the-loop)).

### 2.7 Built-in guardrails next to the scope guard
The scope guard is an LLM classifier. Mastra ships deterministic processors any serious setup puts
in the pipeline ([Processors](https://mastra.ai/docs/agents/processors)):
- `PromptInjectionDetector` — critical: the research agent and any MCP tool feed **untrusted web
  content** into context.
- `PIIDetector` (output processor) — stop sending emails/addresses to external providers.
- `TokenLimiter` / `TokenCostControl` — per-request budget.
- `ResponseCache` — skips repeated calls; with 4 agents it is real money.
All wireable in `shared/processors/` inside the `inputProcessors` array the repo already enforces
by rule. Cost: ~2 lines per processor. Value: actual defense in depth.

### 2.8 Durable agents / crash recovery (mention even if enabled late)
With split workers, a crash leaves runs stuck in `running`; Mastra offers
`recovery.durableAgents: 'auto'` ([Durable Agents](https://mastra.ai/docs/harness/durable-agents)).
Including it in the config builder (opt-in) is one line and prevents the classic 3am incident.

---

## 3. Engineering quality: what separates a large-scale project from a demo

### 3.1 Evals → datasets + experiments + CI gates
Today: JSON files + structural asserts. Mastra ships **versioned datasets in DB and comparable
experiments** (`mastra.datasets`, `createExperiment()`, `compareExperiments()`,
[docs](https://mastra.ai/docs/evals/datasets)) plus **gates/verdicts** that break CI on quality
regression ([Gates and Verdicts](https://mastra.ai/docs/evals/gates-and-verdicts),
[Running in CI](https://mastra.ai/docs/evals/running-in-ci)). Migrating the current JSON datasets
to the native service is the best effort/value eval upgrade available.

### 3.2 Built-in scorers next to the custom heuristic
`@mastra/evals` ships `answerRelevancy`, `hallucination`, `faithfulness`, `bias`, `toxicity`,
`completeness`, `keywordCoverage`… ([Built-in scorers](https://mastra.ai/docs/evals/built-in-scorers)).
The heuristic `relevance-scorer` keeps its role as a fast deterministic offline gate, but large
setups run LLM judges over the dataset. Registering them on each agent's `scorers` also surfaces
them in Studio.

### 3.3 CI: add typecheck and a coverage gate
`npx tsc --noEmit` is documented as a rule in AGENTS.md but **is not in `ci.yml`** (verified: only
lint/build/test-*). Add a `typecheck` job + `vitest --coverage` with a minimum threshold (e.g. 80%
on `src/mastra/shared`).

### 3.4 Zod env validation (fail fast without breaking zero-config)
One `shared/config/env.ts` parsing `process.env` through a Zod schema: a malformed string
(`DATABASE_URL` missing `postgres://`) → actionable error at boot instead of weird runtime behavior.
Respects the golden rule: everything optional, but whatever is present must be valid.

### 3.5 Streaming as a product API
`agent.stream()` / `workflow.stream()` + `toAISdkStream` for frontends
([Streaming](https://mastra.ai/docs/guides/streaming)). The boilerplate only exercises `generate()`.
A full React app is not needed: one example route consumed via `@mastra/client-js` (or the AI SDK
integration) answers 90% of "how do I connect this to my UI?" questions.

### 3.6 Exportable observability (OTLP)
The storage-only exporter is fine for dev; large teams centralize traces in Jaeger/Tempo/Datadog/
Langfuse. In `config/observability.ts`: add an OTel bridge/OTLP exporter opt-in via
`OTEL_EXPORTER_OTLP_ENDPOINT` — one line per exporter, no forced deps. Automatic
**Metrics** ([docs](https://mastra.ai/docs/observability/metrics/overview)) is also off the repo's radar today.

---

## 4. What should NOT be added (anti-filler)

| Mastra feature | Why it does NOT belong in a general boilerplate |
|---|---|
| Voice (`@mastra/voice`) | A product vertical; pulls LiveKit/TTS deps nobody uses on day 1 |
| Channels (Slack/Telegram/WhatsApp) | Business integration, not infrastructure |
| Browser/Stagehand | Heavier than its example value; real browsing depends on own infra |
| A2A / ACP / SDK agents | Exotic connectors; MCP (§2.2) covers the standard case |
| Code Mode, Skills, Sandboxes | For coding agents; out of this boilerplate's domain |
| Inngest / Temporal runners | Alternative runners: mention in docs, don't install |
| Third-party auth providers as the default | Keep as a pointer from built-in JWT (§2.1) |

The rule worth writing into the README: *"the boilerplate only ships primitives every project will
need in production; vertical features stay as doc pointers."*

---

## 5. Suggested execution order

| Phase | Deliverable | Breaks something today |
|---|---|---|
| 1 | Auth (built-in JWT + worker token) + delete/resurrect dead env vars + drop `ENABLE_MULTI_REGION` | Yes: security |
| 2 | `config/pubsub.ts` (Redis, env-optional) + compose worker fixes (`backgroundTasks`, `MASTRA_STEP_EXECUTION_URL`, worker build) | Yes: fake HA |
| 3 | `semanticRecall` + `vectors` + fastembed fallback | No — memory upgrade |
| 4 | MCP client (env JSON) + example MCPServer + `requireToolApproval` | No |
| 5 | Real task-management persistence + declarative `schedule` on one workflow | No |
| 6 | Built-in guardrails (PromptInjectionDetector, PIIDetector, TokenLimiter, ResponseCache) + HITL suspend/resume in a workflow | No |
| 7 | Native evals (datasets/experiments + CI gates) + typecheck job + Zod env | No |
| 8 | Example custom route (webhook + `requiresAuth:false`) + streaming + OTLP opt-in | No |

Every phase must keep the existing rules: env-optional + availability banner + `test:all` green +
AGENTS.md updated (including the gotchas tree).
