<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# mastra-boilerplate

## Purpose

Project-agnostic Mastra boilerplate built on **vertical slicing / DDD**: four example agent domains plus a workflow-only knowledge slice (chat-with-docs, spec 03), infrastructure that is **100% optional and env-driven**, high-availability Docker deployments, comprehensive testing (smoke + unit + integration + evals), and a self-updating toolchain (Renovate + changesets + Mastra codemods). Clone it, delete the example domains you don't need, and start building.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Scripts, deps. **All `npm install` must use `--legacy-peer-deps`** (peer conflicts with @mastra/evals) |
| `tsconfig.json` | TS strict mode; path aliases `@mastra/*` |
| `eslint.config.js` | ESLint 9 **flat config** (`.eslintrc.json` is obsolete — do not recreate) |
| `.env.example` | Every variable is OPTIONAL; app runs with zero config |
| `vitest.config.ts` | Vitest 3.x (required by @mastra/evals) |
| `AGENTS.md` | This file — hierarchical docs index |
| `README.md` | Human-facing quickstart |
| `PHASE-1-COMPLETION.md` / `PHASE-2-COMPLETION.md` / `PROJECT-COMPLETION.md` | Build-phase records |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/mastra/` | All source: domains + shared (see `src/mastra/AGENTS.md`) |
| `tests/` | unit / integration / evals suites (see `tests/AGENTS.md`) |
| `docker/` | Dockerfile + compose dev/prod HA (see `docker/AGENTS.md`) |
| `scripts/` | init, health-check, self-update bash scripts (see `scripts/AGENTS.md`) |
| `docs/` | ADRs, domain docs, testing guide (see `docs/AGENTS.md`) |
| `.github/` | CI workflows + Renovate config |

## Documentation Hierarchy (index)

```
AGENTS.md                        ← you are here (rules, conventions, updates, deploy)
├── .github/AGENTS.md            ← CI gates + self-update pipeline
├── docker/AGENTS.md             ← container/dev-HA/prod-HA deployment
├── docs/AGENTS.md               ← ADR + domain docs conventions
│   ├── adr/AGENTS.md
│   └── domains/AGENTS.md
├── scripts/AGENTS.md            ← operator bash scripts
├── src/mastra/AGENTS.md         ← app composition
│   ├── domains/AGENTS.md        ← vertical-slice rules
│   │   ├── research/AGENTS.md
│   │   ├── task-management/AGENTS.md
│   │   ├── file-operations/AGENTS.md
│   │   └── communication/AGENTS.md
│   └── shared/AGENTS.md         ← logger, event bus, optional-infrastructure engine
└── tests/AGENTS.md              ← test pyramid + known pitfalls
```

## How It Works — Optional Infrastructure

**Rule: no env var ⇒ no error, the service is simply inactive.** The composition root is `src/mastra/shared/config/infrastructure.ts`; each service builder lives in its own module (`storage.ts`, `vectors.ts`, `observability.ts`, `pubsub.ts`, `auth.ts`, `providers.ts`, banner in `service-status.ts`, model resolution in `model.ts`, schedules reporting in `schedules.ts`):

| Service | Activated by | Fallback when unset |
|---------|-------------|---------------------|
| Storage: PostgreSQL | `DATABASE_URL` (starts with `postgres`) | — |
| Storage: LibSQL custom | `LIBSQL_URL` (only if no DATABASE_URL) | — |
| Storage: default | — | LibSQL local `file:./mastra.db` |
| Vector store | follows storage: `DATABASE_URL` postgres → PgVector; else LibSQLVector | always built unless `SEMANTIC_RECALL=off` (ADR-006) |
| Semantic recall | embedder available (`EMBEDDING_MODEL` → ModelRouter; unset → local fastembed E5, key-free) | `○ Semantic recall  off (no embedder)` — generate unaffected, plain history only |
| Knowledge RAG | same embedder condition | `index-knowledge` workflow + `search_knowledge` tool registered / `off (no embedder)` |
| PubSub (workers HA) | `REDIS_URL` → Redis Streams (ADR-005; also bridges the domain event bus across processes) | in-process EventEmitterPubSub; split workers unavailable |
| Auth (Server & Studio) | `MASTRA_JWT_SECRET` (+ `MASTRA_WORKER_AUTH_TOKEN` → worker bearer via CompositeAuth) | dev: inert + ⚠️ UNAUTHENTICATED banner line; **production: FATAL exit(1)** unless `AUTH_DISABLED=true` (ADR-004) |
| Observability | enabled by default | disable with `ENABLE_OBSERVABILITY=false` |
| Chat request trace | default ON outside production (`CHAT_TRACE=on|off` overrides) | `CHAT_TRACE=off` — the `/chat/:agentId` pipeline trace goes silent (diagnostics only, nothing else watches it) |
| Model providers | any of `DEEPINFRA_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` | agents 401 at call time, app still boots |
| Model selection | `MODEL` / `MODEL_<AGENT>` / `DEFAULT_MODEL` (see `shared/config/model.ts`) | built-in default `openai/gpt-4o-mini` |
| Eval datasets/experiments | `EVAL_STORAGE_URL` (seed script default `file:./eval-ci.db`; suites default `:memory:`) | native `mastra.datasets` storage domain (ADR-010); git JSON = reviewed seed source |
| Eval judge model | `EVAL_JUDGE_MODEL` (> `MODEL` > `DEFAULT_MODEL`) | judges only; code-based scorers never call a model (spec 07) |
| Scope guard | on by default (`SCOPE_GUARD_MODEL` optional) | `SCOPE_GUARD=off` disables; inert (fail-open) with no provider key |
| MCP client (inbound) | `MCP_SERVERS` (JSON; `${VAR}` interpolation; `agents` routing key) | `○ MCP client` off — set `MCP_SERVERS` to connect external servers; set-but-invalid JSON **fails boot** (spec 04) |
| MCP server (outbound) | `ENABLE_MCP_SERVER=true` (exact string) | `○ MCP server` disabled — read-only surface; requires Spec 01 auth outside localhost |
| Guardrails (spec 06) | on by default; LLM detectors (injection/PII) need a provider key | `○ Guardrails …` — `SECURITY_PROCESSORS=off` removes all but the scope guard; TokenLimiter/ResponseCache/workspace jail stay active keyless |
| Webhook signing | `WEBHOOK_SECRET` | `○ Webhook signing` — `/hooks/*` registered but fail-closed 401 |
| CORS | `CORS_ORIGIN` (CSV allow-list) | `○ CORS` — permissive `'*'` default; production+unset ⇒ extra WARN (never fails boot) |
| Rate limiting | `RATE_LIMIT_WINDOW_MS` **and** `RATE_LIMIT_MAX_REQUESTS` | `○ Rate limiting` — limiter off (zero-config unchanged); partial config ⇒ off + banner note |
| OTLP export | `OTEL_EXPORTER_OTLP_ENDPOINT` (+ dev-installed `@mastra/otel-exporter`) | `○ OTLP export` — storage-only exporters byte-stable |

At startup the server prints a **service availability banner** (✅ active / ○ inactive per service). Keep it in sync when adding optional services.

## For AI Agents

### Working In This Directory
- **Vertical slices**: everything a domain needs lives inside its folder. Domains NEVER import from other domains — cross-domain traffic goes through the shared event bus.
- Only truly cross-cutting code goes in `src/mastra/shared/`.
- **Use `buildDomainAgent()` for creating agents** (see [Creating an Agent](#creating-an-agent) below). It enforces the Spec 06 hard rule automatically: processor arrays come from `buildSecurityStack()` (scope guard = slot 0), `inputProcessors` AND `outputProcessors` are wired, plus `scopedInstructions(scope, body)` is applied. Hand-assembling a bare `[scopeGuard]` array or omitting `outputProcessors` violates the rule. Positive-only instructions are forbidden — a capable model will otherwise answer anything. Each domain exports its `DomainScope` (plain data; siblings listed without imports) and its `*SecurityStack` (structural wiring test).
- **Use `createEvent()` + `makeEvent()` for domain events** (see [Domain Events](#domain-events) below). Eliminates the `type`/`payload`/`timestamp` boilerplate across event definitions; `makeEvent` auto-sets the timestamp and derives the `type` from the marker so there's no string duplication.
- **Use `requireAppDb(toolId)` for persistence tools** — throws a typed MastraError when no DB is available, replacing the repeated `getAppDb()` + null-check + `new MastraError(...)` pattern across task tools.
- Register new agents in `src/mastra/index.ts` (agents map) — and new workflows in its `workflows` map (unregistered workflows stay invisible to `/api/workflows`; this actually happened with `deep-research`). Storage/observability wiring is already automatic.
- Memory-enabled agents require `memory: { thread, resource }` in raw API generate calls; Studio supplies it automatically.
- Off-topic input to a scoped agent returns empty text with a `tripwire` reason (the abort redirect) — the guard working, not a bug.
- **Never hard-code infra requirements**: new services must follow the env-optional pattern above and report status in the banner.

### Testing Requirements (before any commit)
```bash
npm run lint             # eslint src --max-warnings=0 → 0 errors / 0 warnings
npx tsc --noEmit         # covers src + tests
npm run test:all         # smoke → unit → integration → evals
npm run build            # outputs .mastra/output/ (NOT dist/)
timeout 15 npm run dev   # verify boot + banner + /api/workflows, then kill
```

### GitHub Conventions
- **Commits**: Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`, `ci:`). Subject ≤ 72 chars, imperative mood, body only when the *why* isn't obvious.
- **Branches**: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.
- **PRs**: title follows commit convention; description = Summary bullets + Test plan checklist.
- **CI gates** (`.github/workflows/ci.yml`): lint, typecheck, build, coverage, test-smoke, test-unit, test-integration, test-evals — **all blocking** (spec 07; `coverage` = `npm run test:coverage:gate`, thresholds in `vitest.config.ts`: statements/lines ≥ 74, branches ≥ 70, functions ≥ 55, ratchet-only). LLM-judge experiments run in a separate non-merge-gating workflow (`.github/workflows/evals-live.yml`: schedule + dispatch + push main). A PR is mergeable only when all pass. `package-lock.json` **must stay committed** (jobs use `npm ci` + workflow-level `npm_config_legacy_peer_deps=true`).
- Do not commit `.env`, `*.db*`, `.mastra/`, `node_modules/` (already gitignored).

### Updating Dependencies (self-update system)
- **Renovate** (`.github/renovate.json`) opens grouped PRs for `@mastra/*` and deps.
- **`npm run update`** (`scripts/update-mastra.sh`) bumps all Mastra packages at once.
- **Weekly codemod job** (`.github/workflows/auto-update.yml`) runs `npx @mastra/codemod@latest` and files an issue on findings.
- **changesets** (`npx changeset`) records breaking/feature changes for release notes.
- After ANY dependency bump, re-run the full test gate above.

## Environment Gotchas (learned the hard way)

1. `npm install` without `--legacy-peer-deps` fails with ERESOLVE (@mastra/evals ↔ vitest).
2. Built-in Mastra tools (`webSearchTool`, etc.) only support OpenAI/Anthropic/Google/xAI — on any other provider write a custom tool (the DuckDuckGo `web-search.ts` in the research domain is the reference pattern).
3. `Agent` class does NOT expose `tools`/`memory`/`instructions` publicly — unit tests can only assert `id`, `name`, `model`.
4. `@mastra/core/scores` does not exist in current version — scorers use the per-domain pattern in `research/scorers/`.
5. **Never hard-code a model string** — always `agentModel.<key>()` / `memoryModel()` from `shared/config/model.ts` (`provider/model-id` format, e.g. `deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731`, `anthropic/claude-sonnet-4-5`, `ollama/llama3.1`).
6. `mastra build` writes to `.mastra/output/`; scripts referencing `dist/` are wrong.
7. **Agents answer anything unless hard-guarded (real incident 2026-09-13)**: asked "qué pasó en la resurrección de Cristo?", the file-operations agent replied from general knowledge AND hallucinated a `read nonexistent-file` tool call. Positive-only instructions do NOT scope an agent. Fix = `createScopeGuard()` (LLM classifier → `abort()` → TripWire before the model runs; off-topic gets a one-line redirect naming the right agent) + `scopedInstructions()`; guard is on by default (`SCOPE_GUARD=off` to disable) and fails open when no provider key exists (banner shows "Scope guard: inert"). **Policy (2026-09-17, after a client-side incident): OUT is reserved for a SUBSTANTIVE request owned by another domain — conversational input (greetings, thanks, acknowledgements), questions about the agent itself and short follow-ups PASS.** The first prompt was a bare "strict topic classifier" with general-knowledge questions in the out-of-scope list, so a chat client that opens with "hola" got the scope notice on the very first message of a new thread. The contract is the prompt text itself, now an exported pure function (`buildScopeClassifierPrompt()`) so it is provable offline (`tests/unit/shared/processors/scope-guard.test.ts`) plus a live regression in `tests/integration/scope-guard-live.test.ts`.
8. LibSQL does NOT implement the observability **feedback** methods (`listFeedback`, aggregates, write) — Studio's feedback tab 500s without `shared/config/libsql-feedback-compat.ts` being wired into every LibSQL instance. Full feedback surface = PostgreSQL only.
9. **Auth protects `/api/*` + Studio but NOT root `/health`** — defaults are protected `["/api/*"]`, public `["/api","/api/auth/*"]`, and `/health` lives at root, so the compose healthcheck keeps working unauthenticated. With `NODE_ENV=production` and no auth the process refuses to boot (`MASTRA_JWT_SECRET`, or the explicit `AUTH_DISABLED=true` escape hatch). A custom `server.apiPrefix` breaks those defaults — `buildAuth` rewrites protected/public from `MASTRA_API_PREFIX` and warns; any new root-level route is public by default. Studio login (JWT-capable) = Settings → Headers → `Authorization: Bearer <jwt>`.
10. **Prod HA needs `REDIS_URL`** — split workers (orchestration/scheduler/backgroundTasks) do not start against the in-process default (docs); exactly ONE scheduler replica fleet-wide or every cron tick fires twice. The domain `eventBus` bridges cross-process ONLY when `REDIS_URL` is set (ADR-005); without it it is a single-process EventEmitter by design.
11. **`MASTRA_WORKERS=false` silently disables schedules** — a workflow declaring `schedule` (daily-digest → row `wf_daily-digest`) registers but NEVER fires with all workers off; unset the var (dev auto-starts the in-process scheduler) or run one scheduler worker. Also: custom app tables (`app_tasks`) live beside Mastra's own and are created/migrated by the domain repo (`ensureSchema`, additive-only) — NOT by Mastra init/prune (ADR-008).
12. **Sticky vector dimensions** — an index serves one embedder dimension forever. Memory's derived recall index is keyed by the PROBED DIMENSION (`memory_messages[_<dim>]`, indexName unset): cross-dim `EMBEDDING_MODEL` switch silently cold-resets recall (orphan old index — delete manually); same-dim switch (e.g. `text-embedding-3-small` → `ada-002`, both 1536d) silently MIXES vectors with no error. Treat embedder changes as re-index events; the knowledge workflow instead fail-fasts with `VectorDimensionMismatchError` (ADR-006).
13. **fastembed first run downloads a model — and its cache can be POISONED (real incident 2026-09-17)**: the ONNX tarball comes from storage.googleapis.com into `~/.cache/mastra/fastembed-models` (measured: **1.31 GB compressed → `model.onnx_data` 2.24 GB**). The package's `retrieveModel()` does `if (existsSync(modelDir)) return modelDir` and only `unlink`s the `.tar.gz` AFTER a full extraction, so an interrupted download/extraction leaves a directory with **no `model.onnx`** that is never retried — every `doEmbed` throws `Model file not found` forever. Two guards exist now: `buildVectors()` checks the artifacts on disk (boot-knowable after all) and latches the canonical `○ Semantic recall off (no embedder)` line, and `buildDomainMemory()` **probes the embedder before constructing Memory** so a broken embedder degrades the turn to plain history instead of 500ing it (Mastra probes the dimension INSIDE the turn — `Memory.getInputProcessors` → `getEmbeddingDimension`). Repair/pre-warm with **`npm run warm:embeddings`** — `warmup()` from `@mastra/fastembed` only fetches bge-small/base, NOT the multilingual-E5 this repo defaults to. Cache-probe `skipIf` pattern: `tests/integration/semantic-recall.test.ts`. The native binary dep `@anush008/tokenizers` MUST stay in `bundler.externals` (set in `src/mastra/index.ts`) or `mastra build`/`mastra worker build` die on the `.node` analysis.
14. **Recall works keyless; ANSWERING doesn't** — zero-key recall stores/recalls vectors fine (local E5), but `generate()` still 401s without a provider API key. Two different degradations with different banner lines — do not conflate them in tests or docs.
15. **MCP tool responses and tool descriptions are untrusted model input**: `MCP_SERVERS` wires third-party tools into agents without review. Default `requireToolApproval` (`defaultMcpApprovalPolicy`) gates mutating NAMES only (write/edit/delete/remove/drop/create/update incl. camelCase via `toSnake` — `purge_all` dodges it: floor, not ceiling; set `"requireToolApproval": true` wholesale for untrusted servers); `forwardInstructions` stays `false`; the scope guard NEVER inspects tool I/O — Spec 06's `PromptInjectionDetector` is the designated output sanitizer (until then MCP = dev-local trust boundary). The exposed `boilerplate` MCPServer is read-only by construction (ADR-007).
16. **Guardrail detectors HARD-THROW on guard-model failure** (unlike the fail-open scope guard): `PromptInjectionDetector`/`PIIDetector` require a model and are only mounted with a provider key (`SECURITY_MODEL > guardModel()`). `SECURITY_PROCESSORS=log` is false-positive safety ONLY — an outage still 500s; the only outage-safe switch is `off`. Input processors run ONCE before the loop, so same-run tool output is not rescanned — web-fetch's output-boundary scan (Q3) closes it; other tool sources ride spec 04. `TokenCostControl` throws at REGISTRATION without observability storage → `COST_LIMIT_USD`-only.
17. **Jail & approvals caveats (spec 06)**: `WORKSPACE_ROOT` resolves against the PROCESS CWD (dev bundles run from `src/mastra/public/` — set an absolute path in prod); the jail is realpath-checked but carries an accepted symlink-TOCTOU residual (ADR-009). Durable/stored agents cannot serialize function-form `requireToolApproval` — boolean only, and `true` there approves EVERY tool call (function form = regular stream/generate only). `ResponseCache` is per-process in-memory (Redis backend = follow-up on spec 02's convention) and its hits REPLAY tool calls without executing — never mount on mutating agents (`disableResponseCache`).
18. **Custom routes are ROOT-level and global middleware skips public routes**: Mastra 1.66 throws at boot for any `registerApiRoute` path starting with `/api` (`validateCustomRoutePaths`) — the surface lives at `/hooks/:source`, `/health/version`, `/chat/:agentId`. Global `server.middleware` is SKIPPED on `requiresAuth:false` routes (`skipIfFrameworkPublic`) — the webhook carries its own rate limiter + HMAC guard for exactly this reason. `/chat/:agentId` keeps default auth.
19. **Rate limiter is in-process + XFF-trust-naive**: `docker-compose.prod.yml` runs api `replicas: 3` ⇒ effective cluster ceiling ≈ 3× `RATE_LIMIT_MAX_REQUESTS` with per-replica counters that reset on restart; first-hop `x-forwarded-for` is spoofable without a trusted-proxy hop count in front. Redis-backed global limiting is an unassigned follow-up riding on Spec 02's `REDIS_URL` convention. Webhooks fail closed (401) with no `WEBHOOK_SECRET` — never open.
20. **A chat turn costs MORE than one model call, and the extras were invisible**: `POST /chat/:agentId` runs the scope guard (1), the injection detector (one call **per message in context**), the agent itself, and the online LLM judges wired straight into `new Agent({ scorers })`. Two defaults made that expensive for no benefit: `PromptInjectionDetector.lastMessageOnly:false` re-scanned up to ~11 already-scanned history messages every turn (now `true`; the in-run gap stays covered by `scanToolOutputForInjection`), and the judges ran on **every** live run (now `sampling: {type:'ratio'}` at `EVAL_ONLINE_SAMPLING_RATE`, default 0.1 — Mastra hashes the traceId, so it is deterministic per run). The eval GATES are unaffected: they build their own entries from `AGENT_SCORER_MATRIX`. When adding a processor here, ask which side of the model boundary it sits on — `processInput` runs before the cache and is paid every turn.
21. **The `/chat/:agentId` stream does not START until the guardrail prelude finishes — and that prelude costs 9-20 s measured with DeepInfra**: `chatRoute` awaits `agent.stream()`, which runs memory recall (~1.9 s), the scope-guard classifier (~1.3 s) and the injection detector (~1.8 s) BEFORE the model's first token. No header is written to the socket in the meantime, so **a client connection budget shorter than that aborts a healthy turn**: the reference consumer's BFF did exactly this with a 10 s `connect_timeout` (`502 upstream_unreachable` on a turn that later completed) while the backend logged nothing — from its side the client just hung up (this was the "UI shows the generic error, backend is clean" incident, 2026-09-17). Budget `AGENT_CONNECT_TIMEOUT` ≥ 30 s; the fix direction here is latency, never a shorter timeout.
22. **The chat pipeline is traced per request now** (`shared/observability/request-trace.ts` + `routes/middleware/request-trace.ts`): one line per event — entry (`→ POST /chat/comms msgs=1 thread=…`), one line per processor with verdict and duration (`· scope-guard:communication ok 1.25s` / `block` / `fail`), TTFB (`← 200 ttfb=8.90s`, i.e. the end of the prelude) and close (`✓ done 12.40s first-byte=… bytes=…`). It is ON outside production; `CHAT_TRACE=on|off` overrides; the short id travels back as the `x-mastra-trace` response header. The processor timing is a transparent Proxy — identity, options and `instanceof` are preserved, so structural tests and private fields keep working.
23. **LLM detectors on a provider WITHOUT structured outputs need `instructions` that name the schema keys LITERALLY** (DeepInfra/DeepSeek): the zod schema only reaches the prompt there, and a model that invents keys fails validation and leaves the detector INERT while still paying the call — the injection detector did it (`{"severity":…}`, fixed in `createInjectionDetector`) and so did the PII detector (`redacted_content` missing → `[PIIDetector] Detection agent failed, allowing content` ~1.7 s/turn, fixed in `buildPiiDetectionInstructions`). Both output contracts live in `security-stack.ts`; keep them if you switch providers.

## Development Workflow

### Adding a New Domain
1. Create `src/mastra/domains/<domain-name>/` with `agent.ts` (scope + guard wired — see gotcha #7), `tools/`, optional `workflows/`, `scorers/`, `entities/`, `events.ts`, `index.ts` (barrel exports the agent, `*Scope` and `*ScopeGuard`).
2. Register agent (and any workflow) in the `agents`/`workflows` maps of `src/mastra/index.ts`.
3. Add `tests/unit/domains/<domain>/`, `tests/evals/<domain>.eval.test.ts`.
4. Document in `docs/domains/<domain>.md` and add an `AGENTS.md` for the domain folder.

### Adding a New Tool
1. `src/mastra/domains/<domain>/tools/<tool-name>.ts` with `createTool()` + Zod schemas.
2. Use `logger` from `src/mastra/shared/logger.ts` — never raw `console.*` (no-console lint rule).
3. Export from domain `index.ts`; add unit test.

### Running Tests
```bash
npm run test:all        # smoke → unit → integration → evals
npm run test:smoke      # zero-config boot of the real instance
npm run test:unit       # fast deterministic
npm run test:integration
npm run test:evals      # structural today (offline-safe), live when skipIf-guarded
npm run test:unit -- domains/research   # one area
```

## Common Patterns

### Creating a Tool
```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { logger } from '../../../shared/logger';

export const myTool = createTool({
  id: 'my-tool',
  description: 'What this tool does',
  inputSchema: z.object({ param: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ param }) => {
    try {
      return { result: 'done' };
    } catch (error) {
      logger.error('Tool failed:', error);
      throw error;
    }
  },
});
```

### Creating an Agent

**Use `buildDomainAgent()`** — it wires the security stack, memory, and scorers automatically while enforcing the Spec 06 hard rule (scope guard = slot 0, both `inputProcessors` AND `outputProcessors`).

```typescript
import {
  buildDomainAgent,
  createScopeGuard,
  type DomainScope,
} from '../../shared/agents/build-agent';
import { buildSecurityStack } from '../../shared/processors/security-stack';

export const myScope: DomainScope = {
  domain: 'my-domain',
  agentName: 'My Agent',
  scope: 'the ONE thing this agent does',
  outOfScopeExamples: ['...'],
  siblings: [/* the other agents, as plain data */],
};

