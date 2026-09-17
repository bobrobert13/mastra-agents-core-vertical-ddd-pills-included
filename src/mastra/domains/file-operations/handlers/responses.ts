/**
 * File-operations domain Result alias. Instances stay INSIDE the domain — a
 * tool adapts the result to its `outputSchema` before returning.
 */
import { AppResult } from '../../../shared/handlers';
import type { FileOperationsError } from './errors';

/** Success value or a typed `FileOperationsError`. */
export type FileOperationsResult<T> = AppResult<T, FileOperationsError>;

/** Build a file-operations success. */
export function fileOperationsOk<T>(value: T): FileOperationsResult<T> {
  return AppResult.ok<T, FileOperationsError>(value);
}

/** Build a file-operations failure from a typed error. */
export function fileOperationsFail<T>(error: FileOperationsError): FileOperationsResult<T> {
  return AppResult.fail<T, FileOperationsError>(error);
}
