/**
 * Knowledge domain Result alias. Instances stay INSIDE the domain — a tool
 * adapts the result to its `outputSchema` before returning.
 */
import { AppResult } from '../../../shared/handlers';
import type { KnowledgeError } from './errors';

/** Success value or a typed `KnowledgeError`. */
export type KnowledgeResult<T> = AppResult<T, KnowledgeError>;

/** Build a knowledge success. */
export function knowledgeOk<T>(value: T): KnowledgeResult<T> {
  return AppResult.ok<T, KnowledgeError>(value);
}

/** Build a knowledge failure from a typed error. */
export function knowledgeFail<T>(error: KnowledgeError): KnowledgeResult<T> {
  return AppResult.fail<T, KnowledgeError>(error);
}
