import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { logger } from '../../../shared/logger';
import { isFail } from '../../../shared/handlers';
import { fetchDuckDuckGo } from '../functions/web-io';
import { mapDuckDuckGoResults } from '../functions/web-parse';

export const webSearchTool = createTool({
  id: 'research-web-search',
  description: 'Search the web for current information using DuckDuckGo',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().optional().default(5).describe('Maximum number of results'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      })
    ),
  }),
  execute: async ({ query, maxResults = 5 }) => {
    try {
      const result = await fetchDuckDuckGo(query);
      if (isFail(result)) throw result.error;
      return { results: mapDuckDuckGoResults(result.unwrap(), maxResults) };
    } catch (error) {
      // Silent degradation (unchanged contract): a failed search is an empty
      // result set, never a thrown error.
      logger.error('Web search error:', error);
      return { results: [] };
    }
  },
});
