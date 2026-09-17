import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { isFail } from '../../../shared/handlers';
import { writeWorkspaceFile } from '../functions';

export const writeFileTool = createTool({
  id: 'file-write',
  description:
    'Write content to a file inside the workspace (paths are relative to WORKSPACE_ROOT; out-of-workspace paths are rejected; writes require human approval)',
  inputSchema: z.object({
    path: z.string().describe('File path relative to the workspace root'),
    content: z.string().describe('Content to write'),
    createDirs: z.boolean().optional().default(true),
  }),
  outputSchema: z.object({
    path: z.string(),
    size: z.number(),
    written: z.boolean(),
  }),
  // Spec 06 §3.5: mutating tools are approval-gated by DEFAULT — the pause
  // happens pre-execution, so a declined write provably makes no fs call.
  requireApproval: true,
  execute: async ({ path, content, createDirs = true }) => {
    const result = await writeWorkspaceFile(path, content, createDirs);
    if (isFail(result)) throw result.error;
    return result.unwrap();
  },
});
