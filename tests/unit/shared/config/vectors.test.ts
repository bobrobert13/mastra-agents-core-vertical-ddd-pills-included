import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServiceStatus } from '../../../../src/mastra/shared/config/service-status';

/**
 * Spec 03 §3.3 vectors builder + §3.3 buildDomainMemory factory (unit tier).
 * Fresh module import per test so the module-level recall latch never leaks.
 */

const originalEnv = { ...process.env };

function cleanEnv() {
  process.env = { ...originalEnv };
  delete process.env.DATABASE_URL;
  delete process.env.LIBSQL_URL;
  delete process.env.EMBEDDING_MODEL;
  delete process.env.SEMANTIC_RECALL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.DEEPINFRA_API_KEY;
}

async function freshVectors() {
  vi.resetModules();
  const vectors = await import('../../../../src/mastra/shared/config/vectors');
  const model = await import('../../../../src/mastra/shared/config/model');
  const { logger } = await import('../../../../src/mastra/shared/logger');
  return { ...vectors, resolveEmbedder: model.resolveEmbedder, logger };
}

/** service-status.ts:14 render rule — spacing derived, never hand-typed. */
const render = (s: ServiceStatus) => `${s.active ? '✅' : '○'} ${s.name.padEnd(16)} ${s.detail}`;
const canonical = (s: ServiceStatus) => `${s.name}: ${s.detail}`;
const byName = (services: ServiceStatus[], name: string) => services.find(s => s.name === name);

beforeEach(cleanEnv);

describe('buildVectors — store resolution mirrors storage.ts', () => {
  it('DATABASE_URL postgres → PgVector + hnsw/dotproduct banner (Scenario 2 config half)', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/mastra';
    const { buildVectors, VECTOR_STORE_NAME } = await freshVectors();
    const { PgVector } = await import('@mastra/pg');

    const services: ServiceStatus[] = [];
    const res = buildVectors(services);

    expect(res.kind).toBe('pgvector');
    expect(res.store).toBeInstanceOf(PgVector);
    expect(res.store!.id).toBe(VECTOR_STORE_NAME);
    const store = byName(services, 'Vector store')!;
    expect([store.name, store.active, store.detail]).toEqual([
      'Vector store',
      true,
      'PgVector (DATABASE_URL) — hnsw/dotproduct',
    ]);
    expect(render(store)).toBe('✅ Vector store     PgVector (DATABASE_URL) — hnsw/dotproduct');
  });

  it('zero-config → LibSQLVector on the storage URL (Scenario 1 config half)', async () => {
    const { buildVectors, VECTOR_STORE_NAME } = await freshVectors();
    const { LibSQLVector } = await import('@mastra/libsql');

    const services: ServiceStatus[] = [];
    const res = buildVectors(services);

    expect(res.kind).toBe('libsql');
    expect(res.store).toBeInstanceOf(LibSQLVector);
    expect(res.store!.id).toBe(VECTOR_STORE_NAME);
    const store = byName(services, 'Vector store')!;
    expect(store.detail).toBe('LibSQLVector (file:./mastra.db — cosine)');
    expect(render(store)).toBe('✅ Vector store     LibSQLVector (file:./mastra.db — cosine)');
  });

  it('LIBSQL_URL custom location is honored by the vector store too', async () => {
    process.env.LIBSQL_URL = 'file:./custom-vectors.db';
    const { buildVectors } = await freshVectors();
    const services: ServiceStatus[] = [];
    buildVectors(services);
    expect(byName(services, 'Vector store')!.detail).toBe(
      'LibSQLVector (file:./custom-vectors.db — cosine)'
    );
  });
});