// Kept for backward compat — structural wiring tests reference these
export const myScopeGuard = createScopeGuard(myScope);
export const mySecurityStack = buildSecurityStack({
  scope: myScope,
  disableResponseCache: true, // REQUIRED for mutating agents (spec 06 R2)
});

export const myAgent = buildDomainAgent({
  scope: myScope,
  instructionsBody: `You are a specialist...`,
  modelKey: 'myDomain', // precedence: MODEL_<AGENT> > MODEL > DEFAULT_MODEL
  enableObservationalMemory: true, // optional: compaction + semantic recall
  disableResponseCache: true, // REQUIRED for mutating agents
  tools: { my_tool: myTool },
});
```

**Key options:**
- `instructionsBody` — agent-specific instructions (scoped instructions are prepended automatically)
- `modelKey` — defaults to `scope.domain`; maps to `agentModel.<key>()`
- `enableObservationalMemory` — adds compaction + semantic recall (default: false)
- `disableResponseCache` — **REQUIRED** for mutating agents (file writes, task creation, etc.)
- `tools` — static map or async function `({ mastra }) => ({...})`
- `overrides` — any additional `AgentConfig` fields

### Domain Events

All domain events are defined with `createEvent()` + `makeEvent()` from `shared/events`.
The factory eliminates the repeated `type`/`payload`/`timestamp` boilerplate:

```typescript
import { createEvent, makeEvent } from '../../shared/events';

