<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# tests

## Purpose

Three-tier test pyramid: deterministic unit tests, cross-domain integration tests, and LLM-based evals via `@mastra/evals`. Vitest 3.x (hard requirement of @mastra/evals).

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `unit/` | Fast, no network. `unit/domains/<domain>/` mirrors source layout; `unit/shared/event-bus.test.ts` |
| `integration/` | `cross-domain.test.ts` — boots domains together, asserts event flow between them |
| `evals/` | `research.eval.test.ts`, `task-management.eval.test.ts` — call a real model; need a provider API key and are gated separately in CI |

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
- Evals must be skippable when no API key is present (`describe.skipIf` pattern) so `test:unit`/`test:integration` stay hermetic.

### Testing Requirements
```bash
npm run test:unit          # always green offline
npm run test:integration
npm run test:evals         # requires any provider API key from .env
```

<!-- MANUAL: -->
