# Mastra Boilerplate

Project-agnostic starter for AI agents built on [Mastra](https://mastra.ai): vertical-slicing architecture, **zero-config boot**, provider-agnostic models, high-availability Docker deployments, layered testing, CI/CD and a self-updating dependency pipeline.

## 🎯 Features

- **Zero-config boot** — clone → `npm install --legacy-peer-deps` → `npm run dev`. No database, no API key, no `.env` required; every infrastructure dependency activates only when its env var exists (see the startup service banner).
- **Vertical Slicing / DDD** — 4 reference domains (research, task-management, file-operations, communication), each self-contained: agent, tools, workflows, scorers, entities, events. Domains never import each other; cross-domain traffic goes through a typed event bus.
- **Provider-agnostic models** — no model string is hard-coded. Choose via env: `MODEL_<AGENT>` > `MODEL` > `DEFAULT_MODEL` (any `provider/model-id` the [Mastra model router](https://mastra.ai/models) supports).
- **Scope-dedicated agents** — every domain agent is hard-guarded: an LLM classifier aborts off-topic input *before the model runs* and answers with a one-line redirect to the right agent (instructions template + `createScopeGuard`; `SCOPE_GUARD=off` disables, inert without a key).
- **Env-optional infrastructure** — PostgreSQL (+pgvector for future RAG) with LibSQL fallback, Redis Streams PubSub for distributed workers, observability with storage exporter and sensitive-data filter.
- **High Availability** — role-switched multi-stage Dockerfile and a production compose with split workers (API×3 / orchestration×2 / scheduler×1 / backgroundTasks×2 / PostgreSQL / Redis 7).
- **Layered testing** — smoke (zero-config boot), unit, cross-domain integration, structural evals; enforced in CI on every push/PR.
- **Self-updating** — Renovate PRs, `npm run update` (all `@mastra/*` bumped + full gate), weekly Mastra codemod job.
- **Hierarchical agent docs** — 15 `AGENTS.md` files documenting rules, deploys, conventions and gotchas for AI coding agents.

## 📋 Prerequisites

- Node.js **≥ 22.13** (`engines` in package.json)
- Nothing else. PostgreSQL/Docker/API keys are **optional** enhancements.

## 🚀 Quick start

```bash
npm install --legacy-peer-deps   # @mastra/evals ↔ vitest peer conflict (see AGENTS.md gotcha #1)
npm run dev                      # Studio: http://localhost:4111
```

The terminal prints a **service availability banner** — e.g. on a fresh clone:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Mastra Boilerplate — service availability
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Environment: development
✅ Storage          LibSQL local file:./mastra.db — feedback read-only (set DATABASE_URL for PostgreSQL)
✅ Observability    traces stored in configured storage (set ENABLE_OBSERVABILITY=false to disable)
○ Model providers  no API keys found — set a provider key (see .env.example)
Agents: research, tasks, files, comms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Optional full bootstrap (deps + lint + build + tests + git init): `npm run init`.

### Enable a model provider

```bash
cp .env.example .env    # or export in your shell
# one of:
DEEPINFRA_API_KEY=***
OPENAI_API_KEY=***
```

### Choose models (any provider mix)

```bash
MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731   # all agents
MODEL_RESEARCH=anthropic/claude-sonnet-4-5            # per-agent override
```

## 🔌 API surface (verified live)

The Mastra server exposes, among others:

| Endpoint | Response |
|----------|----------|
| `GET /health` | `{"success":true}` |
| `GET /api/agents` | the 4 registered agents with metadata |
| `GET /api/agents/:name` | agent detail (accepts map key or agent id) |
| `GET /api/workflows` | registered workflows (`deep-research`) with step schemas |
| `GET /api/tools` | all domain tools (web search/fetch/summarize, task, file, ask-user) |
| `GET /api/memory/threads` | thread list (storage-backed) |
| `GET /api/observability/feedback` | feedback list — **read-only-empty on LibSQL, fully supported on PostgreSQL** |

Off-topic messages to a scoped agent return empty text with a `tripwire` redirect (e.g. `"File Operations Agent only handles local file operations... Try instead: Research Agent (...)"`) — proof the guard ran, not an error.

`npm run health-check` probes all of this against a running instance (exit 0 only when server, agents API and workflows API respond).

> Generation calls (`POST /api/agents/:id/generate`) require a provider API key and, for memory-enabled agents, a `memory: { thread, resource }` payload — Studio handles threads automatically. The scope guard needs a key too: without one it fails open (banner line: `Scope guard: inert`).

## 🏗️ Architecture

```text
src/mastra/
├── index.ts                  # composition root: registers agents + workflows
├── domains/                  # vertical slices (never import each other)
│   ├── research/             #   agent + 3 tools + deep-research workflow + scorer
│   ├── task-management/      #   agent + 3 tools + Task entity + lifecycle events
│   ├── file-operations/      #   agent + read/write/edit tools
│   └── communication/        #   agent + ask-user tool
└── shared/                   # cross-cutting only
    ├── config/               #   infrastructure.ts (composition root),
    │                         #   storage.ts, observability.ts, providers.ts,
    │                         #   service-status.ts, model.ts, libsql-feedback-compat.ts
    ├── events/event-bus.ts   #   typed pub/sub for cross-domain flows
    ├── tools/run-tool.ts     #   typed direct-execute helper for steps/tests
    └── logger.ts             #   level-filtered logger (LOG_LEVEL)
```

Cross-domain communication is event-driven (ADR-003, superseded by [ADR-005](docs/adr/005-cross-process-eventing.md): in-process by default, Redis bridge when `REDIS_URL` is set). To add a capability: create a new domain folder, register its agent/workflow in `src/mastra/index.ts`, done — nothing else changes.

### Env-optional services

| Service | Activates with | Without it |
|---------|----------------|------------|
| Storage: PostgreSQL | `DATABASE_URL` (`postgres…`) | — |
| Storage: LibSQL custom | `LIBSQL_URL` | — |
| Storage: default | — | LibSQL `file:./mastra.db` |
| Vector store + semantic recall | follows storage (`PgVector`/`LibSQLVector`); embedder = `EMBEDDING_MODEL` or local fastembed E5 (key-free) | `○ … off (no embedder)`; plain history only, `SEMANTIC_RECALL=off` kills it explicitly |
| Knowledge RAG | embedder available | run `index-knowledge`, then the research agent answers with `search_knowledge` / off with no embedder |
| PubSub (workers HA) | `REDIS_URL` → Redis Streams | in-process bus; split workers unavailable |
| Auth (Server & Studio) | `MASTRA_JWT_SECRET` (+ `MASTRA_WORKER_AUTH_TOKEN`) | dev: public + ⚠️ banner line; **prod: refuses to boot** unless `AUTH_DISABLED=true` |
| Observability | on by default | `ENABLE_OBSERVABILITY=false` disables |
| Model providers | any `*_API_KEY` | app boots; generation fails clearly |
| Model selection | `MODEL_<AGENT>` / `MODEL` / `DEFAULT_MODEL` | built-in default |

## 🧪 Testing

```bash
npm run test:all       # smoke → unit → integration → evals (what CI runs)
npm run test:smoke     # zero-config boot: instance + 4 agents + storage
npm run test:unit      # deterministic per-component (18)
npm run test:integration
npm run test:evals     # structural agent/dataset assertions (offline-safe)
```

| Tier | Files | Purpose |
|------|-------|---------|
| Smoke | `tests/smoke/` | the whole instance constructs with **zero env vars**; agents/workflow registered |
| Unit | `tests/unit/` | agents identity, tools behavior, event bus |
| Integration | `tests/integration/` | cross-domain event flow (Postgres service in CI) |
| Evals | `tests/evals/` | agent structure + dataset contracts (Mastra Evals-ready layout for live LLM evals) |

Details: `docs/TESTING.md`.

## 📦 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Mastra dev server + Studio (hot reload) |
| `npm run build` | production bundle → `.mastra/output/` |
| `npm run start` | run the built bundle |
| `npm run init` | full bootstrap: deps + lint + build + tests + git |
| `npm run lint` | ESLint, **fails on errors or warnings** (`--max-warnings=0`) |
| `npm run lint:fix` / `format` / `format:check` | Prettier/ESLint writers |
| `npm run test` / `test:all` / `test:watch` | vitest runners |
| `npm run health-check` | probe a running instance (server, agents, workflows, storage, keys) |
| `npm run update` | bump all `@mastra/*` + re-run the quality gate |
| `npm run deploy:staging` / `deploy:production` | Mastra Platform deploy (needs platform env vars) |

## 🐳 Docker

```bash
cd docker
docker-compose up -d                                # dev: app + PostgreSQL/pgvector
docker-compose -f docker-compose.prod.yml up -d     # HA: api×3, orchestration×2, scheduler×1, background-tasks×2, postgres, redis
```

Production HA runs a genuinely distributed stack: Redis 7 (AOF; Redis Streams PubSub — never host-exposed) is required for split workers; events cross processes via the bridge (at-least-once, ADR-005); unacknowledged events survive API/Redis restarts; there is no DLQ — stuck runs stay observable in storage. Zero-config `npm run dev` remains untouched.

## 🔄 Auto-update

- **Renovate** (`.github/renovate.json`): grouped `@mastra/*` update PRs.
- **`npm run update`**: local one-shot bump with the full gate after.
- **Weekly codemod job** (`.github/workflows/auto-update.yml`): runs `npx @mastra/codemod@latest` and files an issue when migrations are suggested.
- Changesets are recommended for release notes: `npx changeset` after user-visible changes.

Every dependency bump must pass: `npm run lint` → `npx tsc --noEmit` → `npm run test:all` → `npm run build`.

## 🤝 Contributing conventions

- **Conventional Commits** (`feat:`, `fix:`, `test:`, `docs:`, `chore:`…), imperative, ≤ 72 chars.
- Branches `feat/<slug>`, `fix/<slug>`; PRs = Summary + Test plan; CI gates must be green to merge.
- Never hard-code a model string; never bypass the env-optional pattern; use `logger`, not `console`.
- Full rules: `AGENTS.md` (root) and the per-directory hierarchy linked from its Documentation Hierarchy index.

## 📚 Documentation

- `AGENTS.md` — rules, workflows, deployment, self-update, gotchas
- `docs/adr/` — architecture decision records (vertical slicing, pgvector, event-driven)
- `docs/TESTING.md` — test tiers and evals
- `docs/domains/` — per-domain reference notes

## 📄 License

MIT
