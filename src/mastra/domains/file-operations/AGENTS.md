<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-17 -->
# file-operations

## Purpose

Local-filesystem vertical slice: an agent whose read/write/edit tools run **inside a
workspace jail with human approval on mutating calls**. Reference implementation for
LLM-exposed FS access done safely (spec 06, ADR-009).

## Key Files

| File | Description |
|------|-------------|
| `agent.ts` | Composition root: `buildDomainAgent({ scope, instructionsBody, tools: { read_file, write_file, edit_file }, ...fileOperationsSettings })`. Fixes the three structural-test exports: `fileOperationsAgent`, `fileOperationsScopeGuard`, `fileOperationsSecurityStack` (the agent from the off-topic incident, gotcha #7; the stack is `buildSecurityStack({ scope, disableResponseCache: true })` — cache hits replay tool calls, so mutating agents are excluded); `inputProcessors`+`outputProcessors` come from the stack (hard rule) |
| `scope.ts` | `fileOperationsScope` (`DomainScope`): `agentName`/`scope`/`siblings` read from `shared/agents/domain-catalog.ts` (`DOMAIN_CATALOG['file-operations']` + `siblingsOf('file-operations')`); only `outOfScopeExamples` and `refusal: { tone: 'formal' }` are local (sober voice — it acts on the user's files) |
| `config.ts` | `fileOperationsSettings` (`modelKey: 'files'`, `maxSteps: 20`, `connectors: { memory: 'basic' }`, `disableResponseCache: true` — spec 06 R2) |
| `instructions.ts` | `fileOperationsInstructions` — capability body; `scopedInstructions()` prepends the scope/refusal block |
| `tools/write-file.ts`, `tools/edit-file.ts` | `requireApproval: true` — a declined call provably performs NO fs write (jail check + approval happen before any fs touch) |
| `tools/read-file.ts` | jailed, unapproved (reads are allowed but confined) |
| `handlers/errors.ts` | Domain errors: `FileOperationsError` base + `WorkspaceJailError` (`WORKSPACE_JAIL_ESCAPE`) + `FileReadError`/`FileWriteError`/`FileEditError` + `UnexpectedFileOperationsError` + `toFileOperationsError`. The typed errors are created at the tool boundary (each tool wraps `resolveWorkspacePath` in try/catch → `WorkspaceJailError`, and its fs catch → the matching typed error with `cause`), so a bare `Error` never leaves the domain |
| `handlers/responses.ts` | `FileOperationsResult<T> = AppResult<T, FileOperationsError>` + `fileOperationsOk` / `fileOperationsFail` |
| `index.ts` | Barrel export (agent, scope, guard, security stack, settings, instructions, tools, handlers) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `handlers/` | `errors.ts` (domain error classes + `toFileOperationsError`) + `responses.ts` (`AppResult` alias) + the barrel |
| `tools/` | `read-file.ts` / `write-file.ts` / `edit-file.ts` — the three jailed FS tools |

## For AI Agents

### Working In This Directory
- **Jail**: every fs path goes through `resolveWorkspacePath()` from `shared/tools/workspace-path.ts` BEFORE any fs call — lexical containment + realpath check on the deepest existing ancestor (blocks symlink escapes incl. file-symlink-follow). Never accept raw user paths into `fs` calls.
- `WORKSPACE_ROOT` (default `workspace`) resolves against the PROCESS CWD — dev bundles run from `src/mastra/public/`; set an absolute path in prod. `FILE_JAIL=off` disables containment and prints a ⚠ banner clause; approvals were designed assuming jail ON.
- Accepted residual: symlink TOCTOU (ADR-009 consequences). Do not "fix" it in code — it is a ratified trade-off.
- **Approvals**: write/edit carry `requireApproval: true`; the decline reason is persisted by the runtime on the approval record (spec 06 decline-with-reason convention, shared with spec 04's MCP predicate).
- Keep write/edit idempotent-safe (existence checked before clobber) — they are exposed to an LLM.

### Connectors & Domain Table
- Connectors are DECLARED in `config.ts` (`fileOperationsSettings.connectors`), never hand-wired in `agent.ts`. `memory: 'basic'` is the default tier; `disableResponseCache: true` stays a domain knob because a cache hit would replay mutating tool calls.
- RAG is opt-in: an agent receives `search_knowledge` ONLY when it declares `connectors: { rag: true }` in its `config.ts` — without that key it does not get the tool even though it stays registered in the root Mastra `tools` registry (`src/mastra/index.ts`). `fileOperationsSettings` declares no `rag`, so this agent does not receive it.
- The domain table (agent name, long scope line, sibling descriptions) lives once in `shared/agents/domain-catalog.ts`; `scope.ts` reads `DOMAIN_CATALOG['file-operations']` + `siblingsOf('file-operations')` — never re-copy sibling strings locally.

### Testing Requirements
- Tests EXIST: `tests/unit/domains/file-operations/tools/{write,edit,read}-file.test.ts` (16: empty-write guarantees `existsSync === false` on decline/reject, 3 symlink escape cases, `FILE_JAIL=off`, lazy root creation) + `tests/integration/hitl-suspend-resume.test.ts` live tiers (decline-with-reason, injection scan). Temp dirs only, no real-FS assumptions. Structural wiring tests reference the three `agent.ts` exports.

## Dependencies

### Internal
- `shared/logger.ts`, `shared/tools/workspace-path.ts`, `shared/processors/security-stack.ts`, `shared/agents/build-agent.ts` (`buildDomainAgent`), `shared/agents/domain-catalog.ts`

### External
- `@mastra/core/tools`, `node:fs/promises`, `zod` (the `Agent`/memory packages arrive via `shared/agents/build-agent.ts`)

<!-- MANUAL: -->
