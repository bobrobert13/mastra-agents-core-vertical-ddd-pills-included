<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# mastra-boilerplate

## Purpose

Project-agnostic Mastra boilerplate built on **vertical slicing / DDD**: four example agent domains, infrastructure that is **100% optional and env-driven**, high-availability Docker deployments, comprehensive testing (smoke + unit + integration + evals), and a self-updating toolchain (Renovate + changesets + Mastra codemods). Clone it, delete the example domains you don't need, and start building.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Scripts, deps. **All `npm install` must use `--legacy-peer-deps`** (peer conflicts with @mastra/evals) |
| `tsconfig.json` | TS strict mode; path aliases `@mastra/*` |
| `eslint.config.js` | ESLint 9 **flat config** (`.eslintrc.json` is obsolete — do not recreate) |
| `.env.example` | Every variable is OPTIONAL; app runs with zero config |
| `vitest.config.ts` | Vitest 3.x (required by @mastra/evals) |
| `AGENTS.md` | This file — hierarchical docs index |
| `README.md` | Human-facing quickstart |
| `PHASE-1-COMPLETION.md` / `PHASE-2-COMPLETION.md` / `PROJECT-COMPLETION.md` | Build-phase records |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/mastra/` | All source: domains + shared (see `src/mastra/AGENTS.md`) |
| `tests/` | unit / integration / evals suites (see `tests/AGENTS.md`) |
| `docker/` | Dockerfile + compose dev/prod HA (see `docker/AGENTS.md`) |
| `scripts/` | init, health-check, self-update bash scripts (see `scripts/AGENTS.md`) |
| `docs/` | ADRs, domain docs, testing guide (see `docs/AGENTS.md`) |
| `.github/` | CI workflows + Renovate config |

## Documentation Hierarchy (index)

```
AGENTS.md                        ← you are here (rules, conventions, updates, deploy)
├── .github/AGENTS.md            ← CI gates + self-update pipeline
├── docker/AGENTS.md             ← container/dev-HA/prod-HA deployment
├── docs/AGENTS.md               ← ADR + domain docs conventions
│   ├── adr/AGENTS.md
│   └── domains/AGENTS.md
├── scripts/AGENTS.md            ← operator bash scripts
├── src/mastra/AGENTS.md         ← app composition
│   ├── domains/AGENTS.md        ← vertical-slice rules
│   │   ├── research/AGENTS.md
│   │   ├── task-management/AGENTS.md
│   │   ├── file-operations/AGENTS.md
│   │   └── communication/AGENTS.md
│   └── shared/AGENTS.md         ← logger, event bus, optional-infrastructure engine
└── tests/AGENTS.md              ← test pyramid + known pitfalls
```

## How It Works — Optional Infrastructure

**Rule: no env var ⇒ no error, the service is simply inactive.** The composition root is `src/mastra/shared/config/infrastructure.ts`; each service builder lives in its own module (`storage.ts`, `vectors.ts`, `observability.ts`, `pubsub.ts`, `auth.ts`, `providers.ts`, banner in `service-status.ts`, model resolution in `model.ts`, schedules reporting in `schedules.ts`):

| Service | Activated by | Fallback when unset |
|---------|-------------|---------------------|
| Storage: PostgreSQL | `DATABASE_URL` (starts with `postgres`) | — |
| Storage: LibSQL custom | `LIBSQL_URL` (only if no DATABASE_URL) | — |
| Storage: default | — | LibSQL local `file:./mastra.db` |
| Vector store | follows storage: `DATABASE_URL` postgres → PgVector; else LibSQLVector | always built unless `SEMANTIC_RECALL=off` (ADR-006) |
| Semantic recall | embedder available (`EMBEDDING_MODEL` → ModelRouter; unset → local fastembed E5, key-free) | `○ Semantic recall  off (no embedder)` — generate unaffected, plain history only |
| Knowledge RAG | same embedder condition | `index-knowledge` workflow + `search_knowledge` tool registered / `off (no embedder)` |
| PubSub (workers HA) | `REDIS_URL` → Redis Streams (ADR-005; also bridges the domain event bus across processes) | in-process EventEmitterPubSub; split workers unavailable |
| Auth (Server & Studio) | `MASTRA_JWT_SECRET` (+ `MASTRA_WORKER_AUTH_TOKEN` → worker bearer via CompositeAuth) | dev: inert + ⚠️ UNAUTHENTICATED banner line; **production: FATAL exit(1)** unless `AUTH_DISABLED=true` (ADR-004) |
| Observability | enabled by default | disable with `ENABLE_OBSERVABILITY=false` |
| Model providers | any of `DEEPINFRA_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` | agents 401 at call time, app still boots |
| Model selection | `MODEL` / `MODEL_<AGENT>` / `DEFAULT_MODEL` (see `shared/config/model.ts`) | built-in default `openai/gpt-4o-mini` |
| Scope guard | on by default (`SCOPE_GUARD_MODEL` optional) | `SCOPE_GUARD=off` disables; inert (fail-open) with no provider key |
| MCP client (inbound) | `MCP_SERVERS` (JSON; `${VAR}` interpolation; `agents` routing key) | `○ MCP client` off — set `MCP_SERVERS` to connect external servers; set-but-invalid JSON **fails boot** (spec 04) |
| MCP server (outbound) | `ENABLE_MCP_SERVER=true` (exact string) | `○ MCP server` disabled — read-only surface; requires Spec 01 auth outside localhost |

At startup the server prints a **service availability banner** (✅ active / ○ inactive per service). Keep it in sync when adding optional services.

## For AI Agents

### Working In This Directory
- **Vertical slices**: everything a domain needs lives inside its folder. Domains NEVER import from other domains — cross-domain traffic goes through `shared/events/event-bus.ts`.
- Only truly cross-cutting code goes in `src/mastra/shared/`.
- **Every `new Agent` MUST be scope-enforced (hard rule, see gotcha #7)**: wire `createScopeGuard(domainScope)` into `inputProcessors` AND build instructions with `scopedInstructions(domainScope, body)` from `shared/processors/scope-guard.ts` / `shared/agents/scoped-instructions.ts`. Positive-only instructions are forbidden — a capable model will otherwise answer anything. Each domain exports its `DomainScope` (plain data; siblings listed without imports).
- Register new agents in `src/mastra/index.ts` (agents map) — and new workflows in its `workflows` map (unregistered workflows stay invisible to `/api/workflows`; this actually happened with `deep-research`). Storage/observability wiring is already automatic.
- Memory-enabled agents require `memory: { thread, resource }` in raw API generate calls; Studio supplies it automatically.
- Off-topic input to a scoped agent returns empty text with a `tripwire` reason (the abort redirect) — the guard working, not a bug.
- **Never hard-code infra requirements**: new services must follow the env-optional pattern above and report status in the banner.

### Testing Requirements (before any commit)
```bash
npm run lint             # eslint src --max-warnings=0 → 0 errors / 0 warnings
npx tsc --noEmit         # covers src + tests
npm run test:all         # smoke → unit → integration → evals
npm run build            # outputs .mastra/output/ (NOT dist/)
timeout 15 npm run dev   # verify boot + banner + /api/workflows, then kill
```

### GitHub Conventions
- **Commits**: Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`, `ci:`). Subject ≤ 72 chars, imperative mood, body only when the *why* isn't obvious.
- **Branches**: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.
- **PRs**: title follows commit convention; description = Summary bullets + Test plan checklist.
- **CI gates** (`.github/workflows/ci.yml`): lint, build, test-smoke, test-unit, test-integration, test-evals. A PR is mergeable only when all pass. `package-lock.json` **must stay committed** (jobs use `npm ci` + workflow-level `npm_config_legacy_peer_deps=true`).
- Do not commit `.env`, `*.db*`, `.mastra/`, `node_modules/` (already gitignored).

