import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { logger } from '../../../shared/logger';

export const webFetchTool = createTool({
  id: 'research-web-fetch',
  description: 'Fetch and extract content from a URL',
  inputSchema: z.object({
    url: z.string().url().describe('URL to fetch'),
    extractMode: z
      .enum(['full', 'summary'])
      .optional()
      .default('summary')
      .describe('Extraction mode'),
  }),
  outputSchema: z.object({
    content: z.string(),
    title: z.string().optional(),
    wordCount: z.number(),
  }),
  execute: async ({ url, extractMode = 'summary' }) => {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = await response.text();

      // Simple HTML to text conversion
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1] : undefined;

      // For summary mode, take first 1000 characters
      const content = extractMode === 'summary' ? text.substring(0, 1000) : text;

      return {
        content,
        title,
        wordCount: text.split(/\s+/).length,
      };
    } catch (error) {
      logger.error('Web fetch error:', error);
      throw new Error(`Failed to fetch URL: ${error}`, { cause: error });
    }
  },
});
