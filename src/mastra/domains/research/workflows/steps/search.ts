import { createStep } from '@mastra/core/workflows';
import { webSearchTool } from '../../tools/web-search';
import { runTool } from '../../../../shared/tools/run-tool';
import { deepResearchInputSchema, searchOutputSchema, type WebSearchOutput } from '../schemas';

/**
 * Step 1 — search for relevant sources (`search-sources`).
 * Its output is the `fetch-content` input, unchanged.
 */
export const searchStep = createStep({
  id: 'search-sources',
  inputSchema: deepResearchInputSchema,
  outputSchema: searchOutputSchema,
  execute: async ({ inputData }) => {
    const result = await runTool<WebSearchOutput>(webSearchTool, {
      query: inputData.query,
      maxResults: inputData.maxSources,
    });

    return {
      query: inputData.query,
      sources: result.results,
    };
  },
});
