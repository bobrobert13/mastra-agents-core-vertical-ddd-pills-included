/**
 * Knowledge domain error contracts (moved here from `../errors.ts`).
 *
 * Every concrete failure extends `KnowledgeError` so a caller can adapt it by
 * `kind` / `code` without string matching. `VectorDimensionMismatchError` is
 * public: the workflow module and the domain barrel re-export it.
 */
import { AppError, toAppError } from '../../../shared/handlers';

/** Base for every knowledge failure — fixes `domain` once. */
export abstract class KnowledgeError extends AppError {
  readonly domain = 'knowledge' as const;
}

/**
 * Thrown by `store-chunks` when an existing index was created by a different-
 * dimension embedder (Scenario 6). Remediation: delete the index and re-index,
 * or revert EMBEDDING_MODEL (gotcha #G3).
 */
export class VectorDimensionMismatchError extends KnowledgeError {
  readonly code = 'VECTOR_DIMENSION_MISMATCH' as const;
  readonly storedDimension: number;
  readonly requestedDimension: number;
  readonly indexName: string;

  constructor(indexName: string, storedDimension: number, requestedDimension: number) {
    super(
      `VectorDimensionMismatchError: index "${indexName}" stores ${storedDimension}d vectors ` +
        `but the current embedder produces ${requestedDimension}d. An index is bound to one ` +
        `embedder dimension forever (gotcha #G3). Remediation: delete index "${indexName}" and ` +
        `re-run the index-knowledge workflow, or revert EMBEDDING_MODEL to the original embedder.`,
      { kind: 'conflict' }
    );
    this.name = 'VectorDimensionMismatchError';
    this.storedDimension = storedDimension;
    this.requestedDimension = requestedDimension;
    this.indexName = indexName;
  }
}

/** No passage embedder resolved for `embed-chunks` (semantic recall is off). */
export class EmbedderUnavailableError extends KnowledgeError {
  readonly code = 'EMBEDDER_UNAVAILABLE' as const;

  constructor(message: string) {
    super(message, { kind: 'unavailable' });
  }
}

/** `doEmbed` threw, or produced no vectors — wraps the underlying cause. */
export class EmbedFailureError extends KnowledgeError {
  readonly code = 'EMBED_FAILED' as const;

  constructor(message: string, cause?: unknown) {
    super(message, { kind: 'internal', cause });
  }
}

/** No vector store resolved for `store-chunks`. */
export class VectorStoreUnavailableError extends KnowledgeError {
  readonly code = 'VECTOR_STORE_UNAVAILABLE' as const;

  constructor(message: string) {
    super(message, { kind: 'unavailable' });
  }
}

/** The indexing source is invalid (e.g. a path escaping workspace containment). */
export class KnowledgeSourceError extends KnowledgeError {
  readonly code = 'KNOWLEDGE_SOURCE_INVALID' as const;

  constructor(message: string) {
    super(message, { kind: 'validation' });
  }
}

/** Fallback for an unclassified throw crossing the knowledge boundary. */
export class UnexpectedKnowledgeError extends KnowledgeError {
  readonly code = 'KNOWLEDGE_ERROR' as const;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { kind: 'internal', cause });
  }
}

/** Normalize any throw into a `KnowledgeError` (an `AppError` passes through). */
export function toKnowledgeError(error: unknown): KnowledgeError {
  return toAppError(error, cause => new UnexpectedKnowledgeError(cause));
}
