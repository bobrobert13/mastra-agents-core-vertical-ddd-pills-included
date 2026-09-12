import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const askUserTool = createTool({
  id: 'communication-ask-user',
  description: 'Ask the user a question and wait for response',
  inputSchema: z.object({
    question: z.string().describe('Question to ask the user'),
    context: z.string().optional().describe('Additional context'),
  }),
  outputSchema: z.object({
    response: z.string(),
    askedAt: z.string(),
  }),
  execute: async ({ question: _question, context: _context }) => {
    // In a real implementation, this would pause and wait for user input
    // For now, return a placeholder
    return {
      response: 'User response placeholder',
      askedAt: new Date().toISOString(),
    };
  },
});
