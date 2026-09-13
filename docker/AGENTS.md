<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# docker

## Purpose

Container story: multi-stage image, single-host dev compose (app + PostgreSQL/pgvector), and a genuinely distributed production compose for HA (API + split workers + Redis Streams PubSub + Postgres).

## Key Files

| File | Description |
|------|-------------|
| `Dockerfile` | Multi-stage, role-switched by `MASTRA_OUTPUT` build arg: `.mastra/output` (API, `mastra build`) or `.mastra/worker` (worker, `mastra worker build`); same runner, role selected via `MASTRA_WORKERS`; `node -e` HEALTHCHECK (no curl in node:22-alpine) |
| `docker-compose.yml` | Dev: app + Postgres with pgvector; reads env with defaults so it also runs zero-config |
| `docker-compose.prod.yml` | HA: api×3 + orchestration×2 + scheduler×1 + background-tasks×2 + postgres + redis:7-alpine (AOF, never host-published); shared env via `x-mastra-env`; workers `depends_on` api/redis healthy. Scheduler is single-instance — never scale (duplicate cron fires). Step execution is at-least-once: handlers must be idempotent; no DLQ |
| `init.sql` | Creates pgvector extension, `embeddings` and `domain_events` tables for future RAG + event persistence |

## For AI Agents

### Working In This Directory
- The app image must keep working with **no env vars** (LibSQL fallback) — compose files add Postgres by setting `DATABASE_URL`; never make it required in the image itself.
- Storage inside containers uses named volumes; do not bind-mount `src/`.
- Bump base image / node version together with root `package.json` engines.

### Testing Requirements
- `docker-compose -f docker-compose.prod.yml config` must validate.
- `npm run health-check` (scripts/) targets these deployments.

## Dependencies

### Internal
- Built image consumes root `package.json` + `src/` only.

<!-- MANUAL: -->
