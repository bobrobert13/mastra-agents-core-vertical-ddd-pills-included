import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import path from 'node:path';
import { LibSQLVector } from '@mastra/libsql';

import {
  createIndexKnowledgeWorkflow,
  KNOWLEDGE_INDEX_NAME,
  VectorDimensionMismatchError,
} from '../../../../src/mastra/domains/knowledge/workflows/index-knowledge';
import {
  createHashingEmbedder,
  createFixedDimEmbedder,
  createThrowingEmbedder,
} from '../../../helpers/deterministic-embedder';
import { eventBus } from '../../../../src/mastra/shared/events/event-bus';

/**
 * Spec 03 §3.6 chunk→embed→store step logic via the injectable-deps factory:
 * zero network, zero keys (deterministic stub embedders). Scenarios 5 (offline
 * half) + 6 (CI half) + the read-document containment contract.
 */

const FIXTURE = path.join(process.cwd(), 'tests/fixtures/knowledge/onboarding.md');
const unsubs: Array<() => void> = [];
afterEach(() => {
  while (unsubs.length) unsubs.pop()!();
  vi.restoreAllMocks();
});

type WfOk = {
  status: string;
  result?: {
    docId: string;
    indexName: string;
    dimension: number;
    chunkCount: number;
    skippedChunks: number;
  };
};
const wfOk = (r: unknown): WfOk['result'] => {
  const w = r as WfOk;
  expect(w.status).toBe('success');
  return w.result;
};

function makeVector() {
  return new LibSQLVector({ id: 'knowledge-unit-test', url: 'file::memory:' });
}

