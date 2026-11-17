// Mastra tools: https://mastra.ai/docs/agents/tools
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { mapDuckDuckGoResults } from '../functions/web-parse';

export async function searchWeb(
  query: string,
  maxResults = 5
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const response = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
  );
  if (!response.ok) {
    throw new Error(`DuckDuckGo API error: ${response.status}`);
  }
  return mapDuckDuckGoResults(await response.json(), maxResults);
}

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
  execute: async ({ query, maxResults = 5 }) => ({
    results: await searchWeb(query, maxResults),
  }),
});
