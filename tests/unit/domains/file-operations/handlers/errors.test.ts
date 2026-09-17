import { describe, it, expect } from 'vitest';

import { AppError } from '../../../../../src/mastra/shared/handlers';
import {
  FileOperationsError,
  WorkspaceJailError,
  FileReadError,
  FileWriteError,
  FileEditError,
  UnexpectedFileOperationsError,
  toFileOperationsError,
} from '../../../../../src/mastra/domains/file-operations/handlers/errors';

/** Fase 4 — file-operations error contracts (typed errors at the tool boundary). */
describe('file-operations errors', () => {
  it('every concrete error is a FileOperationsError / AppError with domain=file-operations', () => {
    const errors: FileOperationsError[] = [
      new WorkspaceJailError('../escape'),
      new FileReadError('boom'),
      new FileWriteError('boom'),
      new FileEditError('boom'),
      new UnexpectedFileOperationsError(new Error('boom')),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(FileOperationsError);
      expect(error.domain).toBe('file-operations');
      expect(typeof error.code).toBe('string');
    }
  });

  it('WorkspaceJailError carries the exact public message and is a validation failure', () => {
    const error = new WorkspaceJailError('../../etc/passwd');

    expect(error.code).toBe('WORKSPACE_JAIL_ESCAPE');
    expect(error.kind).toBe('validation');
    expect(error.message).toBe('Path escapes the workspace jail: ../../etc/passwd');
  });

  it('fs failures keep their code, kind and prefixed detail', () => {
    const read = new FileReadError('ENOENT');
    expect(read.code).toBe('FILE_READ_FAILED');
    expect(read.kind).toBe('internal');
    expect(read.message).toBe('Failed to read file: ENOENT');

    const write = new FileWriteError('EACCES');
    expect(write.code).toBe('FILE_WRITE_FAILED');
    expect(write.message).toBe('Failed to write file: EACCES');

    const edit = new FileEditError('EISDIR');
    expect(edit.code).toBe('FILE_EDIT_FAILED');
    expect(edit.message).toBe('Failed to edit file: EISDIR');
  });

  it('preserves the underlying cause', () => {
    const cause = new Error('disk on fire');
    expect(new FileReadError('boom', cause).cause).toBe(cause);
    expect(new FileWriteError('boom', cause).cause).toBe(cause);
    expect(new FileEditError('boom', cause).cause).toBe(cause);
  });
});

describe('toFileOperationsError', () => {
  it('passes an AppError through untouched', () => {
    const original = new WorkspaceJailError('../escape');
    expect(toFileOperationsError(original)).toBe(original);
  });

  it('wraps any unknown throw in the domain fallback', () => {
    const cause = new Error('unclassified');
    const normalized = toFileOperationsError(cause);

    expect(normalized).toBeInstanceOf(FileOperationsError);
    expect(normalized.code).toBe('FILE_OPERATIONS_ERROR');
    expect(normalized.kind).toBe('internal');
    expect(normalized.message).toBe('unclassified');
    expect(normalized.cause).toBe(cause);
  });
});
