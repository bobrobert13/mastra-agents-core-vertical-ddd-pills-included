<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# scripts

## Purpose

Operator-facing bash scripts wired to npm scripts (`init`, `health-check`, `update`). All executable; every `npm install` uses `--legacy-peer-deps`.

## Key Files

| File | Description |
|------|-------------|
| `init.sh` | Full bootstrap: Node check → deps (`--legacy-peer-deps`) → optional `.env` → lint + build + smoke/unit/integration → git init |
| `health-check.sh` | 7 live probes on `MASTRA_PORT` (default 4111): `/health`, `/api/agents` (≥4), `/api/workflows` (deep-research), storage mode, provider keys, layout, deps. Missing `.env`/keys are warnings; exit 0 only when the instance is healthy |
| `update-mastra.sh` | Bumps all 7 Mastra packages (`@latest --legacy-peer-deps`), checks codemods (never auto-applies), re-runs full gate (lint + tsc + test:all + build) |
| `seed-eval-datasets.ts` | Evals seed sync (spec 07 §3.1): mirrors `tests/evals/datasets/*.json` into `mastra.datasets` on `EVAL_STORAGE_URL` (default throwaway `file:./eval-ci.db`); idempotent via `externalId`; runs under `node --experimental-strip-types` (local imports must carry `.ts` extensions — loader constraint) |

## For AI Agents

### Working In This Directory
- Scripts must remain **zero-config safe**: absence of `.env`/DB/API keys must not fail `init.sh` or `health-check.sh` (warnings, not errors).
- Keep npm-script names stable (`npm run init|health-check|update`) — CI and docs reference them.

<!-- MANUAL: -->
