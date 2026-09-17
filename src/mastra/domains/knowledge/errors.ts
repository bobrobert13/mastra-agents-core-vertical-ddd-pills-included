/**
 * Knowledge domain error contracts. `VectorDimensionMismatchError` is public:
 * consumers import it through the barrel (and the workflow module re-exports it).
 */

/**
 * Thrown by `store-chunks` when an existing index was created by a different-
 * dimension embedder (Scenario 6). Remediation: delete the index and re-index,
 * or revert EMBEDDING_MODEL (gotcha #G3).
 */
export class VectorDimensionMismatchError extends Error {
  readonly storedDimension: number;
  readonly requestedDimension: number;
  readonly indexName: string;

  constructor(indexName: string, storedDimension: number, requestedDimension: number) {
    super(
      `VectorDimensionMismatchError: index "${indexName}" stores ${storedDimension}d vectors ` +
        `but the current embedder produces ${requestedDimension}d. An index is bound to one ` +
        `embedder dimension forever (gotcha #G3). Remediation: delete index "${indexName}" and ` +
        `re-run the index-knowledge workflow, or revert EMBEDDING_MODEL to the original embedder.`
    );
    this.name = 'VectorDimensionMismatchError';
    this.storedDimension = storedDimension;
    this.requestedDimension = requestedDimension;
    this.indexName = indexName;
  }
}
