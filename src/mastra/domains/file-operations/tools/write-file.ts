import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

export const writeFileTool = createTool({
  id: 'file-write',
  description: 'Write content to a file',
  inputSchema: z.object({
    path: z.string().describe('File path'),
    content: z.string().describe('Content to write'),
    createDirs: z.boolean().optional().default(true),
  }),
  outputSchema: z.object({
    path: z.string(),
    size: z.number(),
    written: z.boolean(),
  }),
  execute: async ({ path, content, createDirs = true }) => {
    try {
      if (createDirs) {
        await mkdir(dirname(path), { recursive: true });
      }

      await writeFile(path, content, 'utf-8');

      return {
        path,
        size: content.length,
        written: true,
      };
    } catch (error) {
      throw new Error(`Failed to write file: ${error}`, { cause: error });
    }
  },
});
