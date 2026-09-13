/** Spec 06 §3.8 — readFileTool: jailed but NOT approval-gated. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileTool } from '../../../../../src/mastra/domains/file-operations/tools/read-file';
import { runTool } from '../../../../../src/mastra/shared/tools/run-tool';

const savedRoot = process.env.WORKSPACE_ROOT;
const savedJail = process.env.FILE_JAIL;
let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'spec06-read-'));
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

describe('readFileTool', () => {
  it('stays UNAPPROVED (only mutating tools gate; spec 06 §3.5)', () => {
    const flag = (readFileTool as unknown as { requireApproval?: boolean }).requireApproval;
    expect(flag === undefined || flag === false).toBe(true);
  });

  it('reads a relative path resolved inside the jail', async () => {
    writeFileSync(join(root, 'memo.txt'), 'inside content');
    const out = await runTool<{ content: string; size: number; path: string }>(readFileTool, {
      path: 'memo.txt',
    });
    expect(out.content).toBe('inside content');
    expect(out.path).toBe(join(root, 'memo.txt'));
  });

  it('rejects traversal to sensitive host files BEFORE the fs read', async () => {
    await expect(runTool(readFileTool, { path: '../../../../etc/passwd' })).rejects.toThrow(
      /Path escapes the workspace jail/
    );
  });

  it('rejects reads THROUGH a symlink pointing outside', async () => {
    if (process.platform === 'win32') return;
    const secret = join(outside, 'secret.txt');
    writeFileSync(secret, 'do not read');
    symlinkSync(secret, join(root, 'innocent.txt'), 'file');
    await expect(runTool(readFileTool, { path: 'innocent.txt' })).rejects.toThrow(
      /escapes the workspace jail/
    );
  });
});
