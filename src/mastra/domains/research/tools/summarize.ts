import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

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
  execute: async ({ text, maxLength = 200 }) => {
    // Simple extractive summarization
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

    if (sentences.length === 0) {
      return {
        summary: '',
        originalLength: text.length,
        summaryLength: 0,
      };
    }

    // Take first few sentences up to maxLength
    let summary = '';
    for (const sentence of sentences) {
      const candidate = summary + sentence.trim() + '. ';
      if (candidate.length <= maxLength) {
        summary = candidate;
      } else {
        break;
      }
    }

    // If no sentences fit, truncate the first one
    if (!summary && sentences.length > 0) {
      summary = sentences[0].trim().substring(0, maxLength - 3) + '...';
    }

    // Ensure summary doesn't exceed maxLength
    if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength - 3) + '...';
    }

    return {
      summary: summary.trim(),
      originalLength: text.length,
      summaryLength: summary.length,
    };
  },
});
