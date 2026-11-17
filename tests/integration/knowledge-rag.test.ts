import { describe, expect, it } from 'vitest';
import { LibSQLVector } from '@mastra/libsql';
import {
  createIndexKnowledgeWorkflow,
  KNOWLEDGE_INDEX_NAME,
} from '../../src/mastra/domains/knowledge/workflows/index-knowledge';
import { createKnowledgeQueryTool } from '../../src/mastra/domains/knowledge/tools/knowledge-query';
import { createHashingEmbedder } from '../helpers/deterministic-embedder';
import { callTool } from '../helpers/call-tool';

interface QueryResult {
  sources?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
}

describe('knowledge RAG (deterministic embedder, LibSQL :memory:)', () => {
  it('indexes inline content and returns it from search_knowledge', async () => {
    const embedder = createHashingEmbedder(64);
    const vector = new LibSQLVector({ id: 'knowledge-it', url: 'file::memory:' });
    const content =
      'Quarterly planning happens every January. New hires receive a €2,000 laptop budget.';

    const workflow = createIndexKnowledgeWorkflow({ embedder, vector });
    const result = await (
      await workflow.createRun()
    ).start({
      inputData: {
        source: 'inline',
        content,
        contentType: 'text',
        docId: 'handbook',
      },
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.result).toMatchObject({
      docId: 'handbook',
      indexName: KNOWLEDGE_INDEX_NAME,
      dimension: 64,
    });

    const tool = createKnowledgeQueryTool({ embedder, vector });
    expect(tool).not.toBeNull();

    const output = await callTool<QueryResult>(tool!, {
      queryText: 'What laptop budget do new hires get?',
      topK: 3,
    });

    expect(output.sources?.length).toBeGreaterThan(0);
    const texts = (output.sources ?? []).map(source => String(source.metadata?.text ?? '')).join('\n');
    expect(texts).toContain('€2,000 laptop budget');
    expect(output.sources?.[0]?.metadata).toMatchObject({ docId: 'handbook', source: 'inline' });
  }, 30_000);
});
