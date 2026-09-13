import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { resolveWorkspacePath } from '../../../shared/tools/workspace-path';

export const editFileTool = createTool({
  id: 'file-edit',
  description:
    'Edit content in a file by replacing text (paths are relative to WORKSPACE_ROOT; out-of-workspace paths are rejected; edits require human approval)',
  inputSchema: z.object({
    path: z.string().describe('File path relative to the workspace root'),
    searchText: z.string().describe('Text to find'),
    replaceText: z.string().describe('Text to replace with'),
  }),
  outputSchema: z.object({
    path: z.string(),
    replacements: z.number(),
    edited: z.boolean(),
  }),
  // Spec 06 §3.5: approval gate is pre-execution — decline never reads or writes.
  requireApproval: true,
  execute: async ({ path, searchText, replaceText }) => {
    const target = resolveWorkspacePath(path); // jail BEFORE any fs call (§3.6)

    try {
      const content = await readFile(target, 'utf-8');
      const regex = new RegExp(searchText, 'g');
      const matches = content.match(regex);
      const replacements = matches ? matches.length : 0;

      const newContent = content.replace(regex, replaceText);
      await writeFile(target, newContent, 'utf-8');

      return {
        path: target,
        replacements,
        edited: replacements > 0,
      };
    } catch (error) {
      throw new Error(`Failed to edit file: ${error}`, { cause: error });
    }
  },
});
