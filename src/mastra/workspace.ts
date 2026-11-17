// Mastra Workspace + LocalFilesystem: https://mastra.ai/docs/workspace/overview
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { LocalFilesystem, Workspace, WORKSPACE_TOOLS } from '@mastra/core/workspace';

const basePath = path.resolve(process.env.WORKSPACE_ROOT?.trim() || 'workspace');
mkdirSync(basePath, { recursive: true });

export const workspace = new Workspace({
  filesystem: new LocalFilesystem({ basePath }),
  tools: {
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
      requireApproval: true,
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
      requireApproval: true,
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { requireApproval: true },
    [WORKSPACE_TOOLS.FILESYSTEM.MKDIR]: { requireApproval: true },
  },
});

await workspace.init();
