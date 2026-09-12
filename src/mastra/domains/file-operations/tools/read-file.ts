import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile } from 'fs/promises';

export const readFileTool = createTool({
  id: 'file-read',
  description: 'Read content from a file',
  inputSchema: z.object({
    path: z.string().describe('File path'),
    encoding: z.string().optional().default('utf-8'),
  }),
  outputSchema: z.object({
    content: z.string(),
    size: z.number(),
    path: z.string(),
  }),
  execute: async ({ path, encoding = 'utf-8' }) => {
    try {
      const content = await readFile(path, encoding as BufferEncoding);
      return {
        content,
        size: content.length,
        path,
      };
    } catch (error) {
      throw new Error(`Failed to read file: ${error}`, { cause: error });
    }
  },
});
