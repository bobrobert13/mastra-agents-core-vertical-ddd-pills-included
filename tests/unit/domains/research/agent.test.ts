import { describe, it, expect, afterEach, vi } from 'vitest';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { resolveModel } from '../../../../src/mastra/shared/config/model';
import { researchAgent } from '../../../../src/mastra/domains/research/agent';

describe('ResearchAgent', () => {
  it('should be defined', () => {
    expect(researchAgent).toBeDefined();
    expect(researchAgent.id).toBe('research-agent');
    expect(researchAgent.name).toBe('Research Agent');
  });

  it('should have correct model', () => {
    expect(researchAgent.model).toBe(resolveModel('research'));
  });
});

/**
 * Scenario 1 registry half + Scenario 4a tool-absence half (spec 03 §3.11):
 * the 'mastra-vectors' key must resolve through listVectors(), and
 * search_knowledge must be present in the tools registry iff an embedder
 * resolved — with the non-throwing listTools() read the research agent's
 * dynamic tools resolver depends on.
 */
describe('Mastra vectors/tools registry (knowledge contracts)', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  async function freshRegistry(env: Record<string, string | undefined>) {
    process.env = { ...originalEnv, ...env };
    delete process.env.EMBEDDING_MODEL;
    delete process.env.SEMANTIC_RECALL;
    delete process.env.OPENAI_API_KEY;
    for (const [k, val] of Object.entries(env)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
    vi.resetModules();
    const vectors = await import('../../../../src/mastra/shared/config/vectors');
    const knowledge = await import('../../../../src/mastra/domains/knowledge');
    const { createHashingEmbedder } = await import('../../../helpers/deterministic-embedder');
    const stub = createHashingEmbedder(64);
    const store = new LibSQLVector({ id: vectors.VECTOR_STORE_NAME, url: 'file::memory:' });
    const tool = knowledge.createKnowledgeQueryTool({ embedder: stub.model, vector: store });
    const mastra = new Mastra({
      storage: new LibSQLStore({ id: 'registry-test', url: 'file::memory:' }),
      vectors: { [vectors.VECTOR_STORE_NAME]: store },
      ...(tool ? { tools: { search_knowledge: tool } } : {}),
    });
    return { mastra, vectors, tool };
  }

  it('listVectors() exposes the store under the registry name mastra-vectors', async () => {
    const { mastra, vectors } = await freshRegistry({});
    const names = Object.keys(mastra.listVectors() ?? {});
    expect(names).toContain(vectors.VECTOR_STORE_NAME);
    expect(vectors.VECTOR_STORE_NAME).toBe('mastra-vectors');
    // getVector() resolves it too (Studio + memory factory path)
    expect(mastra.getVector('mastra-vectors')).toBeDefined();
  });

  it('embedder resolved → listTools().search_knowledge present', async () => {
    const { mastra, tool } = await freshRegistry({});
    expect(tool).not.toBeNull();
    expect(mastra.listTools()).toHaveProperty('search_knowledge');
  });

  it('SEMANTIC_RECALL=off → tool is null, registry key absent, listTools() never throws (4b/4a)', async () => {
    const { mastra, tool } = await freshRegistry({ SEMANTIC_RECALL: 'off' });
    expect(tool).toBeNull();
    expect(mastra.listTools()).not.toHaveProperty('search_knowledge');
  });
});
