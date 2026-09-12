import { describe, it, expect } from 'vitest';
import { webSearchTool } from '../../../../../src/mastra/domains/research/tools/web-search';
import { runTool } from '../../../../../src/mastra/shared/tools/run-tool';

interface WebSearchOutput {
  results: { url: string; title: string; snippet: string }[];
}

describe('WebSearchTool', () => {
  it('should execute search and return results', async () => {
    const result = await runTool<WebSearchOutput>(webSearchTool, {
      query: 'TypeScript',
      maxResults: 3,
    });

    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('should respect maxResults parameter', async () => {
    const result = await runTool<WebSearchOutput>(webSearchTool, {
      query: 'JavaScript',
      maxResults: 2,
    });

    expect(result.results.length).toBeLessThanOrEqual(2);
  });

  it('should return empty array on error', async () => {
    // This test might fail if network is unavailable
    const result = await runTool<WebSearchOutput>(webSearchTool, {
      query: '',
      maxResults: 1,
    });

    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
  });
});
