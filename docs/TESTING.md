# Testing

Four tiers, all runnable with zero API keys.

```bash
npm run test:unit         # deterministic: processors, workspace, repo, pure functions
npm run test:smoke        # boots the real Mastra instance (LibSQL fallback)
npm run test:integration  # workflows + tools against LibSQL/:memory: and a stub embedder
npm run test:evals        # LLM-judge evals; self-skips without a provider key
npm run test:all          # smoke → unit → integration → evals
```

## Keyless vs keyed

| Tier | Keys needed | Notes |
|---|---|---|
| unit | none | LibSQL `:memory:`, no network |
| smoke | none | real `src/mastra/index.ts`, default LibSQL file |
| integration | none | HITL stubs `fetch`; knowledge uses a hashing embedder; MCP uses a local echo server |
| evals | one provider key | `describe.skipIf(!hasProviderKey)` — CI-safe |

`EMBEDDING_MODEL` is deliberately unset in tests: semantic recall and `search_knowledge`
stay off, which the smoke test asserts.

## Deterministic fixtures

- `tests/helpers/deterministic-embedder.ts` — bag-of-words hashing embedder; shared
  tokens produce high cosine similarity, so RAG behavior is observable offline.
- `tests/integration/helpers/echo-mcp-server.mjs` — local stdio MCP server spawned
  with `process.execPath`; no npx, no network.
- `tests/integration/hitl-suspend-resume.test.ts` — stubs global `fetch` so the real
  `deep-research` steps run without public-web traffic.

## Databases

- Unit/integration: LibSQL `:memory:` (`createAppDatabase({ dialect: 'libsql', url: ':memory:' })`).
- Smoke: the app's default `file:./mastra.db` (gitignored).
- No Postgres or Redis service is required by any kept test.

## Adding tests

Prefer proving behavior through the public surface: a workflow run, a tool `execute`,
or the `Mastra` registry. Tests that only restate a default or assert wiring add
maintenance cost without catching regressions.
