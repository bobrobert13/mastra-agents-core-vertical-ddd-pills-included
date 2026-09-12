<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# docker

## Purpose

Container story: multi-stage image, single-host dev compose (app + PostgreSQL/pgvector), and a 5-service production compose for HA (API + workers + dual-region Postgres).

## Key Files

| File | Description |
|------|-------------|
| `Dockerfile` | Multi-stage: deps → build (`mastra build`) → runtime (`node .mastra/output/index.mjs`) |
| `docker-compose.yml` | Dev: app + Postgres with pgvector; reads env with defaults so it also runs zero-config |
| `docker-compose.prod.yml` | HA: api, workers, postgres primary + replica, etc.; healthchecks, restart policies, resource limits |
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
