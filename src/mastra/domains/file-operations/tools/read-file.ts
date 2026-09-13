import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { resolveWorkspacePath } from '../../../shared/tools/workspace-path';

export const readFileTool = createTool({
  id: 'file-read',
  description:
    'Read content from a file inside the workspace (paths are relative to WORKSPACE_ROOT; out-of-workspace paths are rejected)',
  inputSchema: z.object({
    path: z.string().describe('File path relative to the workspace root'),
    encoding: z.string().optional().default('utf-8'),
  }),
  outputSchema: z.object({
    content: z.string(),
    size: z.number(),
    path: z.string(),
  }),
  // Read stays unapproved but jailed (spec 06 §3.5/§3.6): only MUTATING tools
  // carry requireApproval.
  execute: async ({ path, encoding = 'utf-8' }) => {
    const target = resolveWorkspacePath(path); // jail BEFORE any fs call (§3.6)

    try {
      const content = await readFile(target, encoding as BufferEncoding);
      return {
        content,
        size: content.length,
        path: target,
      };
    } catch (error) {
      throw new Error(`Failed to read file: ${error}`, { cause: error });
    }
  },
});
