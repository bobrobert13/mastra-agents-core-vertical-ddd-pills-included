<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# mastra (src/mastra)

## Purpose

All application source. A single Mastra instance (`index.ts`) composes four vertical-slice domains plus a minimal `shared/` layer. No framework bootstrap logic lives elsewhere.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Registers the 4 agents + the `deep-research`/`daily-digest`/`index-knowledge` workflows, optional `vectors`/`tools`/`pubsub`/`mcpServers`, validates env (fail-fast only on malformed-present), builds infrastructure via `shared/config/infrastructure.ts`, creates the `Mastra` server (imperative `serverConfig` + `buildServerSurface` — see dev-bundler note there), prints the service-availability banner. NB: `tools.search_knowledge` is registered here whenever an embedder resolves, but **no agent receives it unless it opts in** (`connectors: { rag: true }` in its `config.ts`) — see root gotcha #25 |
| `shared/config/env.ts` | Zod `validateEnv()` — fail-fast ONLY on malformed PRESENT values; absence is always legal (zero-config promise); called once from `index.ts` |
| `shared/config/embedding-parse.ts` | Pure `EMBEDDING_CONFIG` parser (one JSON var = the whole embedder declaration, `${VAR}` interpolation); malformed ⇒ boot error, absent ⇒ fall through |
| `shared/config/embedder.ts` | `resolveEmbedder()`: `SEMANTIC_RECALL=off` > `EMBEDDING_CONFIG` > `EMBEDDING_MODEL` > local fastembed |
| `shared/agents/` | `buildDomainAgent()` + the declarative `connectors` (`rag`/`memory`/`mcp`), `domain-catalog.ts` (the single domain table + `siblingsOf()`), `scoped-instructions.ts` |
| `shared/handlers/` | The two general bases every domain extends: `app-error.ts` (`AppError` — abstract `code`/`domain`, semantic `kind`, `toJSON()`, `toAppError`/`isPersistenceUnavailable`) and `app-result.ts` (`AppResult` — `ok`/`fail` + `unwrap`/`unwrapOr`/`map`/`match`). Concrete domain errors live in each `domains/<d>/handlers/errors.ts`; `shared/` never imports `domains/` |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `domains/` | The vertical slices (see `domains/AGENTS.md`) |
| `routes/` | Custom HTTP surface (spec 08): `buildServerSurface` + webhook/health/chat routes + route middleware — see `routes/AGENTS.md` |
| `mcp/` | **Composition-layer exception (ADR-007):** the project's own read-only `MCPServer` assembly (`server.ts`, gated on `ENABLE_MCP_SERVER=true`) + stdio bundle entry (`stdio.ts`). Imports domain barrels — legal here, forbidden in `shared/`. `index.ts` gains exactly one awaited `buildMcpServer(services)` call (see `mcp/AGENTS.md`) |
| `shared/` | Cross-domain utilities: logger, event bus, config builders (storage/vectors/observability/pubsub/auth/mcp/providers/service-status/model/embedder/embedding-parse/schedules), run-tool, workspace jail, `buildDomainAgent()` + `connectors`, `domain-catalog.ts`, `scope-messaging.ts`, `handlers/` (`AppError` + `AppResult` — the general bases every domain extends; see `shared/AGENTS.md`) |
| `public/` | Runtime data dir; contains generated `mastra.db*` (LibSQL) — gitignored, never edit |

## For AI Agents

### Working In This Directory
- `index.ts` must stay declarative: new agents go in the `agents` map, new workflows in the `workflows` map (unregistered = invisible in `/api/workflows`); new optional services go in `shared/config/<service>.ts` wired via `infrastructure.ts`, never inline here.
- The `...(observability && { observability })` spread is deliberate — Mastra accepts a missing observability key.

### Testing Requirements
- `tests/integration/cross-domain.test.ts` boots this module; changes here can break every suite.

## Dependencies

### Internal
- `domains/*` (all four agents)
- `shared/config/*`, `shared/logger.ts`

### External
- `@mastra/core`, `@mastra/observability`, `@mastra/pg`, `@mastra/libsql`

<!-- MANUAL: -->
