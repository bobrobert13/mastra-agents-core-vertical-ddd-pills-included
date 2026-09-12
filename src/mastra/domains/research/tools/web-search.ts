import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { logger } from '../../../shared/logger';

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
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
      );

      if (!response.ok) {
        throw new Error(`DuckDuckGo API error: ${response.status}`);
      }

      const data = await response.json();
      const results = [];

      // Add abstract if available
      if (data.Abstract) {
        results.push({
          title: data.Heading || 'Summary',
          url: data.AbstractURL || '',
          snippet: data.Abstract,
        });
      }

      // Add related topics
      if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 60),
              url: topic.FirstURL,
              snippet: topic.Text,
            });
          }
        }
      }

      return {
        results: results.slice(0, maxResults),
      };
    } catch (error) {
      logger.error('Web search error:', error);
      return {
        results: [],
      };
    }
  },
});
