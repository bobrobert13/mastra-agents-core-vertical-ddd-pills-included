<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-15 | Updated: 2026-09-17 -->
# knowledge

## Purpose

Chat-with-docs vertical slice (spec 03): a deterministic ETL `index-knowledge` workflow (read → chunk → embed → store into `knowledge_docs`) plus a `search_knowledge` vector-query tool wrapper. **This slice ships NO agent on purpose** — indexing is fixed-order ETL (workflow territory), and query-time conversation lives in whichever agent opts into the tool. `search_knowledge` stays registered in the root Mastra `tools` registry when an embedder resolves, but each agent receives it ONLY through `connectors: { rag: true }`.

## Key Files

| File | Description |
|------|-------------|
| `workflows/index-knowledge.ts` | Composition only (44 LOC): `createIndexKnowledgeWorkflow(deps)` test seam + exported `indexKnowledgeWorkflow` + `knowledgeIndexingAvailable()`; wires the 4 steps `read-document` → `chunk-document` → `embed-chunks` → `store-chunks`. Re-exports `KNOWLEDGE_INDEX_NAME`, `VectorDimensionMismatchError` and the `IndexKnowledgeDeps` type so the pre-split import surface is unchanged |
| `workflows/schemas.ts` | Shared inter-step Zod (`IndexKnowledgeDeps` DI seam, `chunkItemSchema`, `workflowInputSchema`/`workflowOutputSchema`, `readDocSchema`, `chunkedDocSchema`, `embeddedDocSchema`) — the chunk shape is declared ONCE |
| `workflows/steps/read-document.ts` | `read-document`: resolve path (workspace containment) or inline, derive stable docId |
| `workflows/steps/chunk-document.ts` | `chunk-document`: MDocument recursive chunking 512/50, deterministic `<docId>:<index>` ids |
| `workflows/steps/embed-chunks.ts` | `embed-chunks`: batched `doEmbed` (≤`EMBED_BATCH`); on failure latches the health flag + publishes `knowledge.index-failed`, then rethrows |
| `workflows/steps/store-chunks.ts` | `store-chunks`: ensure index or **fail-fast `VectorDimensionMismatchError`** (check precedes any upsert), then idempotent upsert; publishes `knowledge.indexed` |
| `config.ts` | Domain constants: `KNOWLEDGE_INDEX_NAME`, `EMBED_BATCH` (256), `CHUNK_MAX_SIZE` (512), `CHUNK_OVERLAP` (50), `KNOWLEDGE_HNSW_INDEX_CONFIG` |
| `handlers/errors.ts` | Domain errors (moved here from `errors.ts`): `KnowledgeError` base + `VectorDimensionMismatchError` (public contract, re-exported by the workflow module and the barrel) + `EmbedderUnavailableError` / `EmbedFailureError` / `VectorStoreUnavailableError` / `KnowledgeSourceError` / `UnexpectedKnowledgeError` + `toKnowledgeError` |
| `handlers/responses.ts` | `KnowledgeResult<T> = AppResult<T, KnowledgeError>` + `knowledgeOk` / `knowledgeFail` |
| `tools/knowledge-query.ts` | `createKnowledgeQueryTool()` wrapper over `createVectorQueryTool` (`vectorStoreName: 'mastra-vectors'`, `indexName: 'knowledge_docs'`); **null when no embedder resolves** — never throws; rerank OFF by default (zero-key promise) |
| `entities/document.ts` | `KnowledgeDoc` / `KnowledgeChunk` zod entities + `knowledgeContentTypeSchema` |
| `events.ts` | `knowledge.indexed` / `knowledge.index-failed` contracts (typed bus) |
| `index.ts` | Barrel — the only import surface for other code |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `workflows/` | `index-knowledge.ts` composition, `schemas.ts` (shared shapes), `steps/{read-document,chunk-document,embed-chunks,store-chunks}.ts` (one ETL step per module) |
| `handlers/` | `errors.ts` (the domain error classes, formerly `errors.ts` at the domain root) + `responses.ts` (the `AppResult` alias) + the barrel |
| `tools/` | `knowledge-query.ts` — the `search_knowledge` vector-query wrapper |
| `entities/` | `document.ts` — the `KnowledgeDoc`/`KnowledgeChunk` entities |

## For AI Agents

### Working In This Directory
- No `DomainScope`/guard trio here: there is no `new Agent` in this slice, so root-AGENTS.md gotcha #7 is trivially satisfied. Do not add an agent without wiring the scope trio.
- The chunk text lives in **metadata.text**, not `document` — PgVector/LibSQLVector do not populate `document` on `query()`. Consumers must read `metadata.text`.
- `KNOWLEDGE_INDEX_NAME` + the `'search_knowledge'` registry key (registered by `src/mastra/index.ts` when `knowledgeQueryTool` is non-null) are the contracts; the DoD tests assert registration. Registration is NOT wiring: the tool reaches an agent only through that agent's `connectors.rag`.
- Embedder changes are re-index events (gotcha #G3, sticky dimensions): an existing 1024d `knowledge_docs` rejects 1536d writes via `VectorDimensionMismatchError` before any upsert.
- Tests inject a deterministic stub embedder / vector via `createIndexKnowledgeWorkflow(deps)` and `createKnowledgeQueryTool(deps)` — zero network, zero keys.

### Connectors & Domain Table
- RAG is opt-in: an agent receives `search_knowledge` ONLY when it declares `connectors: { rag: true }` in its `config.ts` — without that key it does not get the tool even though it stays registered in the root Mastra `tools` registry (`src/mastra/index.ts`). This slice has no `config.ts` agent knobs; the contract it owns is the registry key (`RAG_TOOL_KEY` in `shared/agents/connectors.ts`).
- `resolveConnectorTools()` (in `shared/agents/connectors.ts`) reads the registry with `listTools()` (non-throwing) and contributes `search_knowledge` only for `rag: true`; a missing registry/key is a silent no-op.
- The agent domain table (agent names, long scope lines, sibling descriptions) lives once in `shared/agents/domain-catalog.ts` — this slice has no agent and therefore no `scope.ts`.

### Testing Requirements
- Unit: `tests/unit/domains/knowledge/indexing.test.ts` (step logic with stub embedder).
- Integration: `tests/integration/knowledge-rag.test.ts` (Scenario 5 E2E vs `tests/fixtures/knowledge/onboarding.md` + Scenario 6 mismatch).
- Structural ratchet: `tests/unit/structure/file-size.test.ts` caps every file under `domains/` at **150 LOC** — the `index-knowledge` split (composition vs `steps/` vs `schemas.ts`) is what keeps this domain inside it.

## Dependencies

### Internal
- `shared/logger.ts`, `shared/events/event-bus.ts`, `shared/config/model.ts` (resolveEmbedder), `shared/config/vectors.ts` (VECTOR_STORE_NAME, latch)

### External
- `@mastra/core/workflows`, `@mastra/rag` (MDocument, createVectorQueryTool), `@mastra/core/vector`, `@mastra/pg`, `zod`

<!-- MANUAL: -->
