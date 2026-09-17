import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { isFail } from '../../../shared/handlers';
import { readWorkspaceFile } from '../functions';

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
    const result = await readWorkspaceFile(path, encoding as BufferEncoding);
    // No `reason` field in this outputSchema: the typed failure crosses the
    // boundary as the domain error the agent sees as a rejection.
    if (isFail(result)) throw result.error;
    return result.unwrap();
  },
});
