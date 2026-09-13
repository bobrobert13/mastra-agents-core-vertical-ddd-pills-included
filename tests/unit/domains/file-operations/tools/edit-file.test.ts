/** Spec 06 §3.8 — editFileTool: approval gate + jail before any fs call. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editFileTool } from '../../../../../src/mastra/domains/file-operations/tools/edit-file';
import { runTool } from '../../../../../src/mastra/shared/tools/run-tool';

const savedRoot = process.env.WORKSPACE_ROOT;
const savedJail = process.env.FILE_JAIL;
let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'spec06-edit-'));
  root = join(base, 'workspace');
  outside = join(base, 'outside');
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  process.env.WORKSPACE_ROOT = root;
  delete process.env.FILE_JAIL;
});

afterEach(() => {
  if (savedRoot === undefined) delete process.env.WORKSPACE_ROOT;
  else process.env.WORKSPACE_ROOT = savedRoot;
  if (savedJail === undefined) delete process.env.FILE_JAIL;
  else process.env.FILE_JAIL = savedJail;
  rmSync(base, { recursive: true, force: true });
});

describe('editFileTool', () => {
  it('carries requireApproval: true (mutating tool, spec 06 §3.5)', () => {
    expect((editFileTool as unknown as { requireApproval?: boolean }).requireApproval).toBe(true);
  });

  it('edits a file inside the jail and reports replacements', async () => {
    const file = join(root, 'data.txt');
    writeFileSync(file, 'alpha beta alpha');
    const out = await runTool<{ path: string; replacements: number; edited: boolean }>(editFileTool, {
      path: 'data.txt',
      searchText: 'alpha',
      replaceText: 'ALPHA',
    });
    expect(out.replacements).toBe(2);
    expect(out.edited).toBe(true);
    expect(readFileSync(file, 'utf-8')).toBe('ALPHA beta ALPHA');
  });

  it('rejects an escaping path BEFORE reading or writing (no side effects)', async () => {
    const victim = join(outside, 'victim.txt');
    writeFileSync(victim, 'keep me');
    await expect(
      runTool(editFileTool, { path: '../outside/victim.txt', searchText: 'keep', replaceText: 'gone' })
    ).rejects.toThrow(/Path escapes the workspace jail/);
    expect(readFileSync(victim, 'utf-8')).toBe('keep me');
  });

  it('rejects absolute outside paths even when the file exists', async () => {
    const abs = join(outside, 'elsewhere.txt');
    writeFileSync(abs, 'x');
    await expect(
      runTool(editFileTool, { path: abs, searchText: 'x', replaceText: 'y' })
    ).rejects.toThrow(/escapes the workspace jail/);
    expect(existsSync(join(root, abs))).toBe(false);
    expect(readFileSync(abs, 'utf-8')).toBe('x');
  });
});
