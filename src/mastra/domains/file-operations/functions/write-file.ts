import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';

import { resolveWorkspacePath } from '../../../shared/tools/workspace-path';
import { FileWriteError, WorkspaceJailError } from '../handlers/errors';
import {
  fileOperationsFail,
  fileOperationsOk,
  type FileOperationsResult,
} from '../handlers/responses';

export interface WriteFileOutput {
  path: string;
  size: number;
  written: boolean;
}

/** Write a file inside the workspace jail, optionally creating parents. */
export async function writeWorkspaceFile(
  path: string,
  content: string,
  createDirs = true
): Promise<FileOperationsResult<WriteFileOutput>> {
  let target: string;
  try {
    target = resolveWorkspacePath(path);
  } catch {
    return fileOperationsFail(new WorkspaceJailError(path));
  }

  try {
    if (createDirs) {
      await mkdir(dirname(target), { recursive: true });
    }
    await writeFile(target, content, 'utf-8');
    return fileOperationsOk({ path: target, size: content.length, written: true });
  } catch (error) {
    return fileOperationsFail(new FileWriteError(`${error}`, error));
  }
}
