import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { summarizeText } from '../functions/summarize-text';

export const summarizeTool = createTool({
  id: 'research-summarize',
  description: 'Summarize text content',
  inputSchema: z.object({
    text: z.string().describe('Text to summarize'),
    maxLength: z.number().optional().default(200).describe('Maximum summary length'),
  }),
  outputSchema: z.object({
    summary: z.string(),
    originalLength: z.number(),
    summaryLength: z.number(),
  }),
  // Thin adapter — the algorithm lives in the pure `summarizeText` function.
  execute: async ({ text, maxLength = 200 }) => summarizeText(text, maxLength),
});
