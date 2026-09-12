<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# scripts

## Purpose

Operator-facing bash scripts wired to npm scripts (`init`, `health-check`, `update`). All are `set -e` and executable.

## Key Files

| File | Description |
|------|-------------|
| `init.sh` | First-run bootstrap: installs deps (`--legacy-peer-deps`), copies `.env.example` → `.env` if missing, runs checks |
| `health-check.sh` | Probes running instance (`/health` endpoints on MASTRA_PORT, default 4111), color-coded pass/fail |
| `update-mastra.sh` | Bumps all `@mastra/*` packages to latest and re-runs the test gate |

## For AI Agents

### Working In This Directory
- Scripts must remain **zero-config safe**: absence of `.env`/DB must not fail `init.sh`.
- Keep npm-script names stable (`npm run init|health-check|update`) — CI and docs reference them.

<!-- MANUAL: -->
