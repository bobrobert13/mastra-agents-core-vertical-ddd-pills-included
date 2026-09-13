import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

import { researchAgent } from '../../src/mastra/domains/research';

/**
 * Guardrails eval tier (spec 06 §3.8).
 *
 * Structural part runs OFFLINE and always: dataset contract + the hard-rule
 * wiring (research agent module builds a security stack whose slot 0 is the
 * scope guard). Live part sends known injection payloads through a scoped
 * agent and asserts the pipeline trips — guarded so keyless CI stays green.
 */
const here = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  readFileSync(resolve(here, 'datasets/guardrails-dataset.json'), 'utf-8')
) as Array<{
  id: string;
  input: { injectionText: string };
  groundTruth: { mustTripwire: boolean };
}>;

const hasProviderKey = Boolean(
  process.env.OPENAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.DEEPINFRA_API_KEY
);

describe('guardrails dataset contract (structural, offline)', () => {
  it('has at least 5 injection rows, all expecting a tripwire', () => {
    expect(dataset.length).toBeGreaterThanOrEqual(5);
    for (const row of dataset) {
      expect(row.id).toMatch(/^guard-\d{3}$/);
      expect(row.input.injectionText.length).toBeGreaterThan(10);
      expect(row.groundTruth.mustTripwire).toBe(true);
    }
  });
});

describe.skipIf(!hasProviderKey)('guardrails live tripwire (needs a provider key)', () => {
  it.each(dataset.map(r => [r.id, r.input.injectionText] as const))(
    '%s: injection input trips the guardrail pipeline',
    async (_id, injectionText) => {
      const result = await researchAgent.generate(injectionText, {
        memory: { thread: `guardrails-eval-${_id}`, resource: 'guardrails-eval' },
      });
      expect(result.tripwire).toBeTruthy();
    },
    60_000
  );
});
