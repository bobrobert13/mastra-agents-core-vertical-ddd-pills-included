import { describe, it, expect } from 'vitest';
import {
  AppError,
  isPersistenceUnavailable,
  toAppError,
  type AppErrorOptions,
} from '../../../../src/mastra/shared/handlers/app-error';

/** Minimal concrete error standing in for a domain's `handlers/errors.ts`. */
class TestError extends AppError {
  readonly code = 'TEST_FAILED' as const;
  readonly domain = 'test-domain' as const;

  constructor(message = 'test failure', options: AppErrorOptions = {}) {
    super(message, options);
  }
}

describe('AppError (general error base for domains)', () => {
  it('carries code, domain, kind and message and is still an Error', () => {
    const error = new TestError('boom', { kind: 'conflict' });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('TEST_FAILED');
    expect(error.domain).toBe('test-domain');
    expect(error.kind).toBe('conflict');
    expect(error.message).toBe('boom');
  });

  it('derives `name` from the concrete subclass and defaults kind to internal', () => {
    const error = new TestError();

    expect(error.name).toBe('TestError');
    expect(error.kind).toBe('internal');
  });

  it('preserves `cause` for diagnostics', () => {
    const root = new Error('driver exploded');
    const error = new TestError('wrapped', { cause: root });

    expect(error.cause).toBe(root);
  });

  it('serializes to the documented shape', () => {
    const error = new TestError('boom', { kind: 'not_found' });

    expect(error.toJSON()).toEqual({
      code: 'TEST_FAILED',
      domain: 'test-domain',
      kind: 'not_found',
      message: 'boom',
    });
  });

  it('includes `details` in the serialized shape only when present', () => {
    expect(new TestError('boom').toJSON()).not.toHaveProperty('details');

    const withDetails = new TestError('boom', { details: { taskId: 't-1' } });
    expect(withDetails.toJSON().details).toEqual({ taskId: 't-1' });
  });
});

describe('isPersistenceUnavailable', () => {
  it('detects the typed requireAppDb MastraError', () => {
    expect(isPersistenceUnavailable({ id: 'PERSISTENCE_UNAVAILABLE' })).toBe(true);
  });

  it('rejects unrelated errors and non-objects', () => {
    expect(isPersistenceUnavailable(new Error('nope'))).toBe(false);
    expect(isPersistenceUnavailable({ id: 'TOOL_HAS_NO_EXECUTE' })).toBe(false);
    expect(isPersistenceUnavailable(null)).toBe(false);
    expect(isPersistenceUnavailable('PERSISTENCE_UNAVAILABLE')).toBe(false);
  });
});

describe('toAppError', () => {
  it('passes an AppError through untouched', () => {
    const original = new TestError('already typed');
    expect(toAppError(original, () => new TestError('fallback'))).toBe(original);
  });

  it('describes an unknown throw with the domain fallback factory', () => {
    const normalized = toAppError(
      new Error('raw'),
      cause => new TestError('normalized', { cause })
    );

    expect(normalized).toBeInstanceOf(TestError);
    expect(normalized.message).toBe('normalized');
    expect(normalized.kind).toBe('internal');
    expect((normalized.cause as Error).message).toBe('raw');
  });
});
