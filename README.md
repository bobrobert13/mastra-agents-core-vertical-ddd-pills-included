# Mastra Boilerplate

A small, native Mastra application: three agents, three workflows, one workspace,
no custom framework. Built on `@mastra/core` 1.66, `@mastra/memory`, `@mastra/rag`,
`@mastra/mcp`, `@mastra/evals`, and `@mastra/observability`.

## Quickstart

```bash
npm install --legacy-peer-deps   # peer conflict between @mastra/evals and vitest
cp .env.example .env             # optional: every variable is optional
npm run dev                      # Studio + API on http://localhost:4111
```

Without a provider key the app boots, lists its agents and serves `/health`; agent
generation returns a provider 401 at call time. With `DATABASE_URL` unset it uses
LibSQL at `file:./mastra.db`.

```bash
npm run lint
npx tsc --noEmit
npm run test:all
npm run build                    # .mastra/output/index.mjs
```

## Layout

```
src/mastra/
├── index.ts                     # composition root: agents, workflows, storage, server
├── workspace.ts                 # native Workspace + LocalFilesystem (contained)
├── domains/
│   ├── research/                # agent + web tools + deep-research workflow
│   ├── task-management/         # agent + tools + app_tasks repo + daily-digest
│   ├── file-operations/         # agent over the native workspace tools
│   └── knowledge/               # index-knowledge workflow + search_knowledge tool
├── mcp/                         # optional read-only MCP server + stdio entry
├── routes/                      # chat route + CORS surface
└── shared/
    ├── agents/                  # buildMemory, deterministic/optional guardrail processors
    └── config/                  # env-optional infrastructure builders
```

Everything in `shared/config/` is a pure builder over `process.env`: no service
registry, no banner framework. Absence is legal; malformed present values fail fast.

## Agents

| Key | id | Capabilities |
|---|---|---|
| `research` | `research-agent` | DuckDuckGo search, URL fetch, summarize; optional MCP tools |
| `tasks` | `task-management-agent` | create/update/schedule tasks in `app_tasks` |
| `files` | `file-operations-agent` | native workspace read/write/edit/list/grep |

Every agent gets `buildMemory()` (plain history by default) and the processor stack:
`TokenLimiter` always; `PromptInjectionDetector` + `PIIDetector` only when
`SECURITY_PROCESSORS=active` and a provider key exists.

## Workflows

| id | What it does |
|---|---|
| `deep-research` | search → fetch → summarize → **HITL review** (`suspend`/`resume`) |
| `daily-digest` | deterministic digest of open tasks; declares a daily cron schedule |
| `index-knowledge` | read → chunk → embed → store into the knowledge vector index |

`REVIEW_APPROVAL=off` makes `deep-research` publish without human review.

## Native APIs used

- **Agents / tools** — `new Agent({ tools: async () => ... })`, `createTool`, Zod schemas.
- **Memory** — one `Memory` per agent; storage is injected by `Mastra`.
- **Workspace** — `new Workspace({ filesystem: new LocalFilesystem({ basePath }) })`;
  `WORKSPACE_TOOLS` config sets `requireApproval` / `requireReadBeforeWrite`.
- **HITL** — `suspendSchema` / `resumeSchema` on a `createStep`, `run.resume()`.
- **Processors** — `TokenLimiter`, `PromptInjectionDetector`, `PIIDetector` from
  `@mastra/core/processors`.
- **RAG** — `MDocument`, `createVectorQueryTool` from `@mastra/rag`.
- **MCP** — `MCPClient` inbound (routing key `agents`), `MCPServer` outbound (opt-in).
- **Evals** — `runEvals`, `checks.calledTool`, `checks.noToolErrors`.
- **Observability / PubSub** — `Observability` with `MastraStorageExporter`;
  `RedisStreamsPubSub` only when `REDIS_URL` is set.

## Environment

| Variable | Effect when set | When unset |
|---|---|---|
| `DEEPINFRA_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` | provider available | agents 401 at call time |
| `MODEL`, `MODEL_<AGENT>` | model override | `openai/gpt-4o-mini` |
| `DATABASE_URL` (postgres) | PostgresStore + PgVector | LibSQL |
| `LIBSQL_URL` | custom LibSQL location | `file:./mastra.db` |
| `EMBEDDING_MODEL` | semantic recall + `search_knowledge` on | both off |
| `SEMANTIC_RECALL=off` | kill switch | — |
| `MASTRA_JWT_SECRET` | JWT auth on `/api/*` + Studio | public (fatal in production) |
| `AUTH_DISABLED=true` | explicit opt-out | — |
| `REDIS_URL` | Redis Streams PubSub (split workers) | in-process |
| `WORKSPACE_ROOT` | file-tool base directory | `./workspace` |
| `REVIEW_APPROVAL=off` | skip deep-research review | review required |
| `SECURITY_PROCESSORS=active` | mount LLM injection/PII detectors | deterministic only |
| `TOKEN_LIMIT` | input token budget | `8000` |
| `MCP_SERVERS` | JSON inbound MCP servers | off |
| `ENABLE_MCP_SERVER=true` | expose the read-only MCP server | off |
| `CORS_ORIGIN` | comma-separated allow-list | permissive default |
| `ENABLE_OBSERVABILITY=false` | disable tracing | storage-backed tracing |

Storage, vectors, and auth share one resolution path; the boot log prints one line
per service (`Storage:`, `Vectors:`, `Auth:`, `PubSub:`, `MCP:`).

## Commands

```bash
npm run dev              # mastra dev (Studio + API)
npm run build            # mastra build → .mastra/output/
npm run start            # run the built output
npm run health-check     # GET /health
npm run mcp:stdio        # bundle + run the stdio MCP server (needs ENABLE_MCP_SERVER=true)
npm run update           # bump all @mastra/* packages
```

## Docker

```bash
cd docker && docker compose up -d
```

Postgres (pgvector) + the app. The workspace directory is mounted so files survive
container restarts. Production uses one API replica; split workers require
`REDIS_URL` and exactly one scheduler process.

## Docs

- Official Mastra agent skill: `.agents/skills/mastra/SKILL.md`
  (update with `npm run skills:update`)
- [Mastra documentation](https://mastra.ai/docs)
- [Agents](https://mastra.ai/docs/agents/overview)
- [Workflows](https://mastra.ai/docs/workflows/overview)
- [Memory](https://mastra.ai/docs/memory/overview)
- [Workspace](https://mastra.ai/docs/workspace/overview)
- [Evals](https://mastra.ai/docs/evals/overview)
- [MCP](https://mastra.ai/docs/mcp/overview)
