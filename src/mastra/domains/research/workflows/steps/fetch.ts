import { createStep } from '@mastra/core/workflows';
import { webFetchTool } from '../../tools/web-fetch';
import { logger } from '../../../../shared/logger';
import { runTool } from '../../../../shared/tools/run-tool';
import { fetchOutputSchema, searchOutputSchema } from '../schemas';

/** web_fetch tool contract (mirrors its outputSchema). */
interface WebFetchOutput {
  content: string;
  title?: string;
  wordCount: number;
}

/**
 * Step 2 — fetch each source's content (`fetch-content`).
 * A failing fetch is logged and dropped; one bad source never breaks the run.
 */
export const fetchStep = createStep({
  id: 'fetch-content',
  inputSchema: searchOutputSchema,
  outputSchema: fetchOutputSchema,
  execute: async ({ inputData }) => {
    const contents = await Promise.all(
      inputData.sources.map(async source => {
        try {
          const result = await runTool<WebFetchOutput>(webFetchTool, {
            url: source.url,
            extractMode: 'summary',
          });
          return {
            url: source.url,
            title: result.title,
            content: result.content,
            wordCount: result.wordCount,
          };
        } catch (error) {
          logger.error(`Failed to fetch ${source.url}:`, error);
          return null;
        }
      })
    );

    return {
      query: inputData.query,
      contents: contents.filter(c => c !== null),
    };
  },
});