### Updating Dependencies (self-update system)
- **Renovate** (`.github/renovate.json`) opens grouped PRs for `@mastra/*` and deps.
- **`npm run update`** (`scripts/update-mastra.sh`) bumps all Mastra packages at once.
- **Weekly codemod job** (`.github/workflows/auto-update.yml`) runs `npx @mastra/codemod@latest` and files an issue on findings.
- **changesets** (`npx changeset`) records breaking/feature changes for release notes.
- After ANY dependency bump, re-run the full test gate above.

## Environment Gotchas (learned the hard way)

1. `npm install` without `--legacy-peer-deps` fails with ERESOLVE (@mastra/evals ↔ vitest).
2. Built-in Mastra tools (`webSearchTool`, etc.) only support OpenAI/Anthropic/Google/xAI — on any other provider write a custom tool (the DuckDuckGo `web-search.ts` in the research domain is the reference pattern).
3. `Agent` class does NOT expose `tools`/`memory`/`instructions` publicly — unit tests can only assert `id`, `name`, `model`.
4. `@mastra/core/scores` does not exist in current version — scorers use the per-domain pattern in `research/scorers/`.
5. **Never hard-code a model string** — always `agentModel.<key>()` / `memoryModel()` from `shared/config/model.ts` (`provider/model-id` format, e.g. `deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731`, `anthropic/claude-sonnet-4-5`, `ollama/llama3.1`).
6. `mastra build` writes to `.mastra/output/`; scripts referencing `dist/` are wrong.
7. **Agents answer anything unless hard-guarded (real incident 2026-09-13)**: asked "qué pasó en la resurrección de Cristo?", the file-operations agent replied from general knowledge AND hallucinated a `read nonexistent-file` tool call. Positive-only instructions do NOT scope an agent. Fix = `createScopeGuard()` (LLM classifier → `abort()` → TripWire before the model runs; off-topic gets a one-line redirect naming the right agent) + `scopedInstructions()`; guard is on by default (`SCOPE_GUARD=off` to disable) and fails open when no provider key exists (banner shows "Scope guard: inert").
8. LibSQL does NOT implement the observability **feedback** methods (`listFeedback`, aggregates, write) — Studio's feedback tab 500s without `shared/config/libsql-feedback-compat.ts` being wired into every LibSQL instance. Full feedback surface = PostgreSQL only.
9. **Auth protects `/api/*` + Studio but NOT root `/health`** — defaults are protected `["/api/*"]`, public `["/api","/api/auth/*"]`, and `/health` lives at root, so the compose healthcheck keeps working unauthenticated. With `NODE_ENV=production` and no auth the process refuses to boot (`MASTRA_JWT_SECRET`, or the explicit `AUTH_DISABLED=true` escape hatch). A custom `server.apiPrefix` breaks those defaults — `buildAuth` rewrites protected/public from `MASTRA_API_PREFIX` and warns; any new root-level route is public by default. Studio login (JWT-capable) = Settings → Headers → `Authorization: Bearer <jwt>`.
10. **Prod HA needs `REDIS_URL`** — split workers (orchestration/scheduler/backgroundTasks) do not start against the in-process default (docs); exactly ONE scheduler replica fleet-wide or every cron tick fires twice. The domain `eventBus` bridges cross-process ONLY when `REDIS_URL` is set (ADR-005); without it it is a single-process EventEmitter by design.
11. **`MASTRA_WORKERS=false` silently disables schedules** — a workflow declaring `schedule` (daily-digest → row `wf_daily-digest`) registers but NEVER fires with all workers off; unset the var (dev auto-starts the in-process scheduler) or run one scheduler worker. Also: custom app tables (`app_tasks`) live beside Mastra's own and are created/migrated by the domain repo (`ensureSchema`, additive-only) — NOT by Mastra init/prune (ADR-008).
12. **Sticky vector dimensions** — an index serves one embedder dimension forever. Memory's derived recall index is keyed by the PROBED DIMENSION (`memory_messages[_<dim>]`, indexName unset): cross-dim `EMBEDDING_MODEL` switch silently cold-resets recall (orphan old index — delete manually); same-dim switch (e.g. `text-embedding-3-small` → `ada-002`, both 1536d) silently MIXES vectors with no error. Treat embedder changes as re-index events; the knowledge workflow instead fail-fasts with `VectorDimensionMismatchError` (ADR-006).
13. **fastembed first run downloads a model** — a multi-hundred-MB ONNX tarball from storage.googleapis.com into `~/.cache/mastra/fastembed-models`. Offline + cold cache ⇒ ONE canonical warn, recall OFF, process survives. Pre-warm CI with `warmup()` from `@mastra/fastembed` + cache-probe `skipIf` (pattern: `tests/integration/semantic-recall.test.ts`). Its native binary dep `@anush008/tokenizers` MUST stay in `bundler.externals` (set in `src/mastra/index.ts`) or `mastra build`/`mastra worker build` die on the `.node` analysis.
14. **Recall works keyless; ANSWERING doesn't** — zero-key recall stores/recalls vectors fine (local E5), but `generate()` still 401s without a provider API key. Two different degradations with different banner lines — do not conflate them in tests or docs.
15. **MCP tool responses and tool descriptions are untrusted model input**: `MCP_SERVERS` wires third-party tools into agents without review. Default `requireToolApproval` (`defaultMcpApprovalPolicy`) gates mutating NAMES only (write/edit/delete/remove/drop/create/update incl. camelCase via `toSnake` — `purge_all` dodges it: floor, not ceiling; set `"requireToolApproval": true` wholesale for untrusted servers); `forwardInstructions` stays `false`; the scope guard NEVER inspects tool I/O — Spec 06's `PromptInjectionDetector` is the designated output sanitizer (until then MCP = dev-local trust boundary). The exposed `boilerplate` MCPServer is read-only by construction (ADR-007).

