<!-- Parent: ../../../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# shared

## Purpose

Cross-domain utilities kept deliberately minimal: logging, event bus, and the env-optional infrastructure builder. Everything here is used by ≥2 domains or by `src/mastra/index.ts`.

## Key Files

| File | Description |
|------|-------------|
| `logger.ts` | Level-filtered logger (`LOG_LEVEL` env) wrapping console; `no-console` lint rule is satisfied by the single eslint-disable inside it. Use `logger.debug/info/warn/error/raw` everywhere else |
| `config/infrastructure.ts` | **The optional-infrastructure engine**: reads env vars, returns `{ storage, observability?, services[] }`; PostgreSQL → LibSQL custom → LibSQL file fallback chain (LibSQL instances built via `createLibSQLStorage()` which swaps in the feedback shim); multi-region only with Postgres; observability on unless `ENABLE_OBSERVABILITY=false`; detects model-provider API keys; renders the startup service-availability banner |
| `config/libsql-feedback-compat.ts` | `LibSQLFeedbackCompatStore extends ObservabilityLibSQL`: Studio feedback GETs return schema-conformant empty results instead of 500s (LibSQL has no feedback tables — Postgres only); feedback writes throw a clear migration hint |
| `config/model.ts` | **Provider-agnostic model resolution**: `agentModel.<key>()` + `memoryModel()`; precedence `MODEL_<AGENT>` > `MODEL` > `DEFAULT_MODEL` (built-in `openai/gpt-4o-mini`). Agents must never hard-code a model string |
| `tools/run-tool.ts` | `runTool<TOutput>(tool, inputData)`: typed, safe direct execution of tools from workflow steps and unit tests (execute is optional + arity 2 in v1; never call `tool.execute` directly) |
| `events/event-bus.ts` | EventEmitter-based typed pub/sub; events need a `type` property. Barrel: `events/index.ts` |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `config/` | Infrastructure/env composition (currently only `infrastructure.ts`) |
| `events/` | Event bus + re-exports |

## For AI Agents

### Working In This Directory
- **Adding an optional service**: extend `buildInfrastructure()` with a `build*` function that pushes a `ServiceStatus` in both active and inactive cases, so the banner always tells the truth.
- `src/mastra/public/mastra.db` is the default fallback storage location.
- Nothing in `shared/` may import from `domains/`.

### Testing Requirements
- `tests/unit/shared/event-bus.test.ts` covers the bus. Any change to `infrastructure.ts` should be verified by booting with and without the relevant env vars (`timeout 15 npm run dev` with `DATABASE_URL=...` unset/set).

## Dependencies

### External
- `@mastra/observability`, `@mastra/pg`, `@mastra/libsql`

<!-- MANUAL: -->
