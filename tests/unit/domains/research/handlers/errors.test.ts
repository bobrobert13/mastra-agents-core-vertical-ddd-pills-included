import { describe, it, expect } from 'vitest';
import { AppError } from '../../../../../src/mastra/shared/handlers';
import {
  ResearchError,
  WebFetchError,
  WebSearchError,
  ResearchRejectedError,
  UnexpectedResearchError,
  toResearchError,
} from '../../../../../src/mastra/domains/research/handlers/errors';

describe('research handlers — errors', () => {
  it('every concrete error carries domain=research plus its code/kind/name', () => {
    const cases = [
      { error: new WebFetchError('boom'), code: 'WEB_FETCH_FAILED', kind: 'internal' },
      { error: new WebSearchError('boom'), code: 'WEB_SEARCH_FAILED', kind: 'internal' },
      { error: new ResearchRejectedError('no'), code: 'RESEARCH_REJECTED', kind: 'validation' },
      {
        error: new UnexpectedResearchError(new Error('x')),
        code: 'RESEARCH_ERROR',
        kind: 'internal',
      },
    ] as const;

    for (const { error, code, kind } of cases) {
      expect(error).toBeInstanceOf(ResearchError);
      expect(error).toBeInstanceOf(AppError);
      expect(error.domain).toBe('research');
      expect(error.code).toBe(code);
      expect(error.kind).toBe(kind);
      expect(error.name).toBe(error.constructor.name);
    }
  });

  it('toJSON() exposes the safe shape (no cause leak)', () => {
    const error = new WebFetchError('nope', { cause: new Error('root') });
    expect(error.toJSON()).toEqual({
      code: 'WEB_FETCH_FAILED',
      domain: 'research',
      kind: 'internal',
      message: 'nope',
    });
  });

  it('toResearchError returns a ResearchError untouched', () => {
    const original = new WebSearchError('same');
    expect(toResearchError(original)).toBe(original);
  });

  it('toResearchError wraps a non-AppError in UnexpectedResearchError', () => {
    const wrapped = toResearchError(new Error('kaboom'));
    expect(wrapped).toBeInstanceOf(UnexpectedResearchError);
    expect(wrapped.code).toBe('RESEARCH_ERROR');
    expect(wrapped.domain).toBe('research');
    expect(wrapped.cause).toBeInstanceOf(Error);
  });
});
