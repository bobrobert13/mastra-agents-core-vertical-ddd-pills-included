# mastra-boilerplate — agent guide

Three agents, three workflows, native Mastra APIs. No custom meta-framework.

## Hard rules — native Mastra only (non-negotiable)

**If Mastra exposes it, you MUST use it.** Check in this order and stop at the first
that answers:

1. the official skill + embedded docs (`.agents/skills/mastra/SKILL.md`,
   `node_modules/@mastra/*/dist/docs/`),
2. the installed typings/source (`node_modules/@mastra/*/dist/**/*.d.ts`),
3. the official remote docs (table below, `https://mastra.ai/llms.txt`),
4. the existing code in this repo,
5. only then write new code — and it needs the justification below.

### Forbidden: do not reintroduce these layers

This repo deliberately deleted them once. A PR that adds any of the following is
rejected unless it links the official doc URL proving the capability does not exist
in the installed Mastra version.

- Custom scope/topic classifiers, prompt-injection wrappers or refusal messaging —
  use `PromptInjectionDetector` / `PIIDetector` from `@mastra/core/processors`.
- Custom `AppResult` / `AppError` / domain handler layers — throw, or return an
  object shaped by the tool's `outputSchema`.
- A custom event bus, outbox or Redis bridge — use `PubSub` and Mastra events.
- Custom request-tracing middleware or pipeline timers — use `Observability`.
- A custom eval runner, gate runner, baseline file or dataset seeder — use
  `runEvals`, `checks` and `@mastra/evals`.
- Custom file read/write/edit/list tools, path jails or `FILE_JAIL` switches — use
  `Workspace` + `LocalFilesystem`.
- Custom env validators, service registries or availability banners — each
  `shared/config/*` builder returns `undefined`/`{}` when its env var is absent.
- Custom embedding parsers, fastembed cache probes or dimension latches — use
  `EMBEDDING_MODEL` + `ModelRouterEmbeddingModel`.
- Custom HTTP health/webhook/rate-limit middleware or chat serializers — use
  `chatRoute`, `apiRoutes` and Mastra's server config.
- A custom agent builder, `scopedInstructions`, connector resolver or domain
  catalog — use `new Agent({ ... })` and explicit `tools`/`processors` maps.
- Provider/model detection helpers — use `agentModel.<key>()`.

### Addition budget

Any new file under `src/mastra/shared/` or `src/mastra/domains/*/functions/` needs a
header comment with:

```
Native alternative checked: <official doc URL>
Why it is insufficient: <one sentence, version-specific>
```

No wrapper whose body only renames an expression, no abstraction with a single call
site, no "future-proofing" parameter that nothing passes. If a capability is used by
exactly one domain, keep it in that domain.

### Documentation is part of the code

