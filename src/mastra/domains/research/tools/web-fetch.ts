import { createTool } from '@mastra/core/tools';
import { TripWire } from '@mastra/core/agent';
import { z } from 'zod';
import { logger } from '../../../shared/logger';
import { scanToolOutputForInjection } from '../../../shared/processors/security-stack';
import { isFail } from '../../../shared/handlers';
import { WebFetchError } from '../handlers/errors';
import { fetchAndExtract } from '../functions/web-io';

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
      const result = await fetchAndExtract(url, extractMode);
      // This tool's outputSchema has no `reason` field, so the typed failure is
      // re-thrown as the domain error rather than reshaped (hard rule).
      if (isFail(result)) throw result.error;
      const page = result.unwrap();

      // Spec 06 Q3 (DECIDED, option b): scanning boundary at the web-fetch
      // tool-output path — the injected-content gap Scenario 1 documents
      // (PromptInjectionDetector's processInput runs ONCE before the loop, so
      // content fetched during the current run is never rescanned). The
      // extracted text is checked BEFORE it enters the agentic loop as a tool
      // result. Inert without a provider key / with SECURITY_PROCESSORS=off
      // (same inert rule as the injection slot).
      await scanToolOutputForInjection(page.content, url);

      return {
        content: page.content,
        title: page.title,
        wordCount: page.wordCount,
      };
    } catch (error) {
      // A flagged payload (TripWire) must surface intact, not as a fetch error.
      if (error instanceof TripWire) throw error;
      logger.error('Web fetch error:', error);
      // `fetchAndExtract` already types and wraps its own failures — wrapping
      // again would nest the message twice.
      if (error instanceof WebFetchError) throw error;
      throw new WebFetchError(`Failed to fetch URL: ${error}`, { cause: error });
    }
  },
});
