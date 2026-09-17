import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { summarizeTool } from '../../tools/summarize';
import { runTool } from '../../../../shared/tools/run-tool';
import { deepResearchSettings } from '../../config';
import { contentsSchema, deepResearchOutputSchema } from '../schemas';

/** summarize tool contract (mirrors its outputSchema). */
interface SummarizeOutput {
  summary: string;
  originalLength: number;
  summaryLength: number;
}

/**
 * Step 3 — summarize every fetched document (`summarize-content`) and combine
 * the per-document summaries into the workflow's public output.
 */
export const summarizeStep = createStep({
  id: 'summarize-content',
  inputSchema: z.object({
    contents: contentsSchema,
  }),
  outputSchema: deepResearchOutputSchema,
  execute: async ({ inputData }) => {
    const summaries = await Promise.all(
      inputData.contents.map(async content => {
        const result = await runTool<SummarizeOutput>(summarizeTool, {
          text: content.content,
          maxLength: deepResearchSettings.summaryMaxLength,
        });
        return {
          url: content.url,
          title: content.title,
          summary: result.summary,
        };
      })
    );

    const combinedSummary = summaries
      .map(s => `**${s.title || s.url}**: ${s.summary}`)
      .join('\n\n');

    return {
      summary: combinedSummary,
      sources: summaries.map(s => s.url),
      totalWords: inputData.contents.reduce((acc, c) => acc + c.wordCount, 0),
    };
  },
});
