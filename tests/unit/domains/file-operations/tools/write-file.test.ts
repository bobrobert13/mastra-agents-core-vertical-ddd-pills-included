/**
 * Spec 06 §3.8 — first-ever unit tests for the file-operations domain
 * (root AGENTS.md noted none existed). Temp-dir WORKSPACE_ROOT only, no
 * real-FS assumptions. Also covers shared/tools/workspace-path.ts jail
 * semantics through the tool surface (traversal, absolute escape, symlink
 * via realpath, FILE_JAIL=off escape hatch).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileTool } from '../../../../../src/mastra/domains/file-operations/tools/write-file';
import { runTool } from '../../../../../src/mastra/shared/tools/run-tool';

const savedRoot = process.env.WORKSPACE_ROOT;
const savedJail = process.env.FILE_JAIL;
let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'spec06-write-'));
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

describe('writeFileTool — approval gate (spec 06 §3.5)', () => {
  it('carries requireApproval: true (assertable on the tool instance)', () => {
    expect((writeFileTool as unknown as { requireApproval?: boolean }).requireApproval).toBe(true);
  });
});

describe('writeFileTool — jail (spec 06 §3.6)', () => {
  it('writes relative paths INSIDE WORKSPACE_ROOT and returns the resolved path', async () => {
    const out = await runTool<{ path: string; size: number; written: boolean }>(writeFileTool, {
      path: 'notes/hello.md',
      content: '# hi',
    });
    expect(out.written).toBe(true);
    expect(out.path).toBe(join(root, 'notes/hello.md'));
    expect(readFileSync(out.path, 'utf-8')).toBe('# hi');
  });

  it('lazily creates the (nested) workspace root on first use', async () => {
    const fresh = join(base, 'never-created', 'ws');
    process.env.WORKSPACE_ROOT = fresh;
    await runTool(writeFileTool, { path: 'a/b/c.txt', content: 'x' });
    expect(existsSync(join(fresh, 'a/b/c.txt'))).toBe(true);
  });

  it('rejects ../ traversal with a tool-level error BEFORE any fs write', async () => {
    await expect(
      runTool(writeFileTool, { path: '../escape.txt', content: 'pwn' })
    ).rejects.toThrow(/Path escapes the workspace jail/);
    expect(existsSync(join(base, 'escape.txt'))).toBe(false); // empty-write guarantee
  });

  it('rejects absolute paths that land outside the root (not rebased)', async () => {
    const target = join(outside, 'passwd-copy.txt');
    await expect(runTool(writeFileTool, { path: target, content: 'pwn' })).rejects.toThrow(
      /escapes the workspace jail/
    );
    expect(existsSync(target)).toBe(false);
  });

  it('rejects symlink escapes: dir symlink pointing outside (realpath re-check)', async () => {
    if (process.platform === 'win32') return; // symlink creation needs privileges on win
    symlinkSync(outside, join(root, 'link'), 'dir');
    await expect(
      runTool(writeFileTool, { path: 'link/secret.txt', content: 'pwn' })
    ).rejects.toThrow(/escapes the workspace jail/);
    expect(existsSync(join(outside, 'secret.txt'))).toBe(false);
  });

  it('rejects writing THROUGH an existing file symlink pointing outside', async () => {
    if (process.platform === 'win32') return;
    const victim = join(outside, 'victim.txt');
    writeFileSync(victim, 'original');
    symlinkSync(victim, join(root, 'notes.txt'), 'file');
    await expect(runTool(writeFileTool, { path: 'notes.txt', content: 'clobbered' })).rejects.toThrow(
      /escapes the workspace jail/
    );
    expect(readFileSync(victim, 'utf-8')).toBe('original');
  });

  it('FILE_JAIL=off is the documented escape hatch (no containment)', async () => {
    process.env.FILE_JAIL = 'off';
    const target = join(outside, 'freewrite.txt');
    const out = await runTool<{ path: string }>(writeFileTool, { path: target, content: 'ok' });
    expect(out.path).toBe(target);
    expect(readFileSync(target, 'utf-8')).toBe('ok');
  });
});
