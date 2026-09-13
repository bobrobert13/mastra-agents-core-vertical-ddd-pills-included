/**
 * Tier A gate helpers (shared by tests/evals/gates/*.gates.test.ts).
 *
 * Resolves the §3.2 matrix's OFFLINE entries into fresh scorer instances and
 * exposes a tiny `expectKeylessTierA` guard so these suites document — and
 * test — that they are the always-run, keyless blocking tier (no provider key
 * required, no agent executed; only recorded fixtures + zero-LLM scorers).
 */

import type { MastraScorer } from '@mastra/core/evals';
import {
  AGENT_SCORER_MATRIX,
  buildEvalScorerEntries,
  type ScorerTier,
} from '../../../src/mastra/shared/evals/scorers-registry';
import type { GateScorerEntry, ThresholdConfig } from '../../../src/mastra/shared/evals/gate-runner';

/** Provider-key detector — same hard rule as the integration/live tiers. */
export function hasProviderKey(): boolean {
  return ['DEEPINFRA_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY'].some(
    k => (process.env[k] ?? '').trim() !== ''
  );
}

/** registry id → a fresh MastraScorer instance (built once per module load). */
const instances = new Map<string, MastraScorer<any, any, any, any>>(
  buildEvalScorerEntries().map(e => [e.id, e.scorer])
);
/**
 * The offline (keyless) gate entries for one agent, taken straight from the
 * §3.2 matrix so the gate thresholds and the registration matrix never drift.
 */
export function offlineEntriesFor(agentId: string): GateScorerEntry[] {
  const matrix = AGENT_SCORER_MATRIX[agentId] ?? [];
  return matrix
    .filter(e => e.tier === 'offline')
    .map(e => {
      const scorer = instances.get(e.id);
      if (!scorer) throw new Error(`No offline scorer instance for registry id "${e.id}"`);
      return { scorer, threshold: e.threshold as ThresholdConfig | undefined };
    });
}

/** All fixture-backed agents that have ≥1 offline scorer (Tier A coverage set). */
export function tierAOfflineAgentIds(): string[] {
  return Object.entries(AGENT_SCORER_MATRIX)
    .filter(([, list]) => list.some((e: { tier: ScorerTier }) => e.tier === 'offline'))
    .map(([id]) => id);
}
