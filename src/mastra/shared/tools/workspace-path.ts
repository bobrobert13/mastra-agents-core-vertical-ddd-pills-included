/**
 * Workspace-root jail (spec 06 §3.6) — deterministic path containment for
 * every `fs` call made by file tools. Shared because the jail policy is
 * cross-domain-reusable; run-tool.ts is the precedent for shared/tools/.
 *
 * On by default. `FILE_JAIL=off` is the documented escape hatch (loud banner
 * clause via registerSecurityStackStatus) — a jail an approver must toggle per
 * environment isn't a boundary, so approval decisions assume it is ON.
 *
 * WORKSPACE_ROOT resolves against the PROCESS CWD — same quirk as ./mastra.db
 * (dev CWD is src/mastra/public/); production should set an absolute path.
 *
 * Symlink caveat (ADR-009): lexical containment alone is bypassable by a
 * symlink inside the jail pointing out. Mitigated below via realpath on the
 * deepest existing ancestor + re-check. The residual TOCTOU race (an attacker
 * already holding write access INSIDE the jail) is explicitly accepted for the
 * boilerplate and recorded in docs/adr/009.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_WORKSPACE_DIR = 'workspace';

/** True while the jail is enforced (FILE_JAIL unset or not 'off'). */
export function jailEnabled(): boolean {
  return process.env.FILE_JAIL !== 'off';
}

/** The configured jail root, resolved against process CWD (see header). */
export function workspaceRoot(): string {
  const raw = process.env.WORKSPACE_ROOT?.trim();
  return path.resolve(raw || DEFAULT_WORKSPACE_DIR);
}

function escapeError(requested: string): Error {
  return new Error(`Path escapes the workspace jail: ${requested}`);
}

/** Lexical containment test against an already-resolved root. */
function isInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function exists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function realpathSafe(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

/** Deepest existing ancestor of `target` (itself if it exists). */
function deepestExistingAncestor(target: string): string {
  let probe = target;
  while (!exists(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break; // filesystem root — unreachable in practice
    probe = parent;
  }
  return probe;
}

/**
 * Resolve a user/LLM-supplied path INSIDE the workspace jail, throwing a
 * tool-level error before any fs call when it escapes. `write-file` lazily
 * creates the root (mkdir -p of the target dir covers it).
 *
 * - relative paths resolve against WORKSPACE_ROOT
 * - absolute paths that land outside the root are REJECTED (not rebased)
 * - `../` traversal is rejected after lexical resolution
 * - a symlinked component (existing file or ancestor) resolving outside the
 *   real root is rejected
 * - FILE_JAIL=off: plain path.resolve, no containment (banner ⚠)
 */
export function resolveWorkspacePath(requested: string): string {
  if (!jailEnabled()) return path.resolve(requested);

  const root = workspaceRoot();
  const candidate = path.resolve(root, requested); // absolute `requested` still lands in the containment check below

  if (!isInside(candidate, root)) throw escapeError(requested);

  // Symlink mitigation: realpath the deepest existing ancestor of BOTH sides
  // and re-check containment. An existing symlink at the candidate itself
  // (the classic `notes.txt -> /etc/passwd` write-follow) is covered because
  // the candidate is then the deepest existing ancestor.
  const realRoot = realpathSafe(deepestExistingAncestor(root));
  const realCandidate = realpathSafe(deepestExistingAncestor(candidate));
  if (!isInside(realCandidate, realRoot)) throw escapeError(requested);

  return candidate;
}
