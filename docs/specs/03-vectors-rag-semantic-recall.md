# Spec+: Vectors, RAG & Semantic Recall (Phase 3)

> **Phase:** 3 | **ID:** 03 | **Status:** DRAFT
> **Depends-on:** none (PgVector reuses the existing `DATABASE_URL` decision — no prior spec blocks this)
> **Blocks:** spec 07 — *recommended, not blocking* (mirrors spec 07's own header): its `contextPrecision` /
> `contextRecall` / `faithfulness` scorers can only be *actually measured* once a semantic-recall memory and a
> knowledge index exist, so spec 07 should not be implemented before this one lands
> **Verified gap:** `docker/docker-compose.yml:5` ships `pgvector/pgvector:pg16`, `docker/init.sql:2` enables the
> extension — yet no code under `src/` ever constructs a vector store or index; the four `new Memory(...)` calls
> (`domains/research/agent.ts:57`, `domains/task-management/agent.ts:57`, `domains/file-operations/agent.ts:57`,
> `domains/communication/agent.ts:53`) carry recent-message history only, and the `Mastra` constructor
> (`src/mastra/index.ts:15-31`) has no `vectors` field. See `docs/PRODUCTION-GAP-ANALYSIS.md` §2.3 (and §1.3:
> "shipped but unused" is treated as a defect class in this repo).

## Settled Inputs (given, not re-decided here)

**D3 — embedder resolution:** `EMBEDDING_MODEL` set → `ModelRouterEmbeddingModel('provider/model')`; unset →
`@mastra/fastembed` local multilingual E5 (no API keys, Spanish-friendly); neither usable → recall/RAG degrade to
**OFF** with the exact banner line `Semantic recall: off (no embedder)` (§3.9 defines the canonical-string +
rendering rule; D3 wording is the canonical string) — never a crash. Vector store resolution
mirrors `shared/config/storage.ts`: `DATABASE_URL` starting with `postgres` → `PgVector` (HNSW dotproduct index
config for large scale); otherwise → `LibSQLVector` on the same LibSQL file (zero-config). Embedder choice is
**sticky per index** — E5's 1024-dim vectors cannot share an index with another embedder's output (gotcha #G3).

---

## Phase 1: Strategic Vision

* **Vision:** Agents built on this boilerplate stop forgetting what a user said in any earlier session and can
  answer questions grounded in the project's own documents — with zero configuration, and without ever crashing
  when embeddings are impossible.
* **OKR / Goal (PROPOSED — subagent has no dialog; product owner to confirm):**
  1. **Multi-session recall:** `tests/integration/semantic-recall.test.ts` proves — with **0 provider API keys**
     (LibSQLVector + fastembed E5) — that a fact embedded **40+ messages earlier in thread-1** of a `resourceId`
     is returned by `memory.recall()` from a *different* thread of the same resource (`vectorSearchString` = a
     paraphrase of the question). Retrieval is the keyless-observable behavior; the end-to-end "the LLM answers
     it" check is the evals-tier variant, `skipIf(!hasProviderKey())`. Target: green whenever the E5 cache is
     warm; skipped (never failed) offline.
  2. **Chat-with-docs vertical (0 provider keys, tool-level proof):** after `npm install && npm run dev`, the
     `index-knowledge` workflow completes and `search_knowledge` — built by the `knowledge` slice, attached to
     the **research agent** (§3.6 ships no agent) — returns the pinned fixture sentence in its top-3 retrieval
     results, with zero keys. The **8/10 answer-quality bar** is the evals-tier check, `skipIf(!hasProviderKey())`
     — `generate()` needs an LLM key (gotcha G5).
  3. **Zero-config promise preserved:** `npm run test:smoke` and `timeout 15 npm run dev` stay green with no env
     vars and no network — recall either works or degrades to the off-banner, never a boot or generate crash.

**Out of scope (deliberate):** rerank enablement by default (needs an LLM → Phase 4 open question), GraphRAG,
hybrid/sparse search, backfilling vectors for pre-existing message history, multi-tenant vector-store resolvers.

---

## Phase 2: Functional Spec (BDD)

* **User Story:** As a **product engineer** cloning this boilerplate to build a **chat-with-docs feature**, I want
  semantic recall over my agents' memories and a working RAG slice (index documents → query them from the research
  agent) that activates itself from env vars, so that I ship "remembers what users said before" and "answers from
  our docs" in hours — and if I have no API keys or no network, the app still runs instead of exploding.

### Acceptance Criteria

* **Scenario 1: Zero-config boot enables LibSQLVector + fastembed, recall ON**
  * **Given** no env vars set at all (no `DATABASE_URL`, no `EMBEDDING_MODEL`, no provider keys) and a warm
    fastembed model cache (`~/.cache/mastra/fastembed-models`)
  * **When** `npm run dev` boots
  * **Then** the service banner contains the active lines `✅ Vector store     LibSQLVector (file:./mastra.db — cosine)`
    and `✅ Semantic recall  on (fastembed/multilingual-e5-large · 1024d · scope:resource)` — spacing derived,
    never hand-typed (§3.9 layout rule)
  * **And** `mastra.listVectors()` exposes the store under the registry name `mastra-vectors` (Studio shows it)
  * **And** the `index-knowledge` workflow is listed by `GET /api/workflows`.

* **Scenario 2: Postgres path uses PgVector with HNSW dotproduct**
  * **Given** `DATABASE_URL=postgresql://...` (the `docker-compose.yml` dev stack already provides it) and
    `EMBEDDING_MODEL` unset (E5)
  * **When** the app boots, the research agent's Memory persists its first messages, AND the `index-knowledge`
    workflow runs once against the fixture doc
  * **Then** the banner reports Vector store `PgVector (DATABASE_URL)`
  * **And** Memory's auto-created recall index honors `indexConfig: { type: 'hnsw', metric: 'dotproduct',
    hnsw: { m: 16, efConstruction: 64 } }` (verified shape: `@mastra/core` `memory/types.d.ts:168-239` — LibSQL
    ignores this and keeps cosine)
  * **And** `await vectorStore.describeIndex({ indexName: 'knowledge_docs' })` — the run above created it —
    reports `dimension: 1024`.

* **Scenario 3: Cross-thread semantic recall (happy path, keyless)**
  * **Given** a Memory built by `buildDomainMemory()` with recall ON (LibSQLVector + fastembed E5, **zero
    provider keys**), for resource `user-a`, whose **thread-1** received via `memory.saveMessages()` the fact
    "the staging DB password rotation is Fridays" followed by 45 filler messages
  * **When** `memory.recall({ threadId: 'thread-2', resourceId: 'user-a', threadConfig: { semanticRecall:
    RECALL_OPTIONS }, vectorSearchString: 'when do we rotate the staging password?' })` runs on a **different**
    thread of the same resource
  * **Then** the returned messages include thread-1's fact message (proving `scope: 'resource'`).
    *(The end-to-end "the LLM actually answers it" form lives in the evals tier, `skipIf(!hasProviderKey())` —
    `generate()` needs a model and zero-key generate 401s per the existing provider banner rule.)*

* **Scenario 4a: Hosted embedder without its key → boot-time off-banner, generate unaffected**
  * **Given** `EMBEDDING_MODEL=openai/text-embedding-3-small` but `OPENAI_API_KEY` unset (a boot-knowable
    "no embedder" state) — while a **separate** LLM provider key and its `MODEL` are configured by env so
    `generate()` itself can run; only the embedding side is broken
  * **When** `npm run dev` boots and a user generates with the research agent
  * **Then** the banner's inactive line renders `○ Semantic recall  off (no embedder)` — the canonical assertion
    string is `Semantic recall: off (no embedder)` (§3.9 layout rule; D3 wording)
  * **And** the `generate()` call succeeds with plain recent-message memory (no vector work attempted) and
    `mastra.listTools()` has no `search_knowledge` entry.

* **Scenario 4b: Explicit kill-switch → identical off-state even when everything else is valid**
  * **Given** `SEMANTIC_RECALL=off` with `DATABASE_URL` + provider keys all present
  * **When** the app boots and serves generates
  * **Then** the same `○ Semantic recall  off (no embedder)` line is printed (the reason goes to a
    `logger.warn`, never the banner)
  * **And** zero embedding calls occur: the assertion runs on a Memory built through the
    `buildDomainMemory(options, deps)` seam (§3.3) with a counting stub embedder, and additionally on the
    production path via the observable `semanticRecallAvailable() === false`; the generate path is what's
    instrumented here (the §3.6 workflow seam only covers indexing).

* **Scenario 4c: Late runtime failure (offline cold cache) → lazy, latched, one-way degrade**
  * **Given** `EMBEDDING_MODEL` unset and an LLM provider key + `MODEL` configured (so requests genuinely run —
    G5), with the embedder failing at first use: **CI** injects a throwing stub via the `buildDomainMemory`
    deps seam (§3.3); the **live** variant (`storage.googleapis.com` unreachable + cold
    `~/.cache/mastra/fastembed-models`) is `skipIf`-guarded
  * **When** the first `generate()` runs, then a second one
  * **Then** both requests complete (history intact, recall silently skipped, no crash)
  * **And** exactly ONE `logger.warn` line carrying the canonical string is emitted, and the second request
    performs **zero** further embed attempts (module flag latched; no per-request retry storm).

* **Scenario 5: Indexing workflow end-to-end, then vectorQueryTool returns chunks**
  * **Given** a fresh zero-config instance and the fixture `tests/fixtures/knowledge/onboarding.md` (a DoD
    deliverable) containing, in its IT-equipment paragraph, the sentence "New hires receive a €2,000 laptop budget."
  * **When** the `index-knowledge` workflow runs with `{ source: 'path', path: 'tests/fixtures/knowledge/onboarding.md', contentType: 'markdown' }`
  * **Then** the run finishes `success` reporting `chunkCount ≥ 3` and `dimension = 1024` (E5), and
  * **And** executing `search_knowledge` with `queryText: 'What laptop budget do new hires get?'` returns, within
    its top 3 results, a source whose `metadata.text` contains "€2,000 laptop budget" (chunk text lives in
    **metadata**, not `document` — PgVector/LibSQLVector don't populate `document` on `query()`).

* **Scenario 6: Sticky-dimension hazard — switching embedder against an existing index**
  * **Given** the knowledge index `knowledge_docs` already created at 1024d (E5), and an embedder that now
    resolves to a **1536-dim** model — in CI via the workflow factory's injectable stub embedder (§3.6); the live
    variant (`EMBEDDING_MODEL=openai/text-embedding-3-small` + real `OPENAI_API_KEY`) is `skipIf`-guarded offline
  * **When** the `index-knowledge` workflow runs again against any document
  * **Then** the `store-chunks` step fails fast with a `VectorDimensionMismatchError` naming stored dim (1024),
    requested dim (1536), the index name, and the remediation (delete index + re-index, or revert `EMBEDDING_MODEL`)
  * **And** no vectors are written (the mismatch check precedes `upsert`)
  * **And** for Memory's recall index the behavior is a *silent* variant of the hazard: with `indexName` unset,
    Memory derives it at runtime from the **probed embedding output dimension** — `memory_messages` for 1536-dim,
    `memory_messages_<dim>` otherwise (runtime: `agent-CEHR0Wd8.js:17005-17011` + `:17202-17203`; the
    `memory/types.d.ts:326-335` comment says "based on embedder model" — the runtime keys on DIMENSION, and a
    user-set `indexName` always wins). A 1024↔1536 switch therefore starts a fresh empty derived index (older
    memories stop being recalled), while a switch between same-dimension models would silently SHARE the index —
    documented gotcha #G3, not a bug to fix here.

---

## Phase 3: Technical Contract & DoD

### 3.1 New dependencies (`npm install --legacy-peer-deps` — gotcha #1)

| Package | Version (verified on registry 2026-09) | Why |
|---|---|---|
| `@mastra/rag` | `^2.6.2` | `MDocument` + chunking + `createVectorQueryTool` (peer: `@mastra/core >=1 <2`, `zod ^3.25 ‖ ^4` — installed zod is 3.25.76 ✅) |
| `@mastra/fastembed` | `^1.3.1` | local embedders: the default export `fastembed` is **bge-small-en-v1.5** (English, 384d — NOT what we want); the E5 pair are **properties on that default export**: `fastembed.multilingualE5LargePassage` / `fastembed.multilingualE5LargeQuery` (1024d, `MLE5Large`) — **no standalone E5 named export exists**. Named exports of the package are `fastembed`, `warmup` (CI pre-download), `FlagEmbedding`, `EmbeddingModel`, `SparseTextEmbedding`, `SparseEmbeddingModel`, `ExecutionProvider` (tarball `index.js:26890`); cache path `~/.cache/mastra/fastembed-models` |

No new provider packages: `ModelRouterEmbeddingModel` ships in `@mastra/core/llm` (verified:
`node_modules/@mastra/core/dist/llm/index.d.ts:119`). Installed baseline stays `@mastra/core 1.66.0`,
`@mastra/memory 1.29.0`, `@mastra/pg 1.24.0`, `@mastra/libsql 1.22.5`. (Optional hygiene, not required:
bump the `package.json` zod floor `^3.23.8` → `^3.25.76` — the lock already resolves 3.25.76, which
satisfies `@mastra/rag`'s peer.)

### 3.2 `shared/config/model.ts` — embedder resolution (extends existing module)

```ts
// ADDITIONS to src/mastra/shared/config/model.ts  (signatures PROPOSED)
import type { MastraEmbeddingModel } from '@mastra/core/vector'; // verified: vector/vector.d.ts:13 —
// exactly the type Memory's `embedder?: EmbeddingModelId | MastraEmbeddingModel<string> | string` accepts
// (memory/types.d.ts:1059)

