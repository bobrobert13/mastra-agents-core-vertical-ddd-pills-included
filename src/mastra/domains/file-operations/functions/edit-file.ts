import { readFile, writeFile } from 'fs/promises';

import { resolveWorkspacePath } from '../../../shared/tools/workspace-path';
import { FileEditError, WorkspaceJailError } from '../handlers/errors';
import {
  fileOperationsFail,
  fileOperationsOk,
  type FileOperationsResult,
} from '../handlers/responses';

export interface EditFileOutput {
  path: string;
  replacements: number;
  edited: boolean;
}

/** Replace every `searchText` occurrence inside a workspace-jailed file. */
export async function editWorkspaceFile(
  path: string,
  searchText: string,
  replaceText: string
): Promise<FileOperationsResult<EditFileOutput>> {
  let target: string;
  try {
    target = resolveWorkspacePath(path); // jail BEFORE any fs call (§3.6)
  } catch {
    return fileOperationsFail(new WorkspaceJailError(path));
  }

  try {
    const content = await readFile(target, 'utf-8');
    const regex = new RegExp(searchText, 'g');
    const matches = content.match(regex);
    const replacements = matches ? matches.length : 0;

    const newContent = content.replace(regex, replaceText);
    await writeFile(target, newContent, 'utf-8');

    return fileOperationsOk({ path: target, replacements, edited: replacements > 0 });
  } catch (error) {
    return fileOperationsFail(new FileEditError(`${error}`, error));
  }
}
