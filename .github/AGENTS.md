<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# .github

## Purpose

CI gates and the automated dependency-update pipeline that make the boilerplate self-updating.

## Key Files

| File | Description |
|------|-------------|
| `workflows/ci.yml` | Jobs: `lint`, `typecheck`, `build`, `coverage`, `test-smoke`, `test-unit`, `test-integration`, `test-evals` — on push/PR. All must pass to merge (spec 07: typecheck + coverage gates blocking). Workflow-level `env: npm_config_legacy_peer_deps: 'true'` (lockfile committed with legacy resolution) |
| `workflows/evals-live.yml` | Spec 07 Tier B: nightly `schedule` + `workflow_dispatch` (mode=baseline|compare[+candidateModel, updateBaseline]) + push main. `startExperiment` baseline vs candidate on a pinned dataset version → `compareExperiments` report to job summary + artifact; refreshes Tier A baseline/fixtures via opt-in auto-PR. Never PR-gating, forks never red on it. |
| `workflows/auto-update.yml` | Weekly `npx @mastra/codemod@latest` scan; files an issue when migrations are suggested |
| `renovate.json` | Grouped `@mastra/*` + dependency update PRs |

## For AI Agents

### Working In This Directory
- Keep CI job list in sync with root `AGENTS.md`'s testing gate; if a new npm script becomes a gate, add the job here too.
- Evals are structural/offline-safe today; if live calls are added, guard them with `describe.skipIf` so forks without secrets stay green.
- Renovate grouping: Mastra packages update together (single PR) to avoid half-migrated version skew.

<!-- MANUAL: -->
