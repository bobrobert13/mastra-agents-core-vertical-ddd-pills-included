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
| `warm-embeddings.ts` | fastembed cache pre-warm + repair (`npm run warm:embeddings`): exits when `EMBEDDING_MODEL` is set (hosted embedder, nothing local to warm), reports a healthy cache, otherwise deletes the poisoned directory/archive and re-downloads, finishing with a REAL embed as proof. The package's own `warmup()` covers only bge-small/base (root `AGENTS.md` #13) |

## For AI Agents

### Working In This Directory
- Scripts must remain **zero-config safe**: absence of `.env`/DB/API keys must not fail `init.sh` or `health-check.sh` (warnings, not errors).
- Keep npm-script names stable (`npm run init|health-check|update|warm:embeddings`) — CI and docs reference them.
- **`--experimental-strip-types` constraint**: local imports MUST carry an explicit `.ts` extension, and any `src/` module imported from a script must itself have no extensionless local imports (that is why `config/fastembed-cache.ts` is import-free). Load env with `--env-file-if-exists=.env` when the script reads app configuration.

<!-- MANUAL: -->
