import { readFile } from 'fs/promises';

import { resolveWorkspacePath } from '../../../shared/tools/workspace-path';
import { FileReadError, WorkspaceJailError } from '../handlers/errors';
import {
  fileOperationsFail,
  fileOperationsOk,
  type FileOperationsResult,
} from '../handlers/responses';

export interface ReadFileOutput {
  content: string;
  size: number;
  path: string;
}

/** Read a file inside the workspace jail; the jail runs BEFORE any fs call. */
export async function readWorkspaceFile(
  path: string,
  encoding: BufferEncoding = 'utf-8'
): Promise<FileOperationsResult<ReadFileOutput>> {
  let target: string;
  try {
    target = resolveWorkspacePath(path); // jail BEFORE any fs call (§3.6)
  } catch {
    return fileOperationsFail(new WorkspaceJailError(path));
  }

  try {
    const content = await readFile(target, encoding);
    return fileOperationsOk({ content, size: content.length, path: target });
  } catch (error) {
    return fileOperationsFail(new FileReadError(`${error}`, error));
  }
}