describe('index-knowledge workflow (stub embedders, offline)', () => {
  it('runs read→chunk→embed→store: chunkCount ≥ 3, dimension from ACTUAL embed output', async () => {
    const embedder = createHashingEmbedder(1024);
    const vector = makeVector();
    const workflow = createIndexKnowledgeWorkflow({ embedder: embedder.model, vector });
    const run = await workflow.createRun();

    const indexed = new Promise<unknown>(resolve =>
      unsubs.push(eventBus.subscribe('knowledge.indexed', resolve))
    );

    const result = await run.start({
      inputData: { source: 'path', path: FIXTURE, contentType: 'markdown' },
    });

    expect(wfOk(result)).toMatchObject({
      indexName: KNOWLEDGE_INDEX_NAME,
      dimension: 1024,
      chunkCount: expect.any(Number),
    });
    expect(wfOk(result)!.chunkCount).toBeGreaterThanOrEqual(3);

    // pinned fixture sentence lives in a chunk, embedded once
    expect(embedder.embeddedValues.join(' ')).toContain('laptop budget');

    const stats = await vector.describeIndex({ indexName: KNOWLEDGE_INDEX_NAME });
    expect(stats.dimension).toBe(1024);
    expect(stats.count).toBe(wfOk(result)!.chunkCount);

    await expect(indexed).resolves.toMatchObject({
      payload: { indexName: KNOWLEDGE_INDEX_NAME, dimension: 1024 },
    });
  });

  it('deterministic ids: re-indexing the same doc is an idempotent upsert', async () => {
    const embedder = createHashingEmbedder(64);
    const vector = makeVector();
    const workflow = createIndexKnowledgeWorkflow({ embedder: embedder.model, vector });

    const first = await (
      await workflow.createRun()
    ).start({
      inputData: {
        source: 'inline',
        content: 'Alpha bravo charlie document text.',
        contentType: 'text',
        docId: 'doc-x',
      },
    });
    const second = await (
      await workflow.createRun()
    ).start({
      inputData: {
        source: 'inline',
        content: 'Alpha bravo charlie document text.',
        contentType: 'text',
        docId: 'doc-x',
      },
    });

    wfOk(first);
    const stats = await vector.describeIndex({ indexName: KNOWLEDGE_INDEX_NAME });
    expect(stats.count).toBe(wfOk(second)!.chunkCount);
  });

  it('path containment: escaping the workspace root fails the read-document step', async () => {
    const embedder = createHashingEmbedder(64);
    const vector = makeVector();
    const workflow = createIndexKnowledgeWorkflow({ embedder: embedder.model, vector });
    const run = await workflow.createRun();

    const result = await run.start({
      inputData: { source: 'path', path: '../../etc/passwd', contentType: 'text' },
    });

    expect(result.status).toBe('failed');
    expect(embedder.calls).toBe(0);
  });

  it('missing path for source=path fails input validation (zod refine)', async () => {
    const workflow = createIndexKnowledgeWorkflow({
      embedder: createHashingEmbedder(64).model,
      vector: makeVector(),
    });
    const run = await workflow.createRun();
    await expect(
      run.start({ inputData: { source: 'path', contentType: 'text' } as never })
    ).rejects.toThrow();
  });

  it('embed batch failure → step error + module latch (no crash, no partial write)', async () => {
    const thrower = createThrowingEmbedder();
    const vector = makeVector();
    const workflow = createIndexKnowledgeWorkflow({ embedder: thrower.model, vector });
    const run = await workflow.createRun();

    const result = await run.start({
      inputData: {
        source: 'inline',
        content: 'some text to embed for the failure path test',
        contentType: 'text',
      },
    });

    expect(result.status).toBe('failed');
    expect(await vector.listIndexes()).not.toContain(KNOWLEDGE_INDEX_NAME);
  });

  it('Scenario 6 (CI half): 1536d embedder against a 1024d index → VectorDimensionMismatchError BEFORE upsert', async () => {
    // Create the index at 1024d (E5-stub) first.
    const ok = createHashingEmbedder(1024);
    const vector = makeVector();
    const w1 = createIndexKnowledgeWorkflow({ embedder: ok.model, vector });
    const r1 = await (
      await w1.createRun()
    ).start({
      inputData: {
        source: 'inline',
        content: 'original hundred and twenty four dimension document',
        contentType: 'text',
        docId: 'sticky',
      },
    });
    wfOk(r1);
    const countBefore = (await vector.describeIndex({ indexName: KNOWLEDGE_INDEX_NAME })).count;

    // Now switch EMBEDDING_MODEL to a 1536d embedder via the seam.
    const bad = createFixedDimEmbedder(1536);
    const w2 = createIndexKnowledgeWorkflow({ embedder: bad, vector });
    const r2 = await (
      await w2.createRun()
    ).start({
      inputData: {
        source: 'inline',
        content: 'a different document after the embedder switch',
        contentType: 'text',
        docId: 'switched',
      },
    });

    expect(r2.status).toBe('failed');
    const failed = r2 as unknown as {
      error?: Error;
      steps?: Record<string, { error?: Error }>;
    };
    const message = [
      failed.error?.message,
      ...Object.values(failed.steps ?? {}).map(s => s.error?.message),
    ]
      .filter(Boolean)
      .join('\n');
    expect(message).toContain('VectorDimensionMismatchError');
    expect(message).toContain('1024');
    expect(message).toContain('1536');
    expect(message).toContain(KNOWLEDGE_INDEX_NAME);
    expect(message).toMatch(/delete|revert/i); // remediation wording

    // Nothing written: count unchanged, error type available for consumers.
    const after = await vector.describeIndex({ indexName: KNOWLEDGE_INDEX_NAME });
    expect(after.count).toBe(countBefore);
    expect(after.dimension).toBe(1024);
  });

  it('VectorDimensionMismatchError carries stored/requested dims + index name', () => {
    const e = new VectorDimensionMismatchError(KNOWLEDGE_INDEX_NAME, 1024, 1536);
    expect(e).toBeInstanceOf(Error);
    expect(e.storedDimension).toBe(1024);
    expect(e.requestedDimension).toBe(1536);
    expect(e.indexName).toBe(KNOWLEDGE_INDEX_NAME);
  });
});
