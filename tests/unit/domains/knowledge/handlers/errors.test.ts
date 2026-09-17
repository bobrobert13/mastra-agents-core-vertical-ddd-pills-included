import { describe, it, expect } from 'vitest';

import { AppError } from '../../../../../src/mastra/shared/handlers';
import {
  KnowledgeError,
  VectorDimensionMismatchError,
  EmbedderUnavailableError,
  EmbedFailureError,
  VectorStoreUnavailableError,
  KnowledgeSourceError,
  UnexpectedKnowledgeError,
  toKnowledgeError,
} from '../../../../../src/mastra/domains/knowledge/handlers/errors';

/**
 * Fase 4 — knowledge domain error contracts (moved to `handlers/errors.ts`).
 * `VectorDimensionMismatchError` keeps its public contract EXACTLY: fields,
 * `name` and the remediation message the indexing tests match on.
 */
describe('knowledge errors', () => {
  it('every concrete error is a KnowledgeError / AppError with domain=knowledge', () => {
    const errors: KnowledgeError[] = [
      new VectorDimensionMismatchError('knowledge_docs', 1024, 1536),
      new EmbedderUnavailableError('no embedder'),
      new EmbedFailureError('embed failed'),
      new VectorStoreUnavailableError('no store'),
      new KnowledgeSourceError('bad source'),
      new UnexpectedKnowledgeError(new Error('boom')),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(KnowledgeError);
      expect(error.domain).toBe('knowledge');
      expect(typeof error.code).toBe('string');
    }
  });

  it('VectorDimensionMismatchError preserves fields, name, kind and the remediation message', () => {
    const error = new VectorDimensionMismatchError('knowledge_docs', 1024, 1536);

    expect(error.name).toBe('VectorDimensionMismatchError');
    expect(error.code).toBe('VECTOR_DIMENSION_MISMATCH');
    expect(error.kind).toBe('conflict');
    expect(error.storedDimension).toBe(1024);
    expect(error.requestedDimension).toBe(1536);
    expect(error.indexName).toBe('knowledge_docs');

    expect(error.message).toContain('VectorDimensionMismatchError');
    expect(error.message).toContain('1024');
    expect(error.message).toContain('1536');
    expect(error.message).toContain('knowledge_docs');
    expect(error.message).toContain('gotcha #G3');
    expect(error.message).toMatch(/delete|revert/i);
  });

  it('EmbedderUnavailableError / VectorStoreUnavailableError are unavailable', () => {
    const embedder = new EmbedderUnavailableError('no embedder resolved');
    expect(embedder.code).toBe('EMBEDDER_UNAVAILABLE');
    expect(embedder.kind).toBe('unavailable');
    expect(embedder.message).toBe('no embedder resolved');

    const store = new VectorStoreUnavailableError('no vector store');
    expect(store.code).toBe('VECTOR_STORE_UNAVAILABLE');
    expect(store.kind).toBe('unavailable');
  });

  it('EmbedFailureError wraps the cause (internal)', () => {
    const cause = new Error('provider exploded');
    const error = new EmbedFailureError('embed exploded', cause);

    expect(error.code).toBe('EMBED_FAILED');
    expect(error.kind).toBe('internal');
    expect(error.message).toBe('embed exploded');
    expect(error.cause).toBe(cause);

    const bare = new EmbedFailureError('no vectors');
    expect(bare.cause).toBeUndefined();
  });

  it('KnowledgeSourceError is a validation failure', () => {
    const error = new KnowledgeSourceError('path escapes containment');
    expect(error.code).toBe('KNOWLEDGE_SOURCE_INVALID');
    expect(error.kind).toBe('validation');
  });

  it('UnexpectedKnowledgeError carries a readable message and the cause (internal)', () => {
    const error = new UnexpectedKnowledgeError(new Error('driver down'));
    expect(error.code).toBe('KNOWLEDGE_ERROR');
    expect(error.kind).toBe('internal');
    expect(error.message).toBe('driver down');

    const stringy = new UnexpectedKnowledgeError('raw string');
    expect(stringy.message).toBe('raw string');
  });
});

describe('toKnowledgeError', () => {
  it('passes an AppError through untouched', () => {
    const original = new EmbedderUnavailableError('already typed');
    expect(toKnowledgeError(original)).toBe(original);
  });

  it('wraps any unknown throw in the domain fallback', () => {
    const cause = new Error('unclassified');
    const normalized = toKnowledgeError(cause);

    expect(normalized).toBeInstanceOf(KnowledgeError);
    expect(normalized.code).toBe('KNOWLEDGE_ERROR');
    expect(normalized.kind).toBe('internal');
    expect(normalized.message).toBe('unclassified');
    expect(normalized.cause).toBe(cause);
  });
});