Every agent, workflow, tool and `shared/config` service builder MUST cite the
official Mastra page for the API it uses in its header comment (one URL is enough).
When you add a capability, add its URL to [Official documentation](#official-documentation);
when a link moves, update it in the same PR.

## Skills

`.agents/skills/mastra/SKILL.md` is the **official Mastra skill** (Apache-2.0, vendored
from https://github.com/mastra-ai/skills). Read it before writing or refactoring any
Mastra code — it is the fastest path to the installed API and defines the same lookup
order as the hard rules above.

- Never edit `.agents/skills/**` by hand: it is vendored.
- Update it with `npm run skills:update`
  (`npx skills add https://github.com/mastra-ai/skills --skill mastra`).
- Its references cover core concepts, embedded docs, model selection, migrations,
  common errors, `mastra api`, platform deployment and trace queries.

## Rules

- **Install with `--legacy-peer-deps`.** `@mastra/evals` and `vitest` have a peer conflict.
- **No hard-coded model strings.** Use `agentModel.<key>()` from
  `src/mastra/shared/config/model.ts` (`provider/model-id` format).
- **No hard-coded infra requirements.** A missing env var disables the service; a
  present-but-malformed value fails boot.
- **`src/mastra/shared/` never imports from `src/mastra/domains/`.** The composition
  root and `src/mastra/mcp/` are the only places that assemble domains.
- **Build output is `.mastra/output/`**, not `dist/`.

## Layout and contracts

| Path | Contract |
|---|---|
| `src/mastra/index.ts` | registers `research`/`tasks`/`files`, three workflows, vectors, tools, MCP |
| `src/mastra/workspace.ts` | one `Workspace`; top-level `await workspace.init()`; contained to `WORKSPACE_ROOT` |
| `shared/agents/memory.ts` | `buildMemory()`; recall only when `EMBEDDING_MODEL` is set |
| `shared/agents/security.ts` | `TokenLimiter` always; LLM detectors opt-in (`SECURITY_PROCESSORS=active` + key) |
| `shared/config/vectors.ts` | single source for embedder, vector store, recall options |
| `domains/*/agent.ts` | `new Agent({ ... })` with explicit tools/processors; no builder indirection |
| `domains/task-management/repo/schema.ts` | `app_tasks` DDL; repository and tools must match it exactly |

## Adding an agent

1. Create `src/mastra/domains/<name>/{agent.ts,instructions.ts,index.ts}`.
2. In `agent.ts` use `new Agent({ id, name, description, instructions, model, tools,
   memory: buildMemory(), inputProcessors: inputProcessors(), outputProcessors: outputProcessors(), defaultOptions })`.
3. Add the model key to `ModelKey` + `agentModel` if the agent needs its own override.
4. Register it in the `agents` map of `src/mastra/index.ts` (unregistered agents are invisible).
5. Add a unit test for pure logic and, if it has a workflow, an integration test.

## Adding a tool

```ts
export const myTool = createTool({
  id: 'my-tool',
  description: 'What it does',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ output: z.string() }),
  execute: async ({ input }) => ({ output: input }),
});
```

Keep `execute` a thin adapter; move real algorithms into `functions/` so they are
testable without a tool context. Use `logger` from `shared/logger.ts` — never
`console.*` in `src/`.

## Memory, recall, and storage

- `Memory` is constructed once per agent at module load. Storage is injected by
  `Agent.getMemory()` / `Mastra`; do not pass `storage` to `buildMemory()`.
- Semantic recall and `search_knowledge` require `EMBEDDING_MODEL`. Unset means plain
  history and no knowledge tool — never an error.
- The vector store follows storage: `DATABASE_URL` (postgres) → PgVector, else
  LibSQLVector at `LIBSQL_URL ?? file:./mastra.db`. Changing the embedder dimension
  requires re-indexing.

## Workspace and approvals

- File paths resolve under `WORKSPACE_ROOT` (default `./workspace`, resolved against
  the process CWD); escapes throw.
- `write_file`, `edit_file`, `delete` and `mkdir` require human approval
  (`requireApproval: true`); writes/edits also require a prior read.
- Do not add a second file-tool implementation; use the workspace tools.

## HTTP and MCP

- `chatRoute({ path: '/chat/:agentId', version: 'v7' })` is the only custom route.
- `/health` stays public; `/api/*` and Studio follow `MASTRA_JWT_SECRET`
  (production without auth is fatal unless `AUTH_DISABLED=true`).
- The outbound MCP server is opt-in (`ENABLE_MCP_SERVER=true`) and exposes only the
  research agent. Inbound MCP servers default to `requireToolApproval: true`.

## Official documentation

Canonical reference list — cite the relevant page from module headers and keep this
table current.

| Capability | Official reference |
|---|---|
| Installed Mastra skill | `.agents/skills/mastra/SKILL.md` |
| Agents | https://mastra.ai/docs/agents/overview |
| Tools | https://mastra.ai/docs/agents/tools |
| Processors / guardrails | https://mastra.ai/docs/agents/processors · https://mastra.ai/docs/agents/guardrails |
| Models | https://mastra.ai/docs/models |
| Workflows | https://mastra.ai/docs/workflows/overview |
| Suspend / resume (HITL) | https://mastra.ai/docs/workflows/suspend-and-resume |
| Memory | https://mastra.ai/docs/memory/overview |
| Storage | https://mastra.ai/docs/storage/overview |
| Workspace | https://mastra.ai/docs/workspace/overview |
| RAG / vectors | https://mastra.ai/docs/rag/overview · https://mastra.ai/docs/rag/vector-databases |
| MCP | https://mastra.ai/docs/mcp/overview |
| Evals | https://mastra.ai/docs/evals/overview |
| Observability | https://mastra.ai/docs/observability/overview |
| Server / auth / PubSub | https://mastra.ai/docs/server/overview · https://mastra.ai/docs/server/auth · https://mastra.ai/docs/server/pubsub |
| Deployment | https://mastra.ai/docs/deployment/overview |
| All docs | https://mastra.ai/docs |

## Verification before committing

```bash
npm run lint             # eslint src --max-warnings=0
npx tsc --noEmit
npm run test:all
npm run build
timeout 20 npm run dev   # check the Storage:/Vectors:/Auth:/PubSub:/MCP: lines
```

Commit messages follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`,
`chore:`, `test:`, `ci:`). Do not commit `.env`, `*.db*`, `.mastra/`, or `node_modules/`.
