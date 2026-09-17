/**
 * Communication domain error base. This slice (the floor template) has no
 * real failure path — `ask_user` returns a placeholder — so there are no
 * invented scenario errors here, only the general base and its tool-boundary
 * alias used to normalize any future/unexpected throw.
 */
import { AppError, toAppError } from '../../../shared/handlers';

/** Base for every communication failure — fixes `domain` once. */
export abstract class CommunicationError extends AppError {
  readonly domain = 'communication' as const;
}

/** Generic failure of a communication tool call (the boundary alias). */
export class CommunicationToolError extends CommunicationError {
  readonly code = 'COMMUNICATION_TOOL_ERROR' as const;

  constructor(message: string, cause?: unknown) {
    super(message, { kind: 'internal', cause });
  }
}

/** Normalize any throw into a `CommunicationError` (`AppError` passes through). */
export function toCommunicationError(error: unknown): CommunicationError {
  return toAppError(
    error,
    cause =>
      new CommunicationToolError(cause instanceof Error ? cause.message : String(cause), cause)
  );
}
