# Knowledge Domain — Chat-with-Docs (RAG)

> Vertical slice: `src/mastra/domains/knowledge/`. Ships a workflow + a tool —
> **no agent** (indexing is deterministic ETL; conversation lives in the
> research agent). See `docs/adr/006-vectors-embeddings.md` for the why.

## Flow

```
document (path | inline)
   │  index-knowledge workflow (GET /api/workflows → "index-knowledge")
   ▼
read-document → chunk-document → embed-chunks → store-chunks
   workspace-     MDocument        resolved        knowledge_docs
   contained      recursive        passage         index (+ dim
   read           512/50           embedder        fail-fast)
                                       │
                                       ▼
                          search_knowledge tool (Mastra `tools` registry)
                                       │ resolved dynamically by the
                                       ▼ research agent via listTools()
                        "What laptop budget do new hires get?" → top chunks
```

## 1. Configure (all optional)

| Env | Effect when unset |
|-----|-------------------|
| `EMBEDDING_MODEL` (`provider/model`) | local `@mastra/fastembed` multilingual-E5 (1024d, zero keys, Spanish-friendly) |
| `SEMANTIC_RECALL=off` | master kill-switch → recall + RAG degrade to `Semantic recall: off (no embedder)`, app keeps working with plain history |
| `DATABASE_URL` (postgres) | vector store = `PgVector` (HNSW dotproduct); else `LibSQLVector` on the storage DB file |

Embedder choice is **sticky per index** (dimension forever). Changing
`EMBEDDING_MODEL` = re-index event: delete `knowledge_docs` and re-run
indexing, or the workflow fails fast with `VectorDimensionMismatchError`.

## 2. Index a document

Studio → Workflows → `index-knowledge`, or:

```bash
curl -X POST http://localhost:4111/api/workflows/index-knowledge/run \
  -H 'Content-Type: application/json' \
  -d '{"inputData":{"source":"path","path":"tests/fixtures/knowledge/onboarding.md","contentType":"markdown"}}'
```

- `source:'path'` is confined to the workspace root; `source:'inline'` takes `content` directly.
- Output: `{ docId, indexName, dimension, chunkCount, skippedChunks }`.
- Re-indexing the same `docId` is idempotent (deterministic chunk ids).
- Events: `knowledge.indexed` / `knowledge.index-failed` on the shared bus.

## 3. Opt in and ask an agent

`search_knowledge` is **opt-in per agent** (2026-09-17): the composition root
registers it in the root `tools` registry **iff** the embedder resolved at boot
(check the `Knowledge RAG` banner line), but no agent receives it unless it asks
for it. To enable it in a domain, declare the connector in its `config.ts`:

```ts
export const researchSettings: DomainAgentSettings = {
  modelKey: 'research',
  maxSteps: 50,
  connectors: { memory: 'observational', mcp: 'research', rag: true }, // ← rag: true
};
```

Then ask e.g. *"What laptop budget do new hires get?"* — the agent queries the
semantic index and cites the matching chunks (chunk text is in each result's
`metadata.text`). Without `rag: true` the agent answers from memory/tools as usual
and never sees the tool, even when the registry holds it.

## 4. Programmatic use

```ts
import { createKnowledgeQueryTool, createIndexKnowledgeWorkflow } from './src/mastra/domains/knowledge';

const workflow = createIndexKnowledgeWorkflow({ embedder, vector }); // tests: deterministic stubs
const tool = createKnowledgeQueryTool({ embedder, vector }); // null when recall unavailable
```

## Testing notes

- Offline tiers inject a hashing stub embedder (`tests/helpers/deterministic-embedder.ts`) — zero network, zero keys.
- Real-E5 variants are `skipIf`-guarded on the fastembed cache (`~/.cache/mastra/fastembed-models`); pre-warm CI with `warmup()` from `@mastra/fastembed`.
- The Postgres tier (`tests/integration/pg-vectors.test.ts`) runs only with a pgvector `DATABASE_URL`.
