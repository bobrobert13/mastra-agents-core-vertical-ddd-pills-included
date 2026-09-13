<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# mastra (src/mastra)

## Purpose

All application source. A single Mastra instance (`index.ts`) composes four vertical-slice domains plus a minimal `shared/` layer. No framework bootstrap logic lives elsewhere.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Registers the 4 agents + the `deep-research` workflow, builds infrastructure via `shared/config/infrastructure.ts`, creates the `Mastra` server (port 4111 default), prints the service-availability banner |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `domains/` | The four vertical slices (see `domains/AGENTS.md`) |
| `shared/` | Cross-domain utilities: logger, event bus, split config modules (storage/observability/providers/service-status/model), run-tool (see `shared/AGENTS.md`) |
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
