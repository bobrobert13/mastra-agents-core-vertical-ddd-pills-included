import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';

export const editFileTool = createTool({
  id: 'file-edit',
  description: 'Edit content in a file by replacing text',
  inputSchema: z.object({
    path: z.string().describe('File path'),
    searchText: z.string().describe('Text to find'),
    replaceText: z.string().describe('Text to replace with'),
  }),
  outputSchema: z.object({
    path: z.string(),
    replacements: z.number(),
    edited: z.boolean(),
  }),
  execute: async ({ path, searchText, replaceText }) => {
    try {
      const content = await readFile(path, 'utf-8');
      const regex = new RegExp(searchText, 'g');
      const matches = content.match(regex);
      const replacements = matches ? matches.length : 0;

      const newContent = content.replace(regex, replaceText);
      await writeFile(path, newContent, 'utf-8');

      return {
        path,
        replacements,
        edited: replacements > 0,
      };
    } catch (error) {
      throw new Error(`Failed to edit file: ${error}`, { cause: error });
    }
  },
});
