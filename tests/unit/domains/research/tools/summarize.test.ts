import { describe, it, expect } from 'vitest';
import { summarizeTool } from '../../../../../src/mastra/domains/research/tools/summarize';
import { runTool } from '../../../../../src/mastra/shared/tools/run-tool';

interface SummarizeOutput {
  summary: string;
  originalLength: number;
  summaryLength: number;
}

describe('SummarizeTool', () => {
  it('should summarize text', async () => {
    const text =
      'This is a long text. It has multiple sentences. Each sentence provides information. The tool should summarize it.';

    const result = await runTool<SummarizeOutput>(summarizeTool, {
      text,
      maxLength: 50,
    });

    expect(result).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.summary.length).toBeLessThanOrEqual(50);
    expect(result.originalLength).toBe(text.length);
  });

  it('should handle empty text', async () => {
    const result = await runTool<SummarizeOutput>(summarizeTool, {
      text: '',
      maxLength: 100,
    });

    expect(result.summary).toBe('');
    expect(result.originalLength).toBe(0);
    expect(result.summaryLength).toBe(0);
  });

  it('should respect maxLength parameter', async () => {
    const text = 'A'.repeat(500);

    const result = await runTool<SummarizeOutput>(summarizeTool, {
      text,
      maxLength: 100,
    });

    expect(result.summary.length).toBeLessThanOrEqual(100);
  });
});
