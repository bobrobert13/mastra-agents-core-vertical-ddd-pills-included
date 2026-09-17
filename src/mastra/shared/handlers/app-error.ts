/**
 * Cross-domain error contract (design pass 2026-09-17).
 *
 * `AppError` is the general base every domain extends: a domain error is an
 * `AppError` carrying a machine `code`, the owning `domain` and a semantic
 * `kind`, so the tool layer adapts a failure without inventing strings.
 *
 * Lives in `shared/` because ≥2 domains use it — and nothing in `shared/` may
 * import from `domains/`, so the concrete errors live in each domain's
 * `handlers/errors.ts`.
 */

/** Semantic class of a failure — how a caller adapts it, not an HTTP status. */
export type AppErrorKind = 'validation' | 'not_found' | 'conflict' | 'unavailable' | 'internal';

export interface AppErrorOptions {
  cause?: unknown;
  kind?: AppErrorKind;
  details?: Record<string, unknown>;
}

/** Shape produced by `toJSON()` — safe to log or hand back to a caller. */
export interface AppErrorShape {
  code: string;
  domain: string;
  kind: AppErrorKind;
  message: string;
  details?: Record<string, unknown>;
}

export abstract class AppError extends Error {
  /** Domain-scoped machine code, e.g. `TASK_NOT_FOUND`. */
  abstract readonly code: string;

  /** Owning domain, e.g. `task-management`. */
  abstract readonly domain: string;

  /** Semantic class of the failure. */
  readonly kind: AppErrorKind;

  /** Structured, non-PII context for logs. */
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.kind = options.kind ?? 'internal';
    this.details = options.details;
  }

  toJSON(): AppErrorShape {
    return {
      code: this.code,
      domain: this.domain,
      kind: this.kind,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/** The typed `MastraError` thrown by `requireAppDb` (`shared/config/db.ts`). */
export function isPersistenceUnavailable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'id' in error &&
    (error as { id?: unknown }).id === 'PERSISTENCE_UNAVAILABLE'
  );
}

/**
 * Normalize an unknown throw into the domain's own error type. An `AppError`
 * passes through untouched; anything else is described by the domain-provided
 * fallback factory, so a bare `Error` never crosses a domain boundary.
 */
export function toAppError<T extends AppError>(error: unknown, fallback: (cause: unknown) => T): T {
  if (error instanceof AppError) return error as T;
  return fallback(error);
}
