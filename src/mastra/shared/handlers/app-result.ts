import type { AppError } from './app-error';

/**
 * Result pattern (design pass 2026-09-17).
 *
 * `AppResult` is the general base the domains extend: a domain picks its own
 * `AppError` subclass as `E`, so a failure is a typed VALUE instead of a thrown
 * exception.
 *
 * Instances stay INSIDE the domain — a tool adapts the result to its
 * `outputSchema` before returning, so no class instance ever crosses the
 * Mastra/Zod (or `runTool`) boundary.
 */

export interface AppResultHandlers<T, E, R> {
  ok: (value: T) => R;
  fail: (error: E) => R;
}

export abstract class AppResult<T, E extends AppError = AppError> {
  /** Discriminant: `true` on success, `false` on failure. */
  abstract readonly ok: boolean;

  static ok<V, F extends AppError = AppError>(value: V): AppResult<V, F> {
    return new OkResult<V, F>(value);
  }

  static fail<V, F extends AppError = AppError>(error: F): AppResult<V, F> {
    return new FailResult<V, F>(error);
  }

  isOk(): boolean {
    return this.ok;
  }

  isFail(): boolean {
    return !this.ok;
  }

  /** The success value, or the typed failure thrown. */
  abstract unwrap(): T;

  /** The success value, or `fallback` when this is a failure. */
  abstract unwrapOr(fallback: T): T;

  /** Transform the success value, leaving a failure untouched. */
  abstract map<U>(fn: (value: T) => U): AppResult<U, E>;

  /** Collapse both branches into a single value. */
  abstract match<R>(handlers: AppResultHandlers<T, E, R>): R;
}

export class OkResult<T, E extends AppError = AppError> extends AppResult<T, E> {
  readonly ok = true;
  readonly value: T;

  constructor(value: T) {
    super();
    this.value = value;
  }

  unwrap(): T {
    return this.value;
  }

  unwrapOr(): T {
    return this.value;
  }

  map<U>(fn: (value: T) => U): AppResult<U, E> {
    return AppResult.ok<U, E>(fn(this.value));
  }

  match<R>(handlers: AppResultHandlers<T, E, R>): R {
    return handlers.ok(this.value);
  }
}

export class FailResult<T, E extends AppError = AppError> extends AppResult<T, E> {
  readonly ok = false;
  readonly error: E;

  constructor(error: E) {
    super();
    this.error = error;
  }

  unwrap(): T {
    throw this.error;
  }

  unwrapOr(fallback: T): T {
    return fallback;
  }

  map<U>(_fn: (value: T) => U): AppResult<U, E> {
    return AppResult.fail<U, E>(this.error);
  }

  match<R>(handlers: AppResultHandlers<T, E, R>): R {
    return handlers.fail(this.error);
  }
}

/** Real narrowing — the base `ok` flag alone does not expose `value`. */
export function isOk<T, E extends AppError>(result: AppResult<T, E>): result is OkResult<T, E> {
  return result.ok;
}

/** Real narrowing — the base `ok` flag alone does not expose `error`. */
export function isFail<T, E extends AppError>(result: AppResult<T, E>): result is FailResult<T, E> {
  return !result.ok;
}