export type EmbedderSource = 'model-router' | 'fastembed' | 'none';

export interface EmbedderResolution {
  source: EmbedderSource;
  /** undefined iff source === 'none' — callers must degrade, never throw */
  passage?: MastraEmbeddingModel<string>;  // index/store side (also used by Memory)
  query?: MastraEmbeddingModel<string>;    // search side; for E5 = multilingualE5LargeQuery,
                                           // for router models === passage (single model)
  dimension?: number;                      // EMBEDDING_MODEL → EMBEDDING_MODELS metadata; fastembed → 1024
  detail: string;                          // banner text, e.g. 'fastembed/multilingual-e5-large · 1024d'
}

/** EMBEDDING_MODEL env, 'provider/model' format — NEVER hard-coded (gotcha #5). */
export const embeddingModel = (): string | undefined;   // env('EMBEDDING_MODEL')

export function resolveEmbedder(): EmbedderResolution;
// precedence:
//   SEMANTIC_RECALL=off                      -> { source:'none', detail:'off (no embedder)' }
//       (banner text is the canonical line in every off case; the reason goes to logger.warn)
//   EMBEDDING_MODEL set + 'provider/model' shape -> 'model-router' via
//       new ModelRouterEmbeddingModel(id); dimension via the exported curated list
//       EMBEDDING_MODELS.find(m => m.id === id)?.dimensions (type EmbeddingModelInfo { dimensions,
//       maxInputTokens, ... } — all barrel-exported from '@mastra/core/llm', verified llm/index.d.ts:119;
//       NOTE: the deep-path helpers isKnownEmbeddingModel/getEmbeddingModelInfo in
//       llm/model/embedding-router.d.ts are NOT re-exported by the barrel — do not import them).
//       If the id is known AND its provider key is absent (key map in providers.ts) -> 'none' with
//       detail 'off (no embedder)'  [boot-knowable]
//   EMBEDDING_MODEL unset                    -> 'fastembed' via fastembed.multilingualE5LargePassage/Query,
//       dimension 1024. Construction is LAZY (FlagEmbedding.init on first doEmbed); offline failure is a
//       RUNTIME degrade, see vectors.ts markEmbedderUnavailable().
```

**Never hard-code model strings:** `.env.example` documents `EMBEDDING_MODEL=` commented, with
`openai/text-embedding-3-small` as a *comment example* only.

### 3.3 `shared/config/vectors.ts` — new builder (mirrors `storage.ts` exactly)

```ts
// src/mastra/shared/config/vectors.ts  (NEW — PROPOSED)
import type { PgVector } from '@mastra/pg';
import type { LibSQLVector } from '@mastra/libsql';

