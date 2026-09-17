/**
 * File-operations domain error contracts. The typed errors are created at the
 * tool boundary (`tools/*.ts`) so the domain never leaks a bare `Error`.
 */
import { AppError, toAppError } from '../../../shared/handlers';

/** Base for every file-operations failure — fixes `domain` once. */
export abstract class FileOperationsError extends AppError {
  readonly domain = 'file-operations' as const;
}

/**
 * A requested path escaped the workspace jail (`resolveWorkspacePath`). The
 * message is the documented public contract the tool tests match on.
 */
export class WorkspaceJailError extends FileOperationsError {
  readonly code = 'WORKSPACE_JAIL_ESCAPE' as const;

  constructor(requested: string) {
    super(`Path escapes the workspace jail: ${requested}`, { kind: 'validation' });
  }
}

/** `fs.readFile` failed (missing file, permissions, bad encoding, ...). */
export class FileReadError extends FileOperationsError {
  readonly code = 'FILE_READ_FAILED' as const;

  constructor(detail: string, cause?: unknown) {
    super(`Failed to read file: ${detail}`, { kind: 'internal', cause });
  }
}

/** `fs.writeFile`/`mkdir` failed. */
export class FileWriteError extends FileOperationsError {
  readonly code = 'FILE_WRITE_FAILED' as const;

  constructor(detail: string, cause?: unknown) {
    super(`Failed to write file: ${detail}`, { kind: 'internal', cause });
  }
}

/** `fs.readFile` + rewrite failed while editing. */
export class FileEditError extends FileOperationsError {
  readonly code = 'FILE_EDIT_FAILED' as const;

  constructor(detail: string, cause?: unknown) {
    super(`Failed to edit file: ${detail}`, { kind: 'internal', cause });
  }
}

/** Fallback for an unclassified throw crossing the file-operations boundary. */
export class UnexpectedFileOperationsError extends FileOperationsError {
  readonly code = 'FILE_OPERATIONS_ERROR' as const;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { kind: 'internal', cause });
  }
}

/** Normalize any throw into a `FileOperationsError` (`AppError` passes through). */
export function toFileOperationsError(error: unknown): FileOperationsError {
  return toAppError(error, cause => new UnexpectedFileOperationsError(cause));
}
