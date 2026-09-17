import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural ratchet for controlled granularity (spec: fase 4).
 *
 * The rule is per DIRECTORY CLASS, not per file: a domain module must stay
 * small enough to read in one go, while `shared/` carries the legacy debt we
 * have not paid down yet. The allowlist can only SHRINK: an entry that no
 * longer exceeds the shared ceiling fails the test, so the debt is visible and
 * monotonically decreasing instead of silently growing.
 *
 * A failing assertion tells you exactly what to do: split the file into
 * one-responsibility modules, or lower/remove its allowlist entry.
 */

const SRC = path.resolve(process.cwd(), 'src/mastra');

/** Hard ceiling for every file under `domains/` — one module, one job. */
const DOMAIN_MAX_LOC = 150;

/** Ceiling for `shared/` (the whole tree is the goal; the allowlist is the debt). */
const SHARED_MAX_LOC = 200;

/**
 * Legacy `shared/` files above the ceiling. Values are the CURRENT size and may
 * only go down (paying the debt down is a separate, reviewable change).
 */
const LEGACY_LARGE: Record<string, number> = {
  'shared/processors/security-stack.ts': 372,
  'shared/config/vectors.ts': 293,
  'shared/config/mcp-parse.ts': 269,
  'shared/evals/gate-runner.ts': 244,
  'shared/processors/scope-guard.ts': 220,
  'shared/evals/scorers-registry.ts': 207,
  'shared/config/env.ts': 202,
};

/** Logical lines: matches `wc -l` for the prettier-formatted files in this repo. */
function locOf(file: string): number {
  const content = readFileSync(file, 'utf8');
  const newlines = content.match(/\n/g)?.length ?? 0;
  return content.endsWith('\n') ? newlines : newlines + 1;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const relOf = (file: string): string => path.relative(SRC, file).split(path.sep).join('/');

/** `src/mastra/domains/**` + `src/mastra/shared/**` only — the two trees the rule governs. */
const governed = (): string[] => [
  ...tsFiles(path.join(SRC, 'domains')),
  ...tsFiles(path.join(SRC, 'shared')),
];

describe('granularidad: techo de tamaño por archivo', () => {
  it(`ningún archivo de domains/ supera ${DOMAIN_MAX_LOC} LOC`, () => {
    const oversized = tsFiles(path.join(SRC, 'domains'))
      .map(file => ({ file: relOf(file), loc: locOf(file) }))
      .filter(({ loc }) => loc > DOMAIN_MAX_LOC)
      .map(({ file, loc }) => `${file}: ${loc} LOC`);

    expect(
      oversized,
      `Archivos de dominio por encima de ${DOMAIN_MAX_LOC} LOC — divide por responsabilidad ` +
        `(agent/scope/config/instructions/steps/repo) en vez de engordar el archivo:\n${oversized.join('\n')}`
    ).toEqual([]);
  });

  it(`todo archivo de shared/ por encima de ${SHARED_MAX_LOC} LOC está declarado en LEGACY_LARGE`, () => {
    const undeclared = tsFiles(path.join(SRC, 'shared'))
      .map(file => ({ file: relOf(file), loc: locOf(file) }))
      .filter(({ file, loc }) => loc > SHARED_MAX_LOC && !(file in LEGACY_LARGE))
      .map(({ file, loc }) => `${file}: ${loc} LOC`);

    expect(
      undeclared,
      `Shared no debería crecer más allá de ${SHARED_MAX_LOC} LOC sin una entrada en LEGACY_LARGE ` +
        `(añadirla requiere justificarlo en el commit):\n${undeclared.join('\n')}`
    ).toEqual([]);
  });

  it('LEGACY_LARGE solo decrece: ninguna entrada puede quedar obsoleta', () => {
    const stale: string[] = [];

    for (const [file, allowed] of Object.entries(LEGACY_LARGE)) {
      const full = path.join(SRC, file);
      let current: number;
      try {
        current = locOf(full);
      } catch {
        stale.push(`${file}: ya no existe — borra su entrada`);
        continue;
      }
      if (current > allowed) {
        stale.push(`${file}: ${current} LOC > ${allowed} permitidas — el ratchet no sube`);
      } else if (current <= SHARED_MAX_LOC) {
        stale.push(`${file}: ${current} LOC ya está por debajo del techo — borra su entrada`);
      }
    }

    expect(stale, `Mantén el ratchet al día:\n${stale.join('\n')}`).toEqual([]);
  });

  it('domains/ nunca se permite con la allowlist (ahí la regla no tiene excepciones)', () => {
    expect(Object.keys(LEGACY_LARGE).some(file => file.startsWith('domains/'))).toBe(false);
    expect(governed().length).toBeGreaterThan(40); // sanity: the walk actually found the source
  });
});