export const VECTOR_STORE_NAME = 'mastra-vectors';      // key in Mastra `vectors` registry
export type Vector = PgVector | LibSQLVector;
export type VectorKind = 'pgvector' | 'libsql';

export interface VectorResolution {
  store: Vector | null;        // null only when recall/RAG fully off
  kind: VectorKind;
}

/** DATABASE_URL (postgres prefix) → new PgVector({id:VECTOR_STORE_NAME, connectionString});
 *  else → new LibSQLVector({ id: VECTOR_STORE_NAME, url: <same url buildStorage picked:
 *        LIBSQL_URL ?? 'file:./mastra.db'> }). Pushes the 'Vector store' ServiceStatus in BOTH branches. */
export function buildVectors(services: ServiceRegistry): VectorResolution;

/** 'Semantic recall' + 'Knowledge RAG' ServiceStatus lines in BOTH branches (shared/AGENTS.md rule). */
export function pushRecallBanner(services: ServiceRegistry, r: EmbedderResolution): void;

/** Lazy health flag — flipped false by the first embedder runtime failure (once) or at boot when
 *  resolveEmbedder() === 'none'. Consulted by buildDomainMemory() and the query-tool factory. */
export function semanticRecallAvailable(): boolean;
export function markEmbedderUnavailable(reason: string): void; // logger.warn canonical 'Semantic recall: off (no embedder)'

export interface DomainMemoryOptions { generateTitle?: boolean; observationalMemory?: object; }
export interface DomainMemoryDeps {            // test seam (Scenarios 4b/4c) — same DI spirit as §3.6
  embedder?: MastraEmbeddingModel<string>;     // wins over config resolution; count/wrap it to assert calls
  vector?: Vector;
}
/** Returns a DynamicArgument-compatible factory (AgentConfig.memory accepts one — verified:
 *  @mastra/core agent/types.d.ts:666) so Memory is built AFTER the Mastra instance exists:
 *  available = semanticRecallAvailable();   // deps.embedder replaces IDENTITY, never AVAILABILITY (Scenario 4b)
 *  vector = available ? (deps.vector ?? mastra?.listVectors?.()?.[VECTOR_STORE_NAME]) : undefined,
 *  embedder = deps.embedder ?? resolveEmbedder().passage,
 *  options = { lastMessages: 10, semanticRecall: available ? RECALL_OPTIONS : false }.
 *  NB: gated non-throwing read — getVector() THROWS MastraError on a missing key (runtime
 *  mastra-B-GDpHtP.js:2040-2048) and the Mastra ctor silently SKIPS null vector entries (:1075-1077),
 *  so the registry key can legitimately be absent (fully-off state). */
