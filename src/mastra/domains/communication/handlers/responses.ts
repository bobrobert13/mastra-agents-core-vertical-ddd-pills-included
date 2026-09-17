/**
 * Communication domain Result alias. Instances stay INSIDE the domain — a
 * tool adapts the result to its `outputSchema` before returning.
 */
import { AppResult } from '../../../shared/handlers';
import type { CommunicationError } from './errors';

/** Success value or a typed `CommunicationError`. */
export type CommunicationResult<T> = AppResult<T, CommunicationError>;

/** Build a communication success. */
export function communicationOk<T>(value: T): CommunicationResult<T> {
  return AppResult.ok<T, CommunicationError>(value);
}

/** Build a communication failure from a typed error. */
export function communicationFail<T>(error: CommunicationError): CommunicationResult<T> {
  return AppResult.fail<T, CommunicationError>(error);
}
