import { describe, it, expect } from 'vitest';
import { summarizeText } from '../../../../../src/mastra/domains/research/functions/summarize-text';

describe('summarizeText', () => {
  it('empty (or whitespace-only) text → empty summary and zero summary length', () => {
    expect(summarizeText('', 100)).toEqual({ summary: '', originalLength: 0, summaryLength: 0 });
    expect(summarizeText('   ', 100)).toEqual({ summary: '', originalLength: 3, summaryLength: 0 });
  });

  it('keeps whole sentences that fit; originalLength is the raw text length', () => {
    const text = 'Hello world. Goodbye.';
    const result = summarizeText(text, 100);
    expect(result.summary).toBe('Hello world. Goodbye.');
    expect(result.originalLength).toBe(text.length);
    // summaryLength measures the accumulator BEFORE the final trim (see impl).
    expect(result.summaryLength).toBe(22);
  });

  it('truncates to `maxLength - 3` + "..." when the text overflows', () => {
    const text = 'A'.repeat(500);
    const result = summarizeText(text, 100);
    expect(result.summary).toBe('A'.repeat(97) + '...');
    expect(result.summary.length).toBe(100);
    expect(result.originalLength).toBe(500);
  });

  it('falls back to the first sentence when no full sentence fits', () => {
    const text = 'First sentence is long enough to overflow. Second one too.';
    const result = summarizeText(text, 10);
    expect(result.summary).toBe('First s...');
    expect(result.summaryLength).toBe(10);
  });
});