export function buildDomainMemory(
  options: DomainMemoryOptions,
  deps?: DomainMemoryDeps
): (ctx: { requestContext: RequestContext; mastra?: Mastra }) => Promise<Memory>;

export const RECALL_OPTIONS /*: SemanticRecall */ = {
  topK: 4,
  messageRange: 2,
  scope: 'resource',            // supported by LibSQL & Pg adapters (docs/semantic-recall)
  indexConfig: { type: 'hnsw', metric: 'dotproduct', hnsw: { m: 16, efConstruction: 64 } },
  // indexName intentionally UNSET → runtime derives it from the probed embedding DIMENSION
  // (memory_messages[_<dim>], agent-CEHR0Wd8.js:17005-17011) — same-dim embedder swaps then SHARE the index; see gotcha #G3
};
```

**Dimension discovery for non-curated ids:** `EMBEDDING_MODELS` covers only curated ids (openai ×3,
google ×1). A valid-shape but non-curated `EMBEDDING_MODEL` (e.g. a self-hosted openai-compatible endpoint the
router accepts) resolves `'model-router'` with `dimension: undefined` — no config error: `store-chunks` pins the
index dimension from step 3's **actual output** (`vectors[0].length`, cached on the resolution; the optional
single-value `doEmbed` probe in `embed-chunks` exists only to fail fast before chunking a large document).
Embed/probe failure is the standard runtime degrade. Memory recall never needs a configured dimension: it
derives the length from runtime embeddings and keys its derived index name on that same length (see #G3).

`shared/config/infrastructure.ts` gains one composition call (stays < 40 lines):
`const vectors = buildVectors(services)` returned on the `Infrastructure` object as `vectors`.

### 3.4 Composition root — `src/mastra/index.ts`

```ts
export const mastra = new Mastra({
  agents: { /* unchanged 4 */ },
  workflows: { 'deep-research': deepResearchWorkflow, 'index-knowledge': indexKnowledgeWorkflow },
  vectors: { [VECTOR_STORE_NAME]: vectorStore },          // NEW — Studio + getVector()/listVectors() resolve it
                                                          // (mastra/index.d.ts:1034/:1077; ctor skips null entries :1075-1077)
  tools: { ...(knowledgeQueryTool && { search_knowledge: knowledgeQueryTool }) }, // read via listTools() :1564 — getTool :1528 throws on miss, §3.6
  storage, ...(observability && { observability }), server: { ... },
});
```

### 3.5 Memory options diff for the 4 domain agents

Each `domains/*/agent.ts`: replace `new Memory({ options: {...} })` with the shared factory (one import from
`shared/config/vectors.ts`, no sibling imports):

```diff
- memory: new Memory({
-   options: { generateTitle: true, observationalMemory: { model: memoryModel() } },
- }),
+ memory: buildDomainMemory({
+   generateTitle: true,
+   observationalMemory: { model: memoryModel() },
+ }),
```

(file-operations and communication currently pass only `generateTitle: true` — they keep exactly those options;
all four uniformly receive `semanticRecall: RECALL_OPTIONS` when available, `false` when not. `lastMessages`
stays at the Memory default 10.)

### 3.6 The `knowledge` vertical slice (new) — shape & the workflow-not-agent decision

```
src/mastra/domains/knowledge/
├── AGENTS.md                      # slice doc (root AGENTS.md "Adding a New Domain" step 4)
├── entities/document.ts           # KnowledgeDoc entity: { docId, source, contentType, chunks: Chunk[] } (plain data + zod)
├── tools/knowledge-query.ts       # knowledgeQueryTool = createVectorQueryTool({...}) | null
├── workflows/index-knowledge.ts   # read → chunk → embed → store (4 steps)
├── events.ts                      # knowledge.indexed / knowledge.index-failed contracts (typed bus)
└── index.ts                       # barrel: exports knowledgeQueryTool, indexKnowledgeWorkflow,
                                   #          KNOWLEDGE_INDEX_NAME, events
```

**Decision (required by task): indexing is a WORKFLOW, and `knowledge` ships NO agent.** Justification: chunk →
embed → upsert is deterministic ETL with fixed ordering and per-step retry needs — exactly what
`createWorkflow`/`createStep` are for (repo pattern: `research/workflows/deep-research.ts`); an agent would add
unneeded LLM nondeterminism and cost per indexed document, and would then force the scope-guard trio
(`DomainScope` + `scopedInstructions` + `createScopeGuard`) on a slice that makes no conversational promises.
Consequence: the root AGENTS.md hard rule "every `new Agent` must be scope-enforced" is **trivially satisfied**
(no agent, nothing to guard). Query-time conversation stays in the research agent, which already owns a scope.
The slice keeps `tools/` + `entities/` to match the documented domain shape.

**Indexing workflow contracts** (zod, repo style):

```ts
// workflow input
z.object({
  source: z.enum(['path', 'inline']),
  path: z.string().optional(),            // required when source==='path' (zod refine)
  content: z.string().optional(),         // required when source==='inline'
  contentType: z.enum(['text', 'markdown', 'html']).default('text'),
  docId: z.string().min(1).optional(),    // stable id for re-indexing; default: sha256(content).slice(0,16)
})
// workflow output
z.object({ docId: z.string(), indexName: z.string(), dimension: z.number().int(),
           chunkCount: z.number().int(), skippedChunks: z.number().int() })
```

**Test seam (needed by Scenarios 5/6 offline paths):** the workflow and its steps are produced by
`createIndexKnowledgeWorkflow(deps: { embedder?: MastraEmbeddingModel<string>; vector?: Vector } = {})`; the
exported `indexKnowledgeWorkflow` = `createIndexKnowledgeWorkflow()` with config-resolved defaults. Tests inject
a deterministic stub embedder (e.g. fixed 1536-dim or 1024-dim vectors + call counter) so chunk→embed→store is
exercisable with zero network — same DI spirit as `runTool` in `deep-research.ts`.

Steps (each `createStep` with its own input/output schema):
1. **`read-document`** — `source==='path'`: fs-read with a path-containment check against the process cwd
   (workspace) and `workspace/` dir; content-type sniff from extension. Output `{ docId, text, contentType }`.
2. **`chunk-document`** — `MDocument.fromMarkdown(text) | fromHTML | fromText` then
   `await doc.chunk({ strategy: 'recursive', maxSize: 512, overlap: 50 })` (real API:
   docs/reference/rag/chunking-and-embedding). Output `{ chunks: [{ chunkId: `${docId}:${i}`, text, index }] }`.
3. **`embed-chunks`** — batched embedding with the resolved **passage** model (or the injected stub).
   Implementation note: call `model.doEmbed({ values })` directly (works across AI-SDK spec versions V2/V3 that
   the two embedder families expose) instead of adding the `ai` package for `embedMany` — avoids a new peer-dep
   surface; batches ≤ 256 (`maxEmbeddingsPerCall`). Any batch throw → `markEmbedderUnavailable(err)` + step
   failure (workflow error, not a crash). Output `{ vectors: number[][], dimension }`.
4. **`store-chunks`** — ensure index: `listIndexes()`; if missing → `createIndex({ indexName:
   KNOWLEDGE_INDEX_NAME /* 'knowledge_docs' */, dimension, metric: 'cosine', ...(kind==='pgvector' &&
   { indexConfig: { type: 'hnsw', hnsw: { m: 16, efConstruction: 64 } } }) })` (real signature verified:
   `@mastra/pg/dist/vector/index.d.ts:197`; LibSQLVector supports cosine only). If present →
   `describeIndex()` and **fail fast with `VectorDimensionMismatchError`** when stored `dimension !== embedder
   dimension` (Scenario 6). Then `upsert({ indexName, vectors, metadata: chunks.map(c => ({ text: c.text,
   docId, chunkIndex: c.index, source, embedder: embedderDetail })), ids: chunkIds })` — deterministic ids
   make re-indexing idempotent. Publishes `knowledge.indexed` on the event bus.

**How the research agent gets the tool without a sibling import (DECIDE honestly):**
the tool **lives in `knowledge/tools/knowledge-query.ts`** and is **registered on the Mastra top-level `tools`
registry by the composition root** (`src/mastra/index.ts` — already legally imports every domain barrel). The
research agent resolves it dynamically at run time:

```diff
- tools: { web_search: webSearchTool, web_fetch: webFetchTool, summarize: summarizeTool },
+ tools: async ({ mastra }) => {
+   const base = { web_search: webSearchTool, web_fetch: webFetchTool, summarize: summarizeTool };
+   const registered = mastra?.listTools() ?? {};   // NON-THROWING read — see note below
+   return 'search_knowledge' in registered
+     ? { ...base, search_knowledge: registered.search_knowledge }
+     : base;
+ },
```

**Why `listTools()` and never `getTool('search_knowledge')` here:** `getTool` **THROWS** `MastraError`
(`MASTRA_GET_TOOL_BY_NAME_NOT_FOUND`, d.ts `@throws` at `mastra/index.d.ts:1531`; runtime verified
`@mastra/core/dist/mastra-B-GDpHtP.js:2964-2972`) for an unregistered key, and the Agent tool-resolution path
does not catch it (`agent-CEHR0Wd8.js:34224+`). On every degrade path (Scenarios 4a–4c) `knowledgeQueryTool`
is `null` → the key is absent → a `getTool &&` guard would crash research `generate()` and violate the
degrade contract. `listTools(): TTools | undefined` never throws (`mastra/index.d.ts:1564`).

(`AgentConfig.tools` accepts a DynamicArgument function receiving `{ requestContext, mastra }` — verified:
`@mastra/core/dist/agent/types.d.ts:580` + `types/dynamic-argument.d.ts:3-6`; `mastra.addTool(tool, key?)` —
:1585.)

`knowledgeQueryTool` is built with `createVectorQueryTool({ vectorStoreName: VECTOR_STORE_NAME, indexName:
KNOWLEDGE_INDEX_NAME, model: <embedder.query> })` (real API: docs/reference/tools/vector-query-tool) and is
**`null` when no embedder resolves** — the registry entry and therefore the research tool simply don't exist
(Scenarios 4a–4b).

**Trade-off stated:** alternatives considered were (a) `shared/tools/` — rejected: `shared/` must be "used by
≥2 domains" per `shared/AGENTS.md`; this tool serves exactly one consumer, so placing it there would encode a
domain concept into the cross-cutting layer; (b) injecting the tool directly into `researchAgent` from
`index.ts` — rejected: Agent has no public `addTools` in `@mastra/core` 1.66.0 (grep-verified — only Voice
classes expose it) and mutating bundled internals isn't a documented API. The registry route adds one soft
coupling: the string key `'search_knowledge'` is a contract between the knowledge barrel and `index.ts`
(same failure mode as the "unregistered = invisible" workflows gotcha — same mitigation: the DoD test below
asserts it).

### 3.7 `.env.example` additions (all optional; header rule unchanged)

```bash
# === Vectors / Semantic recall / RAG (all optional — see docs/adr/006-vectors-embeddings.md) ===
# Embedder: unset → local fastembed multilingual-E5 (1024d, no API keys, Spanish-friendly).
# Set to 'provider/model' to use a hosted embedder (requires that provider's key):
# EMBEDDING_MODEL=openai/text-embedding-3-small
# Master kill-switch for recall + knowledge tools (degrades to plain history, never crashes):
# SEMANTIC_RECALL=off
# Vector store is NOT configured here — it follows DATABASE_URL / LIBSQL_URL exactly like storage.
```

No `VECTOR_*` dimension knobs: the dimension is a property of the embedder (§3.2 resolution), never user input.

### 3.8 `docker/init.sql` review (keep the slice honest)

- **Keep** `CREATE EXTENSION IF NOT EXISTS vector` (`init.sql:2`) — PgVector needs the extension.
- **Delete `init.sql:7-42` in full** — the demo `embeddings` table (8-16) **and all four of its dependents**: the
  IVFFLAT vector index (18-21), `embeddings_domain_idx` (23-25), `embeddings_metadata_idx` (27-29), the
  `update_updated_at_column()` function (31-38) and the `update_embeddings_updated_at` trigger (40-42). Deleting
  only the table would leave dangling references and break `docker-compose up` — the exact "declared but broken"
  defect class from gap analysis §1.3. Post-change grep must show **zero** `embeddings` matches; `PgVector.createIndex`
  owns its `mastra_<indexname>` tables, so a hand-made `vector(1536)` table contradicts the E5-1024 default.
  Update `docker/AGENTS.md:16` (the `init.sql` key-file row) to match.
- **Leave** `domain_events` alone — event persistence is spec 02's problem, not this one's.
- `docker-compose.yml`: add `EMBEDDING_MODEL=${EMBEDDING_MODEL:-}` and `SEMANTIC_RECALL=${SEMANTIC_RECALL:-}`
  passthroughs next to the existing MODEL vars (`docker-compose.yml:36`).

### 3.9 Service banner lines (both branches)

`service-status.ts:14` renders each entry as `` `${icon} ${name.padEnd(16)} ${detail}` `` — so spacing is a
**derived function of the name, never hand-typed**. The three service names are fixed here: `Vector store`,
`Semantic recall`, `Knowledge RAG`. **Canonical assertion string for tests = `` `${name}: ${detail}` ``** — the
D3 wording `Semantic recall: off (no embedder)` lives in that rule; QA asserts (name, active, detail) tuples, not
padded lines. Lines below are shown as actually rendered (15-char name ⇒ 2 spaces; 12-char ⇒ 5; 13-char ⇒ 4):

| State | ServiceStatus `{ name, active, detail }` | Rendered line |
|---|---|---|
| pg path | `'Vector store', true, 'PgVector (DATABASE_URL) — hnsw/dotproduct'` | `✅ Vector store     PgVector (DATABASE_URL) — hnsw/dotproduct` |
| libsql path | `'Vector store', true, 'LibSQLVector (file:./mastra.db — cosine)'` | `✅ Vector store     LibSQLVector (file:./mastra.db — cosine)` |
| recall on (local) | `'Semantic recall', true, 'on (fastembed/multilingual-e5-large · 1024d · scope:resource)'` | `✅ Semantic recall  on (fastembed/multilingual-e5-large · 1024d · scope:resource)` |
| recall on (hosted) | detail `'on (model-router · openai/text-embedding-3-small · 1536d)'` (live example) | `✅ Semantic recall  on (model-router · …)` |
| recall off (any reason) | `'Semantic recall', false, 'off (no embedder)'` | `○ Semantic recall  off (no embedder)` |
| RAG on | `'Knowledge RAG', true, 'workflow index-knowledge + tool search_knowledge'` | `✅ Knowledge RAG    workflow index-knowledge + tool search_knowledge` |
| RAG off | `'Knowledge RAG', false, 'off (no embedder)'` | `○ Knowledge RAG    off (no embedder)` |

The lazy degrade (Scenario 4c) logs `logger.warn('Semantic recall: off (no embedder) — <cause>')` once — the
colon form, identical to the canonical string.

### 3.10 Documentation deliverables

- **`docs/adr/006-vectors-embeddings.md` (NEW ADR, `Accepted`)** — env-optional vector resolution + local-first
  embedder + the degrade contract. Per `docs/AGENTS.md` append-only rule it **extends** ADR-002 (which claimed
  "vector-ready" while no code used it): add an `Updated:` line to ADR-002's header pointing at ADR-006
  (explicitly sanctioned by the docs rules; the ADR body is not rewritten). ADR-006 also supersedes the
  hand-rolled `embeddings` table from ADR-002's Implementation section (that becomes dead code).
  **Numbering:** the cross-spec ADR map is frozen (canonical in spec 04 §3.9, mirrored in
  `docs/specs/README.md`): 01→ADR-004, 02→ADR-005,
  **03→ADR-006**, 04→007, 05→008, 06→009, 07→010 — this spec owns `006-vectors-embeddings.md`.
- `docs/domains/knowledge.md` — RAG usage guide (index a doc → ask the research agent).
- Domain `AGENTS.md` for knowledge; update `src/mastra/domains/AGENTS.md` (slice list) and root `AGENTS.md`
  service table (rows: Vector store, Semantic recall, Knowledge RAG) — repo convention.
- README: quickstart line "docs → index-knowledge workflow → ask the research agent" + env table.
- **Gotchas appended to root `AGENTS.md`** (labels G3–G5 are **spec-local**; they land as the next free
  gotcha numbers at merge time per the cross-spec numbering map — do not hard-code #9..#13 here):
  - **G3 (sticky dimensions):** an index is bound to one embedder's dimension forever — E5's 1024d vectors cannot
    coexist with 1536d vectors. Memory's derived recall index is keyed by **dimension, not model id**
    (`memory_messages[_<dim>]`, runtime `agent-CEHR0Wd8.js:17005-17011`): switching `EMBEDDING_MODEL` **across**
    dimensions silently cold-resets recall (new derived index; the old one is orphaned — delete it manually),
    while switching **between same-dimension models** (e.g. `text-embedding-3-small` → `ada-002`, both 1536)
    silently SHARES one index and MIXes incompatible vectors — recall quality rots with no error. The knowledge
    workflow fail-fasts instead (Scenario 6). Remediation: pin `semanticRecall.indexName` (same-dim swaps then
    still mix — treat embedder changes as re-index events), or delete + re-embed on every embedder switch.
  - **G4 (fastembed offline):** first embed downloads the ONNX tarball — **measured 2026-09-17: 1.31 GB
    compressed → `model.onnx_data` 2.24 GB** — from `storage.googleapis.com/qdrant-fastembed`
    into `~/.cache/mastra/fastembed-models`; offline + cold cache ⇒ recall degrades to off (banner line), the
    process survives. Pre-warm with **`npm run warm:embeddings`**: the `warmup()` export of
    `@mastra/fastembed` only pre-downloads bge-small/base and does NOT cover the multilingual-E5 this repo
    defaults to. **Poisoned cache (same incident):** `retrieveModel()` returns an existing model directory
    untouched and only deletes the `.tar.gz` after a FULL extraction, so an interrupted download leaves a
    directory without `model.onnx` that fails every embed and is never retried — `npm run warm:embeddings`
    detects and repairs it, `buildVectors()` latches recall off at boot, and the `buildDomainMemory()`
    readiness probe keeps the turn alive (ADR-006 amendment).
  - **G5 (recall needs keys to *answer*):** zero-key recall stores/recalls vectors fine but `generate()` still
    401s without a provider key (existing banner rule) — don't confuse the two degradations.

### 3.11 Test plan (tiers per `tests/AGENTS.md`)

- **unit** (`tests/unit/shared/config/vectors.test.ts`, `.../model-embedder.test.ts`,
  `tests/unit/domains/knowledge/indexing.test.ts`, `tests/unit/domains/research/agent.test.ts` extended):
  pure resolution logic per branch (`EMBEDDING_MODEL` set/unset/invalid; `SEMANTIC_RECALL=off`; DATABASE_URL
  prefix routing) with env save/restore — maps **Scenarios 4a, 4b** (resolution tuples + `ServiceStatus`
  entries asserted as (name, active, detail) triples, canonical string rule §3.9; 4b's zero-embed assertion
  runs here too, counting on a Memory built through the §3.3 `DomainMemoryDeps` seam) and the config half of
  **Scenario 1**; counting/wrapping stub `doEmbed` models via the §3.3/§3.6 seams for chunk→embed→store step
  logic (zero network); `mastra` registry assertions — `listVectors()` includes `mastra-vectors`,
  `listTools().search_knowledge` present iff embedder resolved (**Scenario 1** registry half).
  Real-fastembed tests guarded `describe.skipIf(!providerlessEmbedderWarm())` (cache probe), per the skipIf
  convention.
- **integration**: `semantic-recall.test.ts` (**Scenario 3**, LibSQL `:memory:` + E5 via cache-gated stub-or-real),
  `knowledge-rag.test.ts` (**Scenarios 5 + 6** — the mismatch case with a deliberately-1536d stub embedder after
  a 1024d-created index), `recall-degrade.test.ts` (**Scenario 4c** via the throwing-stub seam; live offline
  variant skipIf-guarded). New tier entry `integration-postgres`: `describe.skipIf(!/^postgres/.test(process.env.DATABASE_URL ?? ''))`
  covering **Scenario 2** (compose/CI adds a pgvector service job to run it).
- **evals**: `knowledge.eval.test.ts` structural (dataset JSON with expected chunks; **OKR-2** 8/10 live
  variant `skipIf(!hasProviderKey())`).
- **smoke**: boots with zero env; **must not touch the network or the model cache** — the factory design
  (3.3/3.5) guarantees Memory/Vector work only happens on first generate, so smoke stays offline-safe by
  construction; registers `index-knowledge` visibility (**Scenario 1** final "And": in-process
  `mastra.listWorkflows()`; the live `GET /api/workflows` + banner eyeball is the guardrail manual check).

### Implementation Guardrails

- [ ] Work on a branch named `feat/vectors-rag-semantic-recall` (repo convention `feat/<slug>`)
- [ ] Commits staged every 400–800 LOC; never exceed 1400 LOC per commit
- [ ] Business and UI tests written where applicable; manual/browser verification (Studio vectors page, banner
      eyeball under `npm run dev`) is left to the user
- [ ] Never hard-code any model string (`embeddingModel()` / fastembed exports only — gotcha #5)
- [ ] No sibling domain imports; knowledge is exported exclusively through its `index.ts` barrel
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test:all`, `npm run build` green before review