## Development Workflow

### Adding a New Domain
1. Create `src/mastra/domains/<domain-name>/` with `agent.ts` (scope + guard wired — see gotcha #7), `tools/`, optional `workflows/`, `scorers/`, `entities/`, `events.ts`, `index.ts` (barrel exports the agent, `*Scope` and `*ScopeGuard`).
2. Register agent (and any workflow) in the `agents`/`workflows` maps of `src/mastra/index.ts`.
3. Add `tests/unit/domains/<domain>/`, `tests/evals/<domain>.eval.test.ts`.
4. Document in `docs/domains/<domain>.md` and add an `AGENTS.md` for the domain folder.

### Adding a New Tool
1. `src/mastra/domains/<domain>/tools/<tool-name>.ts` with `createTool()` + Zod schemas.
2. Use `logger` from `src/mastra/shared/logger.ts` — never raw `console.*` (no-console lint rule).
3. Export from domain `index.ts`; add unit test.

### Running Tests
```bash
npm run test:all        # smoke → unit → integration → evals
npm run test:smoke      # zero-config boot of the real instance
npm run test:unit       # fast deterministic
npm run test:integration
npm run test:evals      # structural today (offline-safe), live when skipIf-guarded
npm run test:unit -- domains/research   # one area
```

## Common Patterns

### Creating a Tool
```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { logger } from '../../../shared/logger';

export const myTool = createTool({
  id: 'my-tool',
  description: 'What this tool does',
  inputSchema: z.object({ param: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ param }) => {
    try {
      return { result: 'done' };
    } catch (error) {
      logger.error('Tool failed:', error);
      throw error;
    }
  },
});
```

### Creating an Agent
```typescript
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { agentModel, memoryModel } from '../../shared/config/model';

export const myScope: DomainScope = {
  domain: 'my-domain', agentName: 'My Agent',
  scope: 'the ONE thing this agent does', outOfScopeExamples: ['...'],
  siblings: [/* the other agents, as plain data */],
};
export const myScopeGuard = createScopeGuard(myScope);

export const myAgent = new Agent({
  id: 'my-agent',
  name: 'My Agent',
  instructions: scopedInstructions(myScope, 'You are...'),
  model: agentModel.research(), /* precedence: MODEL_<AGENT> > MODEL > DEFAULT_MODEL */
  inputProcessors: [myScopeGuard], /* hard scope: aborts off-topic BEFORE the LLM */
  memory: new Memory({
    options: {
      observationalMemory: {
        model: memoryModel(),
      },
    },
  }),
});
```

### Creating a Workflow
```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

const myStep = createStep({
  id: 'my-step',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ output: z.string() }),
  execute: async ({ inputData }) => ({ output: inputData.input }),
});

export const myWorkflow = createWorkflow({
  id: 'my-workflow',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ output: z.string() }),
}).then(myStep).commit();
```

## Deployment

```bash
# Dev (zero-config)
npm run dev                        # Studio: http://localhost:4111

# Docker dev (app + PostgreSQL w/ pgvector)
cd docker && docker-compose up -d

# Production HA (api×3, orchestration×2, scheduler×1, background-tasks×2, postgres, redis)
cd docker && docker-compose -f docker-compose.prod.yml up -d

# Health check any deployment
npm run health-check
```

Mastra Platform (optional): set `MASTRA_PLATFORM_ACCESS_TOKEN`, `MASTRA_PROJECT_ID`, `MASTRA_ORG_ID` then `npm run deploy:staging|production`.

## Troubleshooting

- **"This storage provider does not support listing feedback" (Studio, LibSQL mode)** ⇒ the compat shim in `src/mastra/shared/config/libsql-feedback-compat.ts` must be wired (it is, via `createLibSQLStorage` in `config/storage.ts`). LibSQL persists only spans/traces; the full feedback surface (write + analytics) requires PostgreSQL `DATABASE_URL`.
- **DB connection (SASL/auth) errors** ⇒ bad `DATABASE_URL`; app intentionally falls back to nothing else — unset it for LibSQL dev mode.
- **HTTP 400 from a tool** ⇒ likely a built-in tool with an unsupported provider; write a custom tool.
- **Port 4111 busy** ⇒ `pkill -f "mastra dev"`; the dev user controls server lifecycle.
- **Worker duplication** ⇒ run exactly ONE scheduler (`MASTRA_WORKERS=scheduler`, compose `replicas: 1`); never scale it — multiple schedulers fire every cron tick twice. Orchestration/backgroundTasks DO scale horizontally (consumer groups).
- **Split workers not starting** ⇒ `REDIS_URL` missing: distributed PubSub is a hard requirement of the split topology (ADR-005); without it Mastra keeps the in-process bus and workers serve nothing cross-process.

## Resources

- [Mastra Documentation](https://mastra.ai/docs)
- [Mastra Models](https://mastra.ai/models)
- [Vertical Slice Architecture](https://jeremydmiller.com/2026-06-04/the-codebase-is-the-prompt-wolverine-vertical-slices-and-ai-assisted-development/)
- [DDD for AI Agents](https://slavadubrov.github.io/blog/2025-10-20/domain-driven-design-ai-agents/)

<!-- MANUAL: Any notes added below this line are preserved on regeneration -->
