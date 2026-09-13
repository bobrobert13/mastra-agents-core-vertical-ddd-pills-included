import { describe, it, expect } from 'vitest';
import { LibSQLStore } from '@mastra/libsql';

import {
  buildVectors,
  VECTOR_STORE_NAME,
  RECALL_OPTIONS,
} from '../../src/mastra/shared/config/vectors';
import type { ServiceStatus } from '../../src/mastra/shared/config/service-status';
import {
  createIndexKnowledgeWorkflow,
  KNOWLEDGE_INDEX_NAME,
} from '../../src/mastra/domains/knowledge';
import { createHashingEmbedder } from '../helpers/deterministic-embedder';

/**
 * Scenario 2 — Postgres path (integration-postgres tier). The whole file is
 * gated on a real pgvector DATABASE_URL (compose/CI adds the service); a
 * plain `vitest run` without Postgres skips it.
 */
const isPg = /^postgres/i.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!isPg)('Scenario 2 — PgVector on postgres (integration-postgres)', () => {
  it('buildVectors picks PgVector + hnsw/dotproduct banner, describeIndex reports the embedder dimension', async () => {
    const services: ServiceStatus[] = [];
    const { store, kind } = buildVectors(services);
    expect(kind).toBe('pgvector');
    expect(store).not.toBeNull();
    expect(services.find(s => s.name === 'Vector store')?.detail).toBe(
      'PgVector (DATABASE_URL) — hnsw/dotproduct'
    );

    // Memory's auto-created recall index honors indexConfig via RECALL_OPTIONS;
    // LibSQL ignores it and keeps cosine (verified shape memory/types.d.ts).
    expect(RECALL_OPTIONS.indexConfig).toEqual({
      type: 'hnsw',
      metric: 'dotproduct',
      hnsw: { m: 16, efConstruction: 64 },
    });

    // knowledge_docs created by a workflow run → describeIndex honors 1024 (E5)
    const embedder = createHashingEmbedder(1024);
    const workflow = createIndexKnowledgeWorkflow({ embedder: embedder.model, vector: store! });
    const result = await (
      await workflow.createRun()
    ).start({
      inputData: {
        source: 'inline',
        content:
          'PgVector scenario two document: rotations happen Fridays and audits happen quarterly in the staging environment.',
        contentType: 'text',
        docId: 'pg-scenario-2',
      },
    });
    expect((result as { status: string }).status).toBe('success');

    const stats = await store!.describeIndex({ indexName: KNOWLEDGE_INDEX_NAME });
    expect(stats.dimension).toBe(1024);

    // registry visibility contract (Studio)
    void VECTOR_STORE_NAME;
    void LibSQLStore;
  });
});