### Estimated Impact (estimate)

Bounded against the files read (largest touched file: the four `agent.ts` domain files at 61–70 LOC each,
`index.ts` 33 LOC, `deep-research.ts` 205 LOC as the workflow-size anchor):

**~1,350–1,650 LOC added/modified across ~26 files** — src ≈ 600 (vectors.ts ~120, model.ts +60, knowledge
slice ~260, 4× agent diff ~40, index.ts +15, infra +6); tests ≈ 450–550; docs/env/docker ≈ 300–400
(ADR-006, AGENTS.md updates, README, .env.example, init.sql −20, compose +2). Blast radius per
`codegraph explore`: Memory construction is private to the 4 agent modules (no external callers of `new Memory`
outside the barrel tree), so the factory swap has contained impact — the only composition-wide surface is
`src/mastra/index.ts`, which the smoke + integration tiers already boot-cover.

### Definition of Done (DoD)

- [ ] Acceptance criteria covered by unit/integration tests (Scenarios 1, 2, 3, 4a, 4b, 4c, 5, 6 each mapped in 3.11)
- [ ] Fixture deliverable created: `tests/fixtures/knowledge/onboarding.md` (multi-paragraph, ≥3 chunks at
      maxSize 512, containing the pinned sentence "New hires receive a €2,000 laptop budget.")
