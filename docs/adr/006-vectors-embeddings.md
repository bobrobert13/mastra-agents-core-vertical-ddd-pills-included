# ADR-006: Vectors, Embedders & the Degrade Contract (spec 03)

## Status

Accepted (extends ADR-002; supersedes its Implementation-section hand-made `embeddings` table)

## Context

ADR-002 chose PostgreSQL + pgvector and the repo has shipped `pgvector/pgvector:pg16` with `CREATE EXTENSION vector` since day one — yet until now **no code ever constructed a vector store** ("shipped but unused" = defect class, gap analysis §1.3/§2.3). Memory carried recent-message history only; there was no multi-session recall and no chat-with-docs path.

Constraints from the boilerplate's core promise:

1. **Zero configuration must keep working** — clone without env vars and `npm run dev` must boot and remember as much as it can.
2. **Never crash on missing capabilities** — every optional service degrades with a banner line, not an exception (root `AGENTS.md` rule).
3. **No new paid dependencies by default** — embedding must be possible with zero API keys.

Key technical facts that shaped the decision (all verified against the installed 1.66.0/1.29.0 dists):

- An index is **bound to one embedder's dimension forever**: E5's 1024-d vectors cannot coexist with 1536-d vectors (gotcha G3).
- Memory's derived recall index is keyed by **probed dimension, not model id** (`memory_messages[_<dim>]`) — cross-dimension switches silently cold-reset recall; same-dimension switches silently SHARE (and mix) one index.
- Embedder construction for `@mastra/fastembed` is LAZY: the model tarball downloads on first `doEmbed`, so an offline cold cache is a **runtime** failure, not a boot-time one (gotcha G4).
- `mastra.getVector()/getTool()` THROW on missing registry keys while the ctor silently skips null entries → all degrade-path reads use the non-throwing `listVectors()/listTools()`.

## Options Considered

### Option 1: Require a hosted embedder (e.g. OpenAI) + Postgres only
Simple, but breaks zero-config and the no-keys default; offline boots would die or silently no-op. **Rejected.**

### Option 2: Local-first embedder with hosted override + dual vector stores
Default `@mastra/fastembed` multilingual-E5 (1024d, no keys, Spanish-friendly); `EMBEDDING_MODEL=provider/model` opts into `ModelRouterEmbeddingModel`; vector store mirrors `buildStorage()`: `DATABASE_URL` postgres → `PgVector` (HNSW dotproduct indexConfig for scale), otherwise `LibSQLVector` on the same file DB (cosine). A module-level one-way availability flag absorbs runtime failures. **Chosen.**

### Option 3: Separate dedicated vector service (Qdrant/Pinecone)
Best-in-class search, but adds infra requirements to a zero-config boilerplate. **Rejected** (may be revisited post-1.0).

## Decision

Implement `shared/config/vectors.ts` (`buildVectors`, `pushRecallBanner`, `semanticRecallAvailable`, `markEmbedderUnavailable`, `buildDomainMemory`, `RECALL_OPTIONS` `topK:4 / messageRange:2 / scope:'resource'` + HNSW dotproduct indexConfig) exactly mirroring the `storage.ts` env-optional pattern, and `resolveEmbedder()` in `shared/config/model.ts` (never hard-code model strings, gotcha #5). All four domain agents get memory through the `buildDomainMemory()` DynamicArgument factory — identity-vs-availability: an injected test embedder replaces the embedder **identity**, never the availability flag.

The knowledge vertical slice (`domains/knowledge/`) ships a **workflow + tool, no agent**: indexing is deterministic ETL (`index-knowledge`: read → chunk → embed → store), query-time conversation stays in the research agent, which resolves `search_knowledge` dynamically from the Mastra top-level `tools` registry via the **non-throwing** `listTools()`.

**Degrade contract (binding):** with no usable embedder for ANY reason (kill-switch `SEMANTIC_RECALL=off`, missing key, offline cold cache, router rejection) the app boots, the banner prints the canonical line `Semantic recall: off (no embedder)` (rendered by `service-status.ts` `padEnd(16)` — spacing derived, never hand-typed), runtime failures warn ONCE (latched, no retry storm), `generate()` behaves exactly as pre-feature, and `search_knowledge` simply does not exist. Never a crash.

**Amendment (2026-09-17, after a real 500 incident):** "runtime-latched" was not enough. Mastra resolves the embedder's dimension INSIDE the turn (`Memory.getInputProcessors` → `getEmbeddingDimension` → `embedder.doEmbed`), so the first turn after a poisoned fastembed cache (partial download: directory present, `model.onnx` absent — the package never re-extracts) died with `Failed to determine the embedder's output dimension` even though the latch had already warned. Three additions keep the contract true:
1. `buildVectors()` consults the fastembed cache artifacts (`config/fastembed-cache.ts`) and latches at BOOT — the banner no longer promises recall the process cannot deliver.
2. `buildDomainMemory()` runs a one-shot readiness probe BEFORE constructing `Memory`; a failure is absorbed (one canonical warn) and that very turn continues on plain history.
3. `semanticRecall` turns on only with BOTH a resolved vector store and a usable embedder: Mastra HARD-THROWS on recall without a store ("Semantic recall requires a vector store to be configured"), and the registry key can legitimately be absent — a standalone agent (tests, scripts, the stdio MCP surface) has no Mastra instance. No store ⇒ plain history, never a throw.
Repair path for the cache itself: `npm run warm:embeddings` (deletes the partial dir/archive and re-downloads; `warmup()` from `@mastra/fastembed` does NOT cover multilingual-E5).

## Consequences

- **Positive:** zero-config recall works out of the box (LibSQL + E5); Postgres path uses HNSW dotproduct for large scale; the whole feature matrix is provable offline through the DI seams; Studio sees the store via the `mastra-vectors` registry name.
- **Negative:** first embed downloads a ~1.31 GB ONNX tarball (G4 — pre-warm with `npm run warm:embeddings`, NOT the package's `warmup()`, which only covers bge-small/base); an interrupted download leaves a **poisoned cache** (directory present, `model.onnx` absent) that the package never repairs — hence the boot latch + build-time probe above; per-message embedding adds latency (mitigated: conservative topK 4 + `SEMANTIC_RECALL=off` escape hatch); switching `EMBEDDING_MODEL` across dimensions silently cold-resets Memory recall, and same-dimension switches silently mix vectors (G3 — treat embedder changes as re-index events; the knowledge workflow fail-fasts instead).
- **Migration note (operators):** on existing Postgres databases, changing recall `indexConfig` makes Memory drop + rebuild the vector index once; HNSW construction needs ~250 MB+ shared memory at scale — run `pgVector.buildIndex()` off-peak.
- **Supersedes:** ADR-002's Implementation-section `embeddings` table (and its IVFFLAT index, trigger function and triggers) — deleted from `docker/init.sql` (spec 03 §3.8); `PgVector.createIndex` owns `mastra_<indexname>` tables. ADR-002's decision itself stands (Postgres + pgvector remains the production store).
- **Out of scope:** rerank default (needs an LLM per search → open question, opt-in env later), GraphRAG, hybrid/sparse search, history backfill (recall covers new messages only).