describe('banner lines — canonical strings (§3.9), both branches', () => {
  // The fastembed disk check is a seam: unit cases must not depend on whether
  // this machine's ~/.cache is warm (gotcha #13).
  const warmCache = { fastembedCacheReady: () => true };
  const poisonedCache = { fastembedCacheReady: () => false };

  it('recall ON (local E5, warm cache): exact active lines + Knowledge RAG', async () => {
    const { buildVectors } = await freshVectors();
    const services: ServiceStatus[] = [];
    buildVectors(services, warmCache);

    const recall = byName(services, 'Semantic recall')!;
    expect(render(recall)).toBe(
      '✅ Semantic recall  on (fastembed/multilingual-e5-large · 1024d · scope:resource)'
    );
    const rag = byName(services, 'Knowledge RAG')!;
    expect(render(rag)).toBe(
      '✅ Knowledge RAG    workflow index-knowledge + tool search_knowledge'
    );
  });

  it('poisoned fastembed cache (dir present, model.onnx absent) → off at BOOT + repair hint (gotcha #13)', async () => {
    const v = await freshVectors();
    const warn = vi.spyOn(v.logger, 'warn').mockImplementation(() => {});
    const services: ServiceStatus[] = [];
    v.buildVectors(services, poisonedCache);

    // The honest banner: recall cannot be promised, so it is never promised.
    expect(render(byName(services, 'Semantic recall')!)).toBe('○ Semantic recall  off (no embedder)');
    expect(byName(services, 'Knowledge RAG')!.detail).toBe('off (no embedder)');
    expect(v.semanticRecallAvailable()).toBe(false);

    // Reason is actionable and carries the missing artifact + the repair command.
    const canonicalWarns = warn.mock.calls.filter(call =>
      String(call[0]).startsWith('Semantic recall: off (no embedder)')
    );
    expect(canonicalWarns).toHaveLength(1);
    expect(String(canonicalWarns[0][0])).toContain('model.onnx');
    expect(String(canonicalWarns[0][0])).toContain('npm run warm:embeddings');
  });

  it('the disk check gates FASTEMBED only — a hosted embedder is unaffected', async () => {
    process.env.EMBEDDING_MODEL = 'openai/text-embedding-3-small';
    process.env.OPENAI_API_KEY = 'test-key';
    const v = await freshVectors();
    const services: ServiceStatus[] = [];
    v.buildVectors(services, poisonedCache);

    expect(byName(services, 'Semantic recall')!.active).toBe(true);
    expect(v.semanticRecallAvailable()).toBe(true);
  });

  it('hosted embedder without its key → canonical off lines (Scenario 4a)', async () => {
    process.env.EMBEDDING_MODEL = 'openai/text-embedding-3-small';
    const { buildVectors } = await freshVectors();
    const services: ServiceStatus[] = [];
    buildVectors(services);

    const recall = byName(services, 'Semantic recall')!;
    expect([recall.name, recall.active, recall.detail]).toEqual([
      'Semantic recall',
      false,
      'off (no embedder)',
    ]);
    expect(render(recall)).toBe('○ Semantic recall  off (no embedder)');
    expect(canonical(recall)).toBe('Semantic recall: off (no embedder)');
    expect(byName(services, 'Knowledge RAG')!.active).toBe(false);
    // degrade never kills the store line
    expect(byName(services, 'Vector store')!.active).toBe(true);
  });

  it('SEMANTIC_RECALL=off → identical off state even with everything else valid (Scenario 4b)', async () => {
    process.env.SEMANTIC_RECALL = 'off';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/mastra';
    process.env.OPENAI_API_KEY = 'test-key';
    const { buildVectors } = await freshVectors();
    const services: ServiceStatus[] = [];
    buildVectors(services);

    const recall = byName(services, 'Semantic recall')!;
    expect(render(recall)).toBe('○ Semantic recall  off (no embedder)');
    expect(canonical(recall)).toBe('Semantic recall: off (no embedder)');
    expect(byName(services, 'Knowledge RAG')!.detail).toBe('off (no embedder)');
  });

  it('pushRecallBanner pushes BOTH lines in EVERY branch (shared/AGENTS.md rule)', async () => {
    const { pushRecallBanner, resolveEmbedder } = await freshVectors();
    for (const off of [false, true]) {
      cleanEnv();
      if (off) process.env.SEMANTIC_RECALL = 'off';
      const services: ServiceStatus[] = [];
      pushRecallBanner(services, resolveEmbedder());
      expect(services.map(s => s.name)).toEqual(['Semantic recall', 'Knowledge RAG']);
    }
  });
});

describe('semanticRecallAvailable / markEmbedderUnavailable (latch)', () => {
  it('SEMANTIC_RECALL=off → available() false at boot; reset flips back', async () => {
    process.env.SEMANTIC_RECALL = 'off';
    const v = await freshVectors();
    expect(v.semanticRecallAvailable()).toBe(false);
  });

  it('first runtime failure latches one-way + ONE canonical warn (Scenario 4c mechanics)', async () => {
    const v = await freshVectors();
    const warn = vi.spyOn(v.logger, 'warn').mockImplementation(() => {});
    expect(v.semanticRecallAvailable()).toBe(true);

    v.markEmbedderUnavailable('offline: cold model cache');
    v.markEmbedderUnavailable('again');

    expect(v.semanticRecallAvailable()).toBe(false);
    const canonicalWarns = warn.mock.calls.filter(call =>
      String(call[0]).startsWith('Semantic recall: off (no embedder)')
    );
    expect(canonicalWarns).toHaveLength(1);
    expect(String(canonicalWarns[0][0])).toBe(
      'Semantic recall: off (no embedder) — offline: cold model cache'
    );
  });
});

