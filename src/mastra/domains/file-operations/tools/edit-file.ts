import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { isFail } from '../../../shared/handlers';
import { editWorkspaceFile } from '../functions';

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
    const result = await editWorkspaceFile(path, searchText, replaceText);
    if (isFail(result)) throw result.error;
    return result.unwrap();
  },
});
