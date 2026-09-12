<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# file-operations

## Purpose

Local-filesystem vertical slice: an agent exposing guarded read/write/edit tools. Reference implementation for tools that touch the host FS.

## Key Files

| File | Description |
|------|-------------|
| `agent.ts` | `file-operations-agent` / "File Operations Agent"; model via `agentModel.files()` — env-driven |
| `index.ts` | Barrel export |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `tools/` | `read-file.ts`, `write-file.ts`, `edit-file.ts` + barrel — Zod-validated paths/content, error paths use `logger` |

## For AI Agents

### Working In This Directory
- Path inputs must be validated (Zod) and confined; never accept raw user paths into `fs` calls.
- Keep write/edit tools idempotent-safe (check existence before clobber) — they are exposed to an LLM.

### Testing Requirements
- Add unit tests under `tests/unit/domains/file-operations/` when touching tools (none exist yet — use temp dirs, no real-FS assumptions).

## Dependencies

### Internal
- `shared/logger.ts`

### External
- `@mastra/core/agent`, `@mastra/core/tools`, `node:fs/promises`, `zod`

<!-- MANUAL: -->
