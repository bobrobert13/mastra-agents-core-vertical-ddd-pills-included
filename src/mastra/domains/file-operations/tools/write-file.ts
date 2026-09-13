import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { resolveWorkspacePath } from '../../../shared/tools/workspace-path';

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
    // Jail BEFORE any fs call (spec 06 §3.6); throws a tool-level error the
    // agent sees as a rejection. The recursive mkdir below also lazily
    // creates WORKSPACE_ROOT on first use.
    const target = resolveWorkspacePath(path);

    try {
      if (createDirs) {
        await mkdir(dirname(target), { recursive: true });
      }

      await writeFile(target, content, 'utf-8');

      return {
        path: target,
        size: content.length,
        written: true,
      };
    } catch (error) {
      throw new Error(`Failed to write file: ${error}`, { cause: error });
    }
  },
});
