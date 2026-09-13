<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# tests

## Purpose

Three-tier test pyramid: deterministic unit tests, cross-domain integration tests, and LLM-based evals via `@mastra/evals`. Vitest 3.x (hard requirement of @mastra/evals).

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `smoke/` | Zero-config boot of the real composition root (`src/mastra/index.ts`): instance constructs with no env vars, 4 agents + workflow registered. Never add model calls here. |
| `unit/` | Fast, no network. `unit/domains/<domain>/` mirrors source layout; `unit/shared/event-bus.test.ts` |
| `integration/` | `cross-domain.test.ts` (in-process event flow), `pubsub-redis.test.ts` (skipIf `!REDIS_URL`), `task-persistence-schedules.test.ts` (pg leg gated + offline schedules claim probe), `semantic-recall`/`knowledge-rag`/`recall-degrade`/`pg-vectors` (spec 03 tiers), `mcp-stdio.test.ts` (real stdio subprocess via echo helper + `process.execPath`, no npx/network: namespaced discovery, approval predicate, **singleton spawns EXACTLY ONE child**, disconnect; `skipIf` without `@mastra/mcp`) |
| `evals/` | `research.eval.test.ts`, `task-management.eval.test.ts` — currently **structural** (identity/model/dataset contracts, offline-safe); live LLM evals are an upgrade path guarded by `describe.skipIf` |

## Key Files

| File | Description |
|------|-------------|
| `unit/domains/research/agent.test.ts` | Asserts `id`, `name`, `model` ONLY — Agent doesn't expose tools/memory/instructions publicly |
| `unit/domains/research/tools/summarize.test.ts` | Includes the maxLength truncation contract |
| `unit/domains/task-management/tools/create-task.test.ts` | Tool-level behavior + event emission |

## For AI Agents

### Working In This Directory
- Import paths from `tests/**` to source need correct `../` depth (this burned us once: `../../../../src/...` vs `../../../../../src/...`). Verify with a single test run before assuming.
- Never assert on non-public Agent internals.
- If evals ever make live model calls, they MUST be guarded by `describe.skipIf(!hasProviderKey())` so the tier stays offline-safe by default.

### Testing Requirements
```bash
npm run test:smoke         # zero-config boot (no env, no network)
npm run test:unit          # always green offline
npm run test:integration
npm run test:evals         # structural today; skipIf-guarded when live calls are added
```

<!-- MANUAL: -->