// Definition: one line per event
export const taskCreatedEvent = createEvent('task.created')<{
  taskId: string;
  title: string;
  priority: string;
  timestamp: Date;
}>();

// Usage: makeEvent auto-sets timestamp, type comes from the marker
const event = makeEvent(taskCreatedEvent, { taskId: task.id, title, priority, timestamp: task.createdAt });
await eventBus.publish(event);
```

### Persistence Tools

Use `requireAppDb(toolId)` for tools that need a database connection — it throws a
typed `MastraError` when no DB is available, replacing the repeated null-check boilerplate:

```typescript
import { requireAppDb } from '../../shared/config/db';

const db = await requireAppDb('task-create'); // throws PERSISTENCE_UNAVAILABLE if no DB
const repo = createTaskRepository(db);
```

### Creating a Workflow
```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

const myStep = createStep({
  id: 'my-step',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ output: z.string() }),
  execute: async ({ inputData }) => ({ output: inputData.input }),
});

export const myWorkflow = createWorkflow({
  id: 'my-workflow',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ output: z.string() }),
}).then(myStep).commit();
```

## Deployment

```bash
# Dev (zero-config)
npm run dev                        # Studio: http://localhost:4111

# Docker dev (app + PostgreSQL w/ pgvector)
cd docker && docker-compose up -d

