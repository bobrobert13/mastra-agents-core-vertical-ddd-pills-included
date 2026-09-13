<!-- Parent: ../../../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# shared

## Purpose

Cross-domain utilities kept deliberately minimal, one responsibility per module: service-status contract + banner, storage selection, observability config, provider detection, model resolution, logging, event bus, tool-execution helper. Everything here is used by ≥2 domains or by `src/mastra/index.ts`.

## Key Files

| File | Description |
|------|-------------|
| `logger.ts` | Level-filtered logger (`LOG_LEVEL` env) wrapping console; the `no-console` lint rule is satisfied by its single eslint-disable. Use `logger.debug/info/warn/error/raw` everywhere else |
| `config/infrastructure.ts` | **Composition root only**: calls the builders below, returns `{ storage, observability?, services[] }`. New services get their own module + one call here |
| `config/storage.ts` | `buildStorage()`: PostgreSQL (`DATABASE_URL`) → LibSQL custom (`LIBSQL_URL`) → LibSQL `file:./mastra.db` fallback; multi-region replication lives only in the Postgres branch |
| `config/observability.ts` | `buildObservability()`: on by default, `ENABLE_OBSERVABILITY=false` opts out; per-NODE_ENV configs with storage exporter + sensitive-data filter |
| `config/providers.ts` | `detectModelProviders()` + `hasAnyProviderKey()`: provider keys feed the banner and the scope-guard inert check |
| `processors/scope-guard.ts` | `createScopeGuard(DomainScope)`: **hard scope enforcement InputProcessor** — classifies the last user message via an internal provider-agnostic Agent; out-of-scope → `abort()` (TripWire before the LLM) with a sibling redirect; classifier errors fail OPEN; `SCOPE_GUARD=off` disables, inert without a provider key. Every domain agent MUST wire one |
| `agents/scoped-instructions.ts` | `scopedInstructions(scope, body)`: mandatory instruction template — Scope / Out of scope / Refusal protocol / Tool-use honesty blocks above the capabilities body. Positive-only instructions are forbidden |
| `config/service-status.ts` | `ServiceStatus`/`ServiceRegistry` types + `logServiceAvailability()` banner (✅ active / ○ inactive) |
| `config/model.ts` | **Provider-agnostic model resolution**: `agentModel.<key>()` + `memoryModel()` + `guardModel()` (`SCOPE_GUARD_MODEL` > `MODEL` > `DEFAULT_MODEL`); precedence `MODEL_<AGENT>` > `MODEL` > `DEFAULT_MODEL` (built-in `openai/gpt-4o-mini`). Never hard-code a model string |
| `config/libsql-feedback-compat.ts` | `LibSQLFeedbackCompatStore extends ObservabilityLibSQL`: Studio feedback GETs return schema-conformant empty results instead of 500s (LibSQL has no feedback tables — Postgres only); feedback writes throw a clear migration hint |
| `events/event-bus.ts` | EventEmitter-based typed pub/sub; events need a `type` property. Barrel: `events/index.ts` |
| `tools/run-tool.ts` | `runTool<TOutput>(tool, inputData)`: typed, safe direct execution of tools from workflow steps and unit tests (execute is optional + arity 2 in v1; never call `tool.execute` directly) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `config/` | `infrastructure.ts`, `storage.ts`, `observability.ts`, `providers.ts`, `service-status.ts`, `model.ts`, `libsql-feedback-compat.ts` |
| `processors/` | `scope-guard.ts` — the scope-enforcement engine |
| `agents/` | `scoped-instructions.ts` — instruction template paired with the guard |
| `events/` | `event-bus.ts` + barrel re-export |
| `tools/` | `run-tool.ts` |

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