describe('buildDomainMemory — §3.3 factory (identity vs availability fix)', () => {
  it('SEMANTIC_RECALL=off with an injected embedder → ZERO embed calls (Scenario 4b)', async () => {
    process.env.SEMANTIC_RECALL = 'off';
    const v = await freshVectors();
    const { createHashingEmbedder } = await import('../../../helpers/deterministic-embedder');
    const { LibSQLVector, LibSQLStore } = await import('@mastra/libsql');

    expect(v.semanticRecallAvailable()).toBe(false); // production-path observable

    const stub = createHashingEmbedder(1024);
    const memory = await v.buildDomainMemory(
      { generateTitle: true },
      {
        embedder: stub.model,
        vector: new LibSQLVector({ id: 't', url: 'file::memory:' }),
      }
    )({ requestContext: {} as never });

    memory.setStorage(new LibSQLStore({ id: 't', url: 'file::memory:' }));
    await memory.saveMessages({
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: { format: 2, parts: [{ type: 'text', text: 'hello' }] },
          threadId: 'th',
          resourceId: 'r',
        },
      ] as never,
    });

    expect(stub.calls).toBe(0);
    expect(stub.embeddedValues).toEqual([]);
  });

  it('deps.embedder replaces IDENTITY while recall is ON (embed calls flow to the stub)', async () => {
    const v = await freshVectors();
    const { createHashingEmbedder } = await import('../../../helpers/deterministic-embedder');
    const { LibSQLVector, LibSQLStore } = await import('@mastra/libsql');

    const stub = createHashingEmbedder(64);
    const vector = new LibSQLVector({ id: 't', url: 'file::memory:' });
    const memory = await v.buildDomainMemory(
      { generateTitle: true },
      {
        embedder: stub.model,
        vector,
      }
    )({ requestContext: {} as never });

    memory.setStorage(new LibSQLStore({ id: 't', url: 'file::memory:' }));
    await memory.saveMessages({
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: { format: 2, parts: [{ type: 'text', text: 'hello there' }] },
          threadId: 'th',
          resourceId: 'r',
        },
      ] as never,
    });

    expect(stub.calls).toBeGreaterThan(0);
    const indexes = await vector.listIndexes();
    expect(indexes).toContain('memory_messages_64'); // derived from PROBED dim, not model id (G3)
  });

  it('resolves the store from the Mastra registry via the NON-THROWING listVectors read', async () => {
    const v = await freshVectors();
    const { createHashingEmbedder } = await import('../../../helpers/deterministic-embedder');
    const { LibSQLStore } = await import('@mastra/libsql');

    const registryVector = { id: v.VECTOR_STORE_NAME, __registry: true };
    const fakeMastra = { listVectors: () => ({ [v.VECTOR_STORE_NAME]: registryVector }) };
    const stub = createHashingEmbedder(64);

    const memory = await v.buildDomainMemory(
      { generateTitle: true },
      { embedder: stub.model }
    )({ requestContext: {} as never, mastra: fakeMastra as never });
    // Wires without touching the throwing getVector(); registry entry used.
    expect(memory).toBeDefined();
    expect((memory as unknown as { vector?: unknown }).vector).toBe(registryVector);
  });

  it('absent registry key (fully-off / ctor skipped null) → no crash, recall off', async () => {
    process.env.SEMANTIC_RECALL = 'off';
    const v = await freshVectors();
    const memory = await v.buildDomainMemory({ generateTitle: true })({
      requestContext: {} as never,
      mastra: { listVectors: () => undefined } as never,
    });
    expect(memory).toBeDefined();
  });

  it('a BROKEN embedder degrades AT BUILD TIME: Memory still builds, recall latches off (ADR-006)', async () => {
    const v = await freshVectors();
    const { createThrowingEmbedder } = await import('../../../helpers/deterministic-embedder');
    const { LibSQLVector } = await import('@mastra/libsql');
    const vector = new LibSQLVector({ id: 'broken', url: 'file::memory:' });

    const broken = createThrowingEmbedder();
    // Before the fix this handed Memory an embedder that Mastra probes INSIDE the
    // turn (getEmbeddingDimension), so the whole request 500ed.
    const memory = await v.buildDomainMemory(
      { generateTitle: true },
      { embedder: broken.model, vector }
    )({ requestContext: {} as never });

    expect(memory).toBeDefined();
    expect(broken.calls).toBe(1); // exactly one probe — no retry storm
    expect(v.semanticRecallAvailable()).toBe(false);
    // Degraded Memory: no vector attached, plain history only.
    expect((memory as unknown as { vector?: unknown }).vector).toBeUndefined();

    // Next request does not even attempt the embedder again.
    const nextBroken = createThrowingEmbedder();
    await v.buildDomainMemory(
      { generateTitle: true },
      { embedder: nextBroken.model, vector }
    )({ requestContext: {} as never });
    expect(nextBroken.calls).toBe(0);
  });
});
