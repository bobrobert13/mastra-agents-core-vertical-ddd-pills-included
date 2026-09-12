<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# .github

## Purpose

CI gates and the automated dependency-update pipeline that make the boilerplate self-updating.

## Key Files

| File | Description |
|------|-------------|
| `workflows/ci.yml` | Jobs: `lint`, `build`, `test-unit`, `test-integration`, `test-evals` — on push/PR. All must pass to merge |
| `workflows/auto-update.yml` | Weekly `npx @mastra/codemod@latest` scan; files an issue when migrations are suggested |
| `renovate.json` | Grouped `@mastra/*` + dependency update PRs |

## For AI Agents

### Working In This Directory
- Keep CI job list in sync with root `AGENTS.md`'s testing gate; if a new npm script becomes a gate, add the job here too.
- Evals job must tolerate missing API key (skip) so forks stay green — mirror the `skipIf` pattern from `tests/AGENTS.md`.
- Renovate grouping: Mastra packages update together (single PR) to avoid half-migrated version skew.

<!-- MANUAL: -->
