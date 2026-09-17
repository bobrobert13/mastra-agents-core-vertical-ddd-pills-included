import { describe, it, expect } from 'vitest';

import { AppError } from '../../../../../src/mastra/shared/handlers';
import {
  CommunicationError,
  CommunicationToolError,
  toCommunicationError,
} from '../../../../../src/mastra/domains/communication/handlers/errors';

/**
 * Fase 4 — communication error base (floor template). The slice has no real
 * failure path, so only the base + its generic tool-boundary alias exist.
 */
describe('communication errors', () => {
  it('CommunicationToolError is a CommunicationError / AppError with domain=communication', () => {
    const error = new CommunicationToolError('tool blew up');

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(CommunicationError);
    expect(error.domain).toBe('communication');
    expect(error.code).toBe('COMMUNICATION_TOOL_ERROR');
    expect(error.kind).toBe('internal');
    expect(error.message).toBe('tool blew up');
  });

  it('preserves the underlying cause', () => {
    const cause = new Error('transport down');
    expect(new CommunicationToolError('wrapped', cause).cause).toBe(cause);
  });
});

describe('toCommunicationError', () => {
  it('passes an AppError through untouched', () => {
    const original = new CommunicationToolError('already typed');
    expect(toCommunicationError(original)).toBe(original);
  });

  it('wraps any unknown throw in the tool-boundary alias', () => {
    const cause = new Error('unclassified');
    const normalized = toCommunicationError(cause);

    expect(normalized).toBeInstanceOf(CommunicationError);
    expect(normalized.code).toBe('COMMUNICATION_TOOL_ERROR');
    expect(normalized.kind).toBe('internal');
    expect(normalized.message).toBe('unclassified');
    expect(normalized.cause).toBe(cause);
  });
});
