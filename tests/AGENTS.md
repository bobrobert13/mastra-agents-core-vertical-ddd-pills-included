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
| `evals/` | **Two-tier (spec 07)**: `*.eval.test.ts` = native-dataset schema/contract suites (seed → `:memory:`, JSON↔storage parity, idempotency, schema rejection); `gates/*.gates.test.ts` = **keyless-blocking** Tier A — code-based scorers over `fixtures/*-recorded.json` + Δ≤0.02 vs `baseline/eval-baseline.json`, `EVAL GATE <verdict>` throw ⇒ red; live judges = `describe.skipIf(!hasProviderKey())`; `experiments/live-experiments.test.ts` = Tier B runner (needs `EVALS_LIVE_MODE=1` + phase env; inert on PR jobs) |

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
npm run test:evals         # two-tier (spec 07): keyless Tier A gates + skipIf live
npm run test:coverage:gate # all four tiers + threshold gate (vitest.config.ts)
npm run seed:eval-datasets # JSON → native datasets (EVAL_STORAGE_URL, default file:./eval-ci.db)
```

### Opt-in HTTP tier (spec 08)
`tests/integration/http-surface.test.ts` runs ONLY with `RUN_HTTP_TESTS=1`:
`RUN_HTTP_TESTS=1 npm run test:integration`. It needs no network (in-process Hono harness),
no built artifact, and no port; Scenario 4 additionally needs a live provider key (nested
skipIf). CI vehicle (propose at merge): a weekly scheduled job next to `auto-update`
running `RUN_HTTP_TESTS=1 npm run test:integration` — or piggyback Spec 07's live-tier job
if that lands first (cross-reference in the PR). Never leave the gate variable set by nobody.

<!-- MANUAL: -->