- [ ] Input/Output payload validation implemented (workflow + step zod schemas; tool schemas come from `createVectorQueryTool`)
- [ ] `semanticRecall` active on all 4 domain agents when embedder available; `false` (never absent-crash) when not
- [ ] `vectors: { 'mastra-vectors': ... }` registered — Studio + `getVector()` see it (gap-analysis §2.3 item 3)
- [ ] `index-knowledge` registered in the `workflows` map (unregistered = invisible — repo hard rule)
- [ ] PgVector branch uses HNSW dotproduct indexConfig; LibSQL branch works zero-config on same file DB
- [ ] Degrade contract proven: embedder unavailable (LLM provider still configured) → boot succeeds, banner
      line canonical, generate succeeds
- [ ] Unit tests for builders offline-safe (`skipIf` model download); integration recall test on LibSQL green
- [ ] Smoke tier still green with zero env, zero network, cold cache
- [ ] Docs: ADR-006 accepted (+ `Updated:` line on ADR-002), knowledge `AGENTS.md`, `docs/domains/knowledge.md`,
      root `AGENTS.md` service table + three new gotcha entries (spec-local labels G3–G5, landing as the next
      free numbers at merge time), README section
- [ ] Implementation guardrails checklist above completed

---

## Phase 4: Risks & Open Questions

