<!-- Parent: ../../../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# shared

## Purpose

Cross-domain utilities kept deliberately minimal, one responsibility per module: service-status contract + banner, storage selection, observability config, provider detection, model resolution, logging, event bus, tool-execution helper. Everything here is used by ≥2 domains or by `src/mastra/index.ts`.

## Key Files

| File | Description |
|------|-------------|
| `logger.ts` | Level-filtered logger (`LOG_LEVEL` env) wrapping console; the `no-console` lint rule is satisfied by its single eslint-disable. Use `logger.debug/info/warn/error/raw` everywhere else |
| `config/infrastructure.ts` | **Composition root only**: calls the builders below, returns `{ storage, vectors, observability?, pubsub?, auth?, mcpClient?, services[] }`. New services get their own module + one call here |
| `config/storage.ts` | `buildStorage()`: consumes `resolveDbTarget()` — PostgreSQL (`DATABASE_URL`) → LibSQL custom (`LIBSQL_URL`) → `file:./mastra.db` fallback |
| `config/db.ts` | `AppDatabase` factory + `resolveDbTarget()` — the ONE URL-precedence implementation shared by storage and domain-owned app tables (ADR-008) |
| `config/vectors.ts` | `buildVectors()` (PgVector/LibSQLVector following storage), `semanticRecallAvailable()`, `buildDomainMemory()` (DynamicArgument memory factory with latched one-warn embedder degrade — every domain agent uses it), `RECALL_OPTIONS` (ADR-006) |
| `config/pubsub.ts` | `buildPubsub()`: `REDIS_URL` → `RedisStreamsPubSub` (split workers + event-bus bridge); unset → undefined = in-process |
| `config/auth.ts` | `buildAuth()`: `MASTRA_JWT_SECRET` → `MastraJwtAuth` (+`CompositeAuth` worker bearer via `MASTRA_WORKER_AUTH_TOKEN`); production without auth = FATAL exit; dev without = loud ⚠️ banner (ADR-004) |
| `config/mcp-parse.ts` | **Pure (no @mastra/mcp, no logger — unit tier never loads the SDK):** `parseMcpServers` (Zod, `${VAR}` interpolation, reserved-key/transport rules, Scenario-2 fail-fast messages) + `defaultMcpApprovalPolicy`/`mcpWarnings` (spec 04) |
| `config/mcp.ts` | `buildMcpClient(services)` + `loadMcpToolsFor(agentKey)`: THE module-level memoized `MCPClient` singleton (one id `boilerplate-mcp-client`, one subprocess — never construct an MCPClient elsewhere, spec 04 §3.3 ESM-ordering rule); unrouted agents short-circuit `{}` with zero connects |
| `config/schedules.ts` | `detectSchedules()`: banner row from evented workflows' `getScheduleConfigs()`, incl. the `MASTRA_WORKERS=false` silent-kill warning |
| `config/observability.ts` | `buildObservability()`: on by default, `ENABLE_OBSERVABILITY=false` opts out; per-NODE_ENV configs with storage exporter + sensitive-data filter |
| `config/providers.ts` | `detectModelProviders()` + `hasAnyProviderKey()`: provider keys feed the banner and the scope-guard inert check |
| `processors/scope-guard.ts` | `createScopeGuard(DomainScope)`: **hard scope enforcement InputProcessor** — classifies the last user message via an internal provider-agnostic Agent; out-of-scope → `abort()` (TripWire before the LLM) with a sibling redirect; classifier errors fail OPEN; `SCOPE_GUARD=off` disables, inert without a provider key. Slot 0 of the security stack — deliberately NOT extended (one reason to change); agents never wire it directly anymore |
| `processors/security-stack.ts` | `buildSecurityStack({scope, disableResponseCache?})`: **the hard-rule processor pipeline** — `[scopeGuard(0), TokenLimiter(1), TokenCostControl(1.5 COST_LIMIT_USD-only), PromptInjectionDetector(2), ResponseCache(3-last)]` + `outputProcessors` (PIIDetector mask). Inert rule: LLM detectors only with provider key (they HARD-THROW on guard-model failure — gotcha #16). `scanToolOutputForInjection()` = web-fetch output-boundary scan (Q3). `registerSecurityStackStatus()` banner (spec 06, ADR-009) |
| `agents/scoped-instructions.ts` | `scopedInstructions(scope, body)`: mandatory instruction template — Scope / Out of scope / Refusal protocol / Tool-use honesty blocks above the capabilities body. Positive-only instructions are forbidden |
| `config/service-status.ts` | `ServiceStatus`/`ServiceRegistry` types + `logServiceAvailability()` banner (✅ active / ○ inactive) |
| `config/model.ts` | **Provider-agnostic model resolution**: `agentModel.<key>()` + `memoryModel()` + `guardModel()` + `embeddingModel()`/`resolveEmbedder()` (`SCOPE_GUARD_MODEL` > `MODEL` > `DEFAULT_MODEL`; precedence `MODEL_<AGENT>` > `MODEL` > `DEFAULT_MODEL`). Never hard-code a model string |
| `config/libsql-feedback-compat.ts` | `LibSQLFeedbackCompatStore extends ObservabilityLibSQL`: Studio feedback GETs return schema-conformant empty results instead of 500s (LibSQL has no feedback tables — Postgres only); feedback writes throw a clear migration hint |
| `events/event-bus.ts` | EventEmitter-based typed pub/sub; events need a `type` property. `attachEventBusBridge(pubsub)` (ADR-005) fans domain events cross-process when distributed pubsub exists — ack on EVERY delivery, call-site API unchanged. Barrel: `events/index.ts` |
| `tools/run-tool.ts` | `runTool<TOutput>(tool, inputData, contextOverrides?)`: typed, safe direct execution of tools from workflow steps and unit tests (execute is optional + arity 2 in v1; never call `tool.execute` directly) |
| `tools/workspace-path.ts` | `resolveWorkspacePath()`: the file-tools jail — WORKSPACE_ROOT containment (realpath-checked, symlink-safe), `FILE_JAIL=off` escape hatch (spec 06) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `config/` | `infrastructure.ts`, `storage.ts`, `db.ts`, `vectors.ts`, `observability.ts`, `pubsub.ts`, `auth.ts`, `mcp-parse.ts`, `mcp.ts`, `schedules.ts`, `providers.ts`, `service-status.ts`, `model.ts`, `libsql-feedback-compat.ts` |
| `processors/` | `scope-guard.ts` — the scope-enforcement engine; `security-stack.ts` — the defense-in-depth pipeline composition (spec 06) |
| `agents/` | `scoped-instructions.ts` — instruction template paired with the guard |
| `events/` | `event-bus.ts` (+ cross-process bridge) + barrel re-export |
| `tools/` | `run-tool.ts`, `workspace-path.ts` |

## For AI Agents

### Working In This Directory
- **Adding an optional service**: create a `build<Thing>()` module under `config/` (or next to `logger.ts` if not config), push a `ServiceStatus` in BOTH active and inactive cases, wire it in `infrastructure.ts`. Keep `infrastructure.ts` under ~40 lines — if it grows, you are merging responsibilities again.
- Every module here must have exactly one reason to change (the 2026-09-12 split of the 175-line `infrastructure.ts` is the reference example).
- `./mastra.db` (LibSQL fallback) is created at process CWD; in dev bundles that is `src/mastra/public/` — all `*.db*` are gitignored.
- Nothing in `shared/` may import from `domains/`.

### Testing Requirements
- `tests/unit/shared/event-bus.test.ts` covers the bus; `tests/smoke/boots.test.ts` covers the whole config composition via `src/mastra/index.ts`. Any change to a config module must be verified by booting with and without its env vars (`timeout 15 npm run dev`).

## Dependencies

### External
- `@mastra/observability`, `@mastra/core/observability` (LogLevel type), `@mastra/pg`, `@mastra/libsql`

<!-- MANUAL: -->
