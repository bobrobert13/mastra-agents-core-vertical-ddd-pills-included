import { AppError, toAppError, type AppErrorOptions } from '../../../shared/handlers';

/**
 * Research-domain failures (Phase 3). Every concrete error extends this base,
 * so each one carries `domain: 'research'` plus a stable machine `code`, letting
 * the tool layer adapt a failure without inventing strings.
 */
export abstract class ResearchError extends AppError {
  readonly domain = 'research' as const;
}

/** `fetch()` of a page failed (network error or non-2xx status). */
export class WebFetchError extends ResearchError {
  readonly code = 'WEB_FETCH_FAILED' as const;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { ...options, kind: 'internal' });
  }
}

/** The DuckDuckGo Instant Answer request failed. */
export class WebSearchError extends ResearchError {
  readonly code = 'WEB_SEARCH_FAILED' as const;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { ...options, kind: 'internal' });
  }
}

/** A human reviewer rejected the findings — a decision, not a crash. */
export class ResearchRejectedError extends ResearchError {
  readonly code = 'RESEARCH_REJECTED' as const;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { ...options, kind: 'validation' });
  }
}

/** Anything unforeseen, wrapped so a bare `Error` never crosses the boundary. */
export class UnexpectedResearchError extends ResearchError {
  readonly code = 'RESEARCH_ERROR' as const;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause, kind: 'internal' });
  }
}

/** Normalize an unknown throw into a `ResearchError` (research errors pass through). */
export function toResearchError(error: unknown): ResearchError {
  return toAppError(error, cause => new UnexpectedResearchError(cause));
}