* **Risks (top 3):**
  1. **fastembed first-run download in air-gapped CI** (large ONNX tarball; races on parallel workers).
     **Mitigation:** all download-touching tests sit behind `skipIf` cache probes (CI default = skipped, matching
     the existing `hasProviderKey()` skipIf pattern); CI optionally calls `@mastra/fastembed`'s `warmup()` once
     in a setup step and shares `~/.cache/mastra/fastembed-models` across jobs; worst case is the designed
     degrade (off-banner), not a red suite.
  2. **HNSW index migration on existing Pg databases.** Memory only rebuilds the vector index when its config
     changes ("Changed configuration: Index is dropped and rebuilt" — docs/reference/vectors/pg), and HNSW
     construction needs real shared memory (~250 MB+ at 384d/100k vectors; E5 is 1024d). **Mitigation:** ADR-006
     documents this as a one-time drop+rebuild on upgrade, sized in `docker/AGENTS.md`; the default topK 4 keeps
     index builds small on day-1 installs; operators of large existing DBs are pointed at
     `pgVector.buildIndex()` (explicit rebuild) run off-peak.
  3. **Per-message embedding latency** — every send embeds + queries before the LLM call (docs/semantic-recall
     warns about exactly this). **Mitigation:** `topK: 4` / `messageRange: 2` defaults are conservative;
     `SEMANTIC_RECALL=off` escape hatch is a documented one-liner; Phase 5 NFR budgets the added p95; the
     module-level availability flag prevents repeated failure latency.

