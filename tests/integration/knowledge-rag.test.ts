import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { LibSQLVector } from '@mastra/libsql';

import {
  createIndexKnowledgeWorkflow,
  KNOWLEDGE_INDEX_NAME,
} from '../../src/mastra/domains/knowledge/workflows/index-knowledge';
import { createKnowledgeQueryTool } from '../../src/mastra/domains/knowledge/tools/knowledge-query';
import { runTool } from '../../src/mastra/shared/tools/run-tool';
import { createHashingEmbedder, createFixedDimEmbedder } from '../helpers/deterministic-embedder';

/**
 * Scenarios 5 + 6 (CI halves) — chat-with-docs vertical end-to-end with ZERO
 * keys and ZERO network: fixture → index-knowledge workflow → search_knowledge
 * vector-query tool. Deterministic hashing embedder plays the E5 role
 * (1024d); the live-E5 variant is the cache-gated evals/OKR-2 check.
 */

const FIXTURE = path.join(process.cwd(), 'tests/fixtures/knowledge/onboarding.md');

type WfOk = { status: string; result?: { docId: string; indexName: string; dimension: number; chunkCount: number; skippedChunks: number } };
const wfOk = (r: unknown): WfOk['result'] => {
  const w = r as WfOk;
  expect(w.status).toBe('success');
  return w.result;
};

interface ToolResult {
  sources?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
}

describe('Scenario 5 — index fixture, then search_knowledge returns the pinned chunk', () => {
  it('workflow success (chunkCount ≥ 3, 1024d) and top-3 contains "€2,000 laptop budget"', async () => {
    const embedder = createHashingEmbedder(1024);
    const vector = new LibSQLVector({ id: 'rag-it-vector', url: 'file::memory:' });

    const workflow = createIndexKnowledgeWorkflow({ embedder: embedder.model, vector });
    const result = await (await workflow.createRun()).start({
      inputData: {
        source: 'path',
        path: FIXTURE,
        contentType: 'markdown',
      },
    });

    expect(wfOk(result)).toMatchObject({
      indexName: KNOWLEDGE_INDEX_NAME,
      dimension: 1024,
    });
    expect(wfOk(result)!.chunkCount).toBeGreaterThanOrEqual(3);

    const tool = createKnowledgeQueryTool({ embedder: embedder.model, vector });
    expect(tool).not.toBeNull();

    const out = await runTool<ToolResult>(tool!, {
      queryText: 'What laptop budget do new hires get?',
      topK: 3,
    });

    // chunk text lives in METADATA (PgVector/LibSQLVector do not populate
    // `document` on query()) — spec 03 Scenario 5 parenthetical.
    const texts = (out.sources ?? [])
      .map(s => String(s.metadata?.text ?? ''))
      .join('\n');
    expect(out.sources?.length).toBeGreaterThan(0);
    expect(texts).toContain('€2,000 laptop budget');
  });

  it('re-index is idempotent and metadata carries provenance (docId/source/embedder)', async () => {
    const embedder = createHashingEmbedder(256);
    const vector = new LibSQLVector({ id: 'rag-it-vector-2', url: 'file::memory:' });
    const workflow = createIndexKnowledgeWorkflow({
      embedder: embedder.model,
      vector,
      embedderDetail: 'stub/hashing-256',
    });
    const input = {
      source: 'inline' as const,
      content: 'Quarterly planning happens every January. Budget reviews follow in February.',
      contentType: 'text' as const,
      docId: 'planning-doc',
    };

    const r1 = await (await workflow.createRun()).start({ inputData: input });
    const r2 = await (await workflow.createRun()).start({ inputData: input });
    wfOk(r1);
    const stats = await vector.describeIndex({ indexName: KNOWLEDGE_INDEX_NAME });
    expect(stats.count).toBe(wfOk(r2)!.chunkCount);

    const tool = createKnowledgeQueryTool({ embedder: embedder.model, vector });
    const out = await runTool<ToolResult>(tool!, { queryText: 'when is quarterly planning', topK: 1 });
    const meta = out.sources?.[0]?.metadata;
    expect(meta).toMatchObject({ docId: 'planning-doc', source: 'inline', embedder: 'stub/hashing-256' });
  });
});

describe('Scenario 6 (CI half) — sticky-dimension hazard fail-fast', () => {
  it('1024d index + 1536d embedder → store-chunks fails, zero vectors written', async () => {
    const e5Stub = createHashingEmbedder(1024);
    const vector = new LibSQLVector({ id: 'rag-it-vector-3', url: 'file::memory:' });
    await (await createIndexKnowledgeWorkflow({ embedder: e5Stub.model, vector }).createRun()).start({
      inputData: { source: 'inline', content: 'first document indexed at the original dimension', contentType: 'text', docId: 'first' },
    });
    const before = await vector.describeIndex({ indexName: KNOWLEDGE_INDEX_NAME });

    const routerStub = createFixedDimEmbedder(1536);
    const failed = await (await createIndexKnowledgeWorkflow({ embedder: routerStub, vector }).createRun()).start({
      inputData: { source: 'inline', content: 'second document after switching EMBEDDING_MODEL', contentType: 'text', docId: 'second' },
    });

    expect(failed.status).toBe('failed');
    const after = await vector.describeIndex({ indexName: KNOWLEDGE_INDEX_NAME });
    expect(after.count).toBe(before.count);
    expect(after.dimension).toBe(1024);
  });
});
