import { createTool } from '@mastra/core/tools';
import { TripWire } from '@mastra/core/agent';
import { z } from 'zod';
import { logger } from '../../../shared/logger';
import { scanToolOutputForInjection } from '../../../shared/processors/security-stack';

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

      // Spec 06 Q3 (DECIDED, option b): scanning boundary at the web-fetch
      // tool-output path — the injected-content gap Scenario 1 documents
      // (PromptInjectionDetector's processInput runs ONCE before the loop, so
      // content fetched during the current run is never rescanned). The
      // extracted text is checked BEFORE it enters the agentic loop as a tool
      // result. Inert without a provider key / with SECURITY_PROCESSORS=off
      // (same rule as the stack's slot 2).
      await scanToolOutputForInjection(content, url);

      return {
        content,
        title,
        wordCount: text.split(/\s+/).length,
      };
    } catch (error) {
      // A flagged payload (TripWire) must surface intact, not as a fetch error.
      if (error instanceof TripWire) throw error;
      logger.error('Web fetch error:', error);
      throw new Error(`Failed to fetch URL: ${error}`, { cause: error });
    }
  },
});