* **Open Questions / Decisions:**
  - **Rerank default** for `search_knowledge` (`reranker: { model: ... }` requires an LLM call per search →
    violates the zero-key promise when on). Decision needed: ship rerank OFF by default with an
    `EMBEDDING_RERANK_MODEL` opt-in env? — Owner: product owner with the D3 dialog; target: implementation
    kickoff + 3 days.
  - **OKR targets** (Phase 1) were PROPOSED by this drafting agent without a user dialog — D3/D4 confirmation on
    the recall-accuracy bar (40+ messages / cross-thread) and the p95 latency budget. Owner: product owner;
    target: **2026-10-10** (absolute date for this spec; re-anchor at the D4 dialog if the series schedule shifts).
  - **Memory factory rollout shape:** `buildDomainMemory` relies on `AgentConfig.memory` accepting a
    DynamicArgument (verified in installed types, `agent/types.d.ts:666`); if a live 1.66.0 boot shows the dev
    bundler resolves it differently, fallback = construct Memory eagerly in `vectors.ts` after `buildVectors()`
    with a module-level `setStorage(infrastructure.storage)` per instance (slightly more wiring, same degrade
    semantics). Owner: implementer; decide in the first PR (verify with `timeout 15 npm run dev` + one generate).
  - **Backfill policy for pre-existing threads:** accepted for v1 to NOT embed history written before this
    upgrade (recall covers new messages only). If product wants old threads recallable, that's a follow-up
    `backfill-recall` workflow — Owner: product owner; target: before spec 07 gauges recall metrics.

---

## Phase 5: Non-Functional Requirements

* **Performance (targets PROPOSED, pending D3 OKR confirmation):**
  - Semantic recall adds **p95 < 300 ms** per message round-trip with local fastembed E5 on 4-core CI hardware
    (embed + vector query, excluding LLM time); p95 < 150 ms measured with hosted `text-embedding-3-small`.
  - `index-knowledge` throughput: ≥ 60 chunks/min cold-cache, ≥ 600 chunks/min warm E5 on CI hardware.
  - Knowledge query (`search_knowledge`, topK 10, ≤ 10k vectors): p95 < 120 ms on LibSQLVector.
* **Security:** embedding payloads may leave the process only via `EMBEDDING_MODEL` (never by default — fastembed
  is local); path-sourced indexing is confined to the workspace root (Step 1 containment check); no new secrets —
  PgVector reuses `DATABASE_URL`; banner never echoes keys or connection strings.
* **Reliability / Availability:** with no embedder (any reason) the app boots and `generate()` behaves exactly as
  today (recall OFF, one canonical banner/warn line, no retry storm, no unhandled rejection); embedder runtime
  failure flips state once per process; indexing failures surface as workflow step errors (visible in Studio),
  never as process exits; smoke/integration tiers are green offline by skipIf design.
* **Compatibility:** zero-config default is **additive** — no migration runs against existing `mastra.db` or
  Postgres DBs at boot; existing threads keep working and are simply not recall-eligible (no backfill, per Phase 4);
  `MEMORY_*`/`MODEL_*` env semantics unchanged; with `SEMANTIC_RECALL=off` the pre-feature baseline is reproduced
  measurably: the entire existing `npm run test:all` suite (smoke → unit → integration → evals) stays green with
  that variable set (added as a CI matrix variant).
* **Accessibility / Compatibility:** N/A — no UI surface is introduced (Studio views come free with the `vectors`
  registration and need no new frontend work).

---

### Appendix: verification trail

Gap + conventions read from: `docs/PRODUCTION-GAP-ANALYSIS.md` §1.3/§2.3, `shared/config/storage.ts` (env-
optional pattern), `shared/config/service-status.ts` (banner layout), `domains/research|task-management/agent.ts`
(current `new Memory`), `docker/docker-compose.yml` + `init.sql` (unused pgvector), `docs/adr/002` +
`docs/AGENTS.md` (append-only ADR rule), `tests/AGENTS.md` (skipIf tier rules), `package.json` (scripts/versions),
`tsconfig.json`. Real APIs grounded against installed types where available:
`@mastra/core 1.66.0` (`memory/types.d.ts` semanticRecall/SemanticRecall/VectorIndexConfig/SharedMemoryConfig;
`agent/types.d.ts` DynamicArgument memory & tools; `mastra/index.d.ts` getVector :1034 / listVectors :1077 /
getTool :1528 / listTools :1564 / addTool :1585 — **getTool/getVector throw** `MastraError` on missing keys
(runtime `mastra-B-GDpHtP.js:2964`/:2040) while the ctor skips null registry entries (:1075-1077), so all
degrade-path reads must use the non-throwing `list*` APIs; Memory's derived recall index is **dimension-keyed**
(`memory_messages[_<dim>]`, `agent-CEHR0Wd8.js:17005-17011`, `:17202-17203` — runtime wins over the
`memory/types.d.ts:326-335` "embedder model" comment);
`llm/model/embedding-router.d.ts` declares ModelRouterEmbeddingModel + EMBEDDING_MODELS/EmbeddingModelInfo as the
barrel exports of `@mastra/core/llm` — `isKnownEmbeddingModel`/`getEmbeddingModelInfo` exist only at the deep path),
`@mastra/core/vector` types (`vector/vector.d.ts:13` MastraEmbeddingModel; `memory/types.d.ts:1059` embedder field),
`@mastra/pg 1.24.0`
(`vector/index.d.ts:197` createIndex), `@mastra/libsql 1.22.5` (`vector/index.d.ts:35` LibSQLVector),
`@mastra/fastembed 1.3.1` + `@mastra/rag 2.6.2` (fetched package metadata / official docs), and
`mastra.ai/docs/memory/semantic-recall.md`, `/reference/rag/overview.md`,
`/reference/rag/chunking-and-embedding.md`, `/reference/tools/vector-query-tool.md`, `/reference/vectors/pg.md`,
`/reference/vectors/libsql.md`, `/reference/configuration.md`.
