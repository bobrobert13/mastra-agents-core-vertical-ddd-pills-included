<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-26 (Spec 06) -->
# file-operations

## Purpose

Local-filesystem vertical slice: an agent whose read/write/edit tools run **inside a
workspace jail with human approval on mutating calls**. Reference implementation for
LLM-exposed FS access done safely (spec 06, ADR-009).

## Key Files

| File | Description |
|------|-------------|
| `agent.ts` | `file-operations-agent` / "File Operations Agent"; model via `agentModel.files()` — env-driven; exports `fileOperationsScope`, `fileOperationsScopeGuard` (the agent from the off-topic incident, gotcha #7) and `fileOperationsSecurityStack` = `buildSecurityStack({scope, disableResponseCache: true})` (cache hits replay tool calls — mutating agents are excluded); `inputProcessors`+`outputProcessors` come from the stack (hard rule) |
| `tools/write-file.ts`, `tools/edit-file.ts` | `requireApproval: true` — a declined call provably performs NO fs write (jail check + approval happen before any fs touch) |
| `tools/read-file.ts` | jailed, unapproved (reads are allowed but confined) |
| `index.ts` | Barrel export (agent, scope, guard, security stack, tools) |

## For AI Agents

### Working In This Directory
- **Jail**: every fs path goes through `resolveWorkspacePath()` from `shared/tools/workspace-path.ts` BEFORE any fs call — lexical containment + realpath check on the deepest existing ancestor (blocks symlink escapes incl. file-symlink-follow). Never accept raw user paths into `fs` calls.
- `WORKSPACE_ROOT` (default `workspace`) resolves against the PROCESS CWD — dev bundles run from `src/mastra/public/`; set an absolute path in prod. `FILE_JAIL=off` disables containment and prints a ⚠ banner clause; approvals were designed assuming jail ON.
- Accepted residual: symlink TOCTOU (ADR-009 consequences). Do not "fix" it in code — it is a ratified trade-off.
- **Approvals**: write/edit carry `requireApproval: true`; the decline reason is persisted by the runtime on the approval record (spec 06 decline-with-reason convention, shared with spec 04's MCP predicate).
- Keep write/edit idempotent-safe (existence checked before clobber) — they are exposed to an LLM.

### Testing Requirements
- Tests EXIST: `tests/unit/domains/file-operations/tools/{write,edit,read}-file.test.ts` (16: empty-write guarantees `existsSync === false` on decline/reject, 3 symlink escape cases, `FILE_JAIL=off`, lazy root creation) + `tests/integration/hitl-suspend-resume.test.ts` live tiers (decline-with-reason, injection scan). Temp dirs only, no real-FS assumptions.

## Dependencies

### Internal
- `shared/logger.ts`, `shared/tools/workspace-path.ts`, `shared/processors/security-stack.ts`

### External
- `@mastra/core/agent`, `@mastra/core/tools`, `node:fs/promises`, `zod`

<!-- MANUAL: -->