# Production HA (api×3, orchestration×2, scheduler×1, background-tasks×2, postgres, redis)
cd docker && docker-compose -f docker-compose.prod.yml up -d

# Health check any deployment
npm run health-check
```

Mastra Platform (optional): set `MASTRA_PLATFORM_ACCESS_TOKEN`, `MASTRA_PROJECT_ID`, `MASTRA_ORG_ID` then `npm run deploy:staging|production`.

## Troubleshooting

- **"This storage provider does not support listing feedback" (Studio, LibSQL mode)** ⇒ the compat shim in `src/mastra/shared/config/libsql-feedback-compat.ts` must be wired (it is, via `createLibSQLStorage` in `config/storage.ts`). LibSQL persists only spans/traces; the full feedback surface (write + analytics) requires PostgreSQL `DATABASE_URL`.
- **DB connection (SASL/auth) errors** ⇒ bad `DATABASE_URL`; app intentionally falls back to nothing else — unset it for LibSQL dev mode.
- **HTTP 400 from a tool** ⇒ likely a built-in tool with an unsupported provider; write a custom tool.
- **Port 4111 busy** ⇒ `pkill -f "mastra dev"`; the dev user controls server lifecycle.
- **Worker duplication** ⇒ run exactly ONE scheduler (`MASTRA_WORKERS=scheduler`, compose `replicas: 1`); never scale it — multiple schedulers fire every cron tick twice. Orchestration/backgroundTasks DO scale horizontally (consumer groups).
- **Split workers not starting** ⇒ `REDIS_URL` missing: distributed PubSub is a hard requirement of the split topology (ADR-005); without it Mastra keeps the in-process bus and workers serve nothing cross-process.
- **`401 {"error":"invalid webhook signature"}` from `/hooks/*`** ⇒ unset `WEBHOOK_SECRET` (fail-closed design) or the `x-webhook-signature` header isn't HMAC-SHA256 over the **raw bytes** you sent (re-serialized JSON breaks it).
- **`429 {"error":"rate limit exceeded"}`** ⇒ limiter active; honor `Retry-After`; remember the per-process caveat (gotcha #19).
- **`OTEL_EXPORTER_OTLP_ENDPOINT` set but no traces arrive** ⇒ read the boot WARN: exporter is the optional `@mastra/otel-exporter` companion (+protocol peer); missing ⇒ storage-only + `○` row.

## Resources

- [Mastra Documentation](https://mastra.ai/docs)
- [Mastra Models](https://mastra.ai/models)
- [Vertical Slice Architecture](https://jeremydmiller.com/2026-06-04/the-codebase-is-the-prompt-wolverine-vertical-slices-and-ai-assisted-development/)
- [DDD for AI Agents](https://slavadubrov.github.io/blog/2025-10-20/domain-driven-design-ai-agents/)

<!-- MANUAL: Any notes added below this line are preserved on regeneration -->
