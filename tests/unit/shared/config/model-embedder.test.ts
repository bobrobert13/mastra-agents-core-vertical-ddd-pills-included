import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  agentModel,
  embeddingModel,
  guardModel,
  memoryModel,
  resolveEmbedder,
} from '../../../../src/mastra/shared/config/model';
import { logger } from '../../../../src/mastra/shared/logger';

/**
 * Spec 03 §3.2 embedder resolution (unit tier, Scenarios 4a/4b resolution
 * half). Pure env logic — save/restore around every case.
 */

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  vi.restoreAllMocks();
});

function offEnv() {
  delete process.env.SEMANTIC_RECALL;
  delete process.env.EMBEDDING_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPINFRA_API_KEY;
}

describe('embeddingModel()', () => {
  it('reads EMBEDDING_MODEL (never hard-coded)', () => {
    offEnv();
    expect(embeddingModel()).toBeUndefined();
    process.env.EMBEDDING_MODEL = 'openai/text-embedding-3-small';
    expect(embeddingModel()).toBe('openai/text-embedding-3-small');
  });
});

describe('resolveEmbedder()', () => {
  it('unset EMBEDDING_MODEL → fastembed multilingual-E5 pair, 1024d (Scenario 1 config half)', () => {
    offEnv();
    const r = resolveEmbedder();
    expect(r.source).toBe('fastembed');
    expect(r.dimension).toBe(1024);
    expect(r.detail).toBe('fastembed/multilingual-e5-large · 1024d');
    expect(r.passage).toBeDefined();
    expect(r.query).toBeDefined();
    // E5 asymmetric pair: passage !== query identity
    expect(r.query).not.toBe(r.passage);
  });

  it("SEMANTIC_RECALL=off → 'none' with the canonical off detail (Scenario 4b)", () => {
    offEnv();
    process.env.SEMANTIC_RECALL = 'off';
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const r = resolveEmbedder();
    expect(r.source).toBe('none');
    expect(r.passage).toBeUndefined();
    expect(r.query).toBeUndefined();
    expect(r.detail).toBe('off (no embedder)');
    // reason goes to logger.warn, never the banner
    expect(warn).toHaveBeenCalled();
  });

  it('hosted curated id WITH its key → model-router, curated dimension, query===passage', () => {
    offEnv();
    process.env.EMBEDDING_MODEL = 'openai/text-embedding-3-small';
    process.env.OPENAI_API_KEY = 'test-key';
    const r = resolveEmbedder();
    expect(r.source).toBe('model-router');
    expect(r.passage).toBeDefined();
    expect(r.query).toBe(r.passage);
    expect(r.dimension).toBe(1536);
    expect(r.detail).toBe('model-router · openai/text-embedding-3-small · 1536d');
  });

  it("valid-shape but non-curated id → 'model-router' with dimension undefined (§3.2)", () => {
    offEnv();
    process.env.EMBEDDING_MODEL = 'openai/self-hosted-embed-v1';
    process.env.OPENAI_API_KEY = 'test-key';
    const r = resolveEmbedder();
    expect(r.source).toBe('model-router');
    expect(r.dimension).toBeUndefined();
    expect(r.detail).toBe('model-router · openai/self-hosted-embed-v1');
  });

  it('router rejects the id at construction → none, never throws (D3)', () => {
    offEnv();
    process.env.EMBEDDING_MODEL = 'deepinfra/self-hosted-embed-v1';
    process.env.DEEPINFRA_API_KEY = 'test-key';
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const r = resolveEmbedder();
    expect(r.source).toBe('none');
    expect(r.detail).toBe('off (no embedder)');
    expect(warn).toHaveBeenCalled();
  });

  it('hosted curated id WITHOUT its key → none, boot-knowable degrade (Scenario 4a)', () => {
    offEnv();
    process.env.EMBEDDING_MODEL = 'openai/text-embedding-3-small';
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const r = resolveEmbedder();
    expect(r.source).toBe('none');
    expect(r.detail).toBe('off (no embedder)');
    expect(r.passage).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('malformed EMBEDDING_MODEL (no provider/) → none, warn', () => {
    offEnv();
    process.env.EMBEDDING_MODEL = 'just-a-model-name';
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const r = resolveEmbedder();
    expect(r.source).toBe('none');
    expect(r.detail).toBe('off (no embedder)');
    expect(warn).toHaveBeenCalled();
  });
});

describe('existing model.ts exports unchanged (§3.2 extend-only rule)', () => {
  it('agentModel/memoryModel/guardModel keep their env precedence with embedder vars set', () => {
    offEnv();
    process.env.SEMANTIC_RECALL = 'off';
    expect(agentModel.research()).toBe('openai/gpt-4o-mini');
    expect(memoryModel()).toBe('openai/gpt-4o-mini');
    expect(guardModel()).toBe('openai/gpt-4o-mini');
    process.env.MODEL = 'deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731';
    expect(agentModel.tasks()).toBe('deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731');
    expect(guardModel()).toBe('deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731');
    process.env.MODEL_FILES = 'anthropic/claude-sonnet-4-5';
    expect(agentModel.files()).toBe('anthropic/claude-sonnet-4-5');
  });
});
