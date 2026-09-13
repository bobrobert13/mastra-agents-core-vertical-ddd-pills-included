<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-15 | Updated: 2026-09-15 -->
# knowledge

## Purpose

Chat-with-docs vertical slice (spec 03): a deterministic ETL `index-knowledge` workflow (read → chunk → embed → store into `knowledge_docs`) plus a `search_knowledge` vector-query tool wrapper. **This slice ships NO agent on purpose** — indexing is fixed-order ETL (workflow territory), and query-time conversation lives in the research agent, which resolves `search_knowledge` dynamically from the Mastra `tools` registry.

## Key Files

| File | Description |
|------|-------------|
| `workflows/index-knowledge.ts` | `createIndexKnowledgeWorkflow(deps)` test seam + exported `indexKnowledgeWorkflow`; 4 steps: `read-document` (path-containment vs workspace root) → `chunk-document` (MDocument recursive 512/50) → `embed-chunks` (batched `doEmbed`, ≤256) → `store-chunks` (createIndex or **fail-fast `VectorDimensionMismatchError`**, then idempotent upsert with deterministic ids `docId:index`); publishes `knowledge.indexed` / `knowledge.index-failed` |
| `tools/knowledge-query.ts` | `createKnowledgeQueryTool()` wrapper over `createVectorQueryTool` (`vectorStoreName: 'mastra-vectors'`, `indexName: 'knowledge_docs'`); **null when no embedder resolves** — never throws; rerank OFF by default (zero-key promise) |
| `entities/document.ts` | `KnowledgeDoc` / `KnowledgeChunk` zod entities |
| `events.ts` | `knowledge.indexed` / `knowledge.index-failed` contracts (typed bus) |
| `index.ts` | Barrel — the only import surface for other code |

## For AI Agents

### Working In This Directory
- No `DomainScope`/guard trio here: there is no `new Agent` in this slice, so root-AGENTS.md gotcha #7 is trivially satisfied. Do not add an agent without wiring the scope trio.
- The chunk text lives in **metadata.text**, not `document` — PgVector/LibSQLVector do not populate `document` on `query()`. Consumers must read `metadata.text`.
- `KNOWLEDGE_INDEX_NAME` + the `'search_knowledge'` registry key are contracts with `src/mastra/index.ts` (composition root). Changing either silently breaks the research agent's tool resolution — the DoD tests assert registration.
- Embedder changes are re-index events (gotcha #G3, sticky dimensions): an existing 1024d `knowledge_docs` rejects 1536d writes via `VectorDimensionMismatchError` before any upsert.
- Tests inject a deterministic stub embedder / vector via `createIndexKnowledgeWorkflow(deps)` and `createKnowledgeQueryTool(deps)` — zero network, zero keys.

### Testing Requirements
- Unit: `tests/unit/domains/knowledge/indexing.test.ts` (step logic with stub embedder).
- Integration: `tests/integration/knowledge-rag.test.ts` (Scenario 5 E2E vs `tests/fixtures/knowledge/onboarding.md` + Scenario 6 mismatch).

## Dependencies

### Internal
- `shared/logger.ts`, `shared/events/event-bus.ts`, `shared/config/model.ts` (resolveEmbedder), `shared/config/vectors.ts` (VECTOR_STORE_NAME, latch)

### External
- `@mastra/core/workflows`, `@mastra/rag` (MDocument, createVectorQueryTool), `@mastra/pg`, `zod`

<!-- MANUAL: -->
