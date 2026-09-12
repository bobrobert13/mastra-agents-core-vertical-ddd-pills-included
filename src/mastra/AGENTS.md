<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# mastra (src/mastra)

## Purpose

All application source. A single Mastra instance (`index.ts`) composes four vertical-slice domains plus a minimal `shared/` layer. No framework bootstrap logic lives elsewhere.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Builds infrastructure from env vars, registers the 4 agents, creates the `Mastra` server (port 4111 default), prints the service-availability banner |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `domains/` | The four vertical slices (see `domains/AGENTS.md`) |
| `shared/` | Cross-domain utilities: logger, event bus, env-optional infrastructure (see `shared/AGENTS.md`) |
| `public/` | Runtime data dir; contains generated `mastra.db*` (LibSQL) — gitignored, never edit |

## For AI Agents

### Working In This Directory
- `index.ts` must stay declarative: new agents go in the `agents` map; new optional services go in `shared/config/infrastructure.ts`, never inline here.
- The `...(observability && { observability })` spread is deliberate — Mastra accepts a missing observability key.

### Testing Requirements
- `tests/integration/cross-domain.test.ts` boots this module; changes here can break every suite.

## Dependencies

### Internal
- `domains/*` (all four agents)
- `shared/config/infrastructure.ts`, `shared/logger.ts`

### External
- `@mastra/core`, `@mastra/observability`, `@mastra/pg`, `@mastra/libsql`

<!-- MANUAL: -->
