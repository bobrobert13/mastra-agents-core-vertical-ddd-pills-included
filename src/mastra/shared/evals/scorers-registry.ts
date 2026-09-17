/**
 * Eval scorer registry (spec 07 §3.2).
 *
 * ONE composition point that builds every scorer used by the evals tiers and
 * exposes them in the two shapes the framework needs:
 *
 *  1. `evalScorers` — the record to spread into `new Mastra({ scorers })`
 *     (wiring done by the integration wave in `src/mastra/index.ts` — see
 *     .artifacts/integration-brief-07.md). The MAP KEYS are the IDs that
 *     `startExperiment({ scorers: ['answer-relevancy', …] })` resolves and
 *     that Studio's Run Experiment picker lists (verified: lookup is by key,
 *     not by `scorer.id`).
 *  2. `AGENT_SCORER_MATRIX` — which agent gets which scorers (the §3.2
 *     table), consumed by the per-agent agent-level `scorers:` wiring and by
 *     the Tier A gate suites.
 *
 * Tier labels are load-bearing: `offline` scorers are model-free and run in
 * keyless CI against recorded fixtures (Tier A); `online` ones are LLM judges
 * that ONLY exist behind `describe.skipIf(!hasProviderKey())` / evals-live.yml
 * (Tier B). Judge models come from `judgeModel()` — never hard-coded
 * (gotcha #5).
 */

import type { MastraScorer, ScoringSamplingConfig } from '@mastra/core/evals';
import {
  createAnswerRelevancyScorer,
  createBiasScorer,
  createCompletenessScorer,
  createFaithfulnessScorer,
  createHallucinationScorer,
  createKeywordCoverageScorer,
  createToneScorer,
} from '@mastra/evals/scorers/prebuilt';
import { judgeModel } from '../config/model';
import { researchRelevanceScorer } from './research-relevance-scorer';

export type ScorerTier = 'online' | 'offline';

/** Registry keys — exactly the IDs stored on dataset `scorerIds` (§3.1/§3.2). */
export const EVAL_SCORER_IDS = {
  answerRelevancy: 'answer-relevancy',
  faithfulness: 'faithfulness',
  hallucination: 'hallucination',
  bias: 'bias',
  completeness: 'completeness-scorer',
  tone: 'tone-scorer',
  keywordCoverage: 'keyword-coverage',
  researchRelevance: 'research-relevance',
} as const;

export interface RegistryScorer {
  id: string;
  tier: ScorerTier;
  scorer: MastraScorer;
}

/** Fresh instances of every registered scorer, with §3.2 tier metadata. */
export function buildEvalScorerEntries(): RegistryScorer[] {
  // LLM judges: model resolved from EVAL_JUDGE_MODEL > MODEL > DEFAULT_MODEL
  // (judgeModel() is only READ here; no network call happens at construction).
  const model = judgeModel();
  return [
    {
      id: EVAL_SCORER_IDS.answerRelevancy,
      tier: 'online',
      scorer: createAnswerRelevancyScorer({ model }),
    },
    {
      id: EVAL_SCORER_IDS.faithfulness,
      tier: 'online',
      scorer: createFaithfulnessScorer({ model }),
    },
    {
      id: EVAL_SCORER_IDS.hallucination,
      tier: 'online',
      scorer: createHallucinationScorer({ model }),
    },
    { id: EVAL_SCORER_IDS.bias, tier: 'online', scorer: createBiasScorer({ model }) },
    { id: EVAL_SCORER_IDS.completeness, tier: 'offline', scorer: createCompletenessScorer() },
    { id: EVAL_SCORER_IDS.tone, tier: 'offline', scorer: createToneScorer() },
    { id: EVAL_SCORER_IDS.keywordCoverage, tier: 'offline', scorer: createKeywordCoverageScorer() },
    { id: EVAL_SCORER_IDS.researchRelevance, tier: 'offline', scorer: researchRelevanceScorer },
  ];
}

/** Record for `new Mastra({ scorers: evalScorers })` — keys are the IDs. */
export function buildEvalScorers(): Record<string, MastraScorer> {
  return Object.fromEntries(buildEvalScorerEntries().map(e => [e.id, e.scorer]));
}

/**
 * §3.2 matrix: agent targetId → registered scorer keys, tiered. Gate-only
 * entries (checks.*) live in `AGENT_GATE_SPECS` because they are constructed
 * per expectation, not registered globally.
 * context-precision/relevance/recall are DEFERRED to spec 03 (vectors/RAG).
 */
export const AGENT_SCORER_MATRIX: Record<
  string,
  Array<{ id: string; tier: ScorerTier; threshold?: number | { min?: number; max?: number } }>
> = {
  'research-agent': [
    { id: 'answer-relevancy', tier: 'online' },
    { id: 'faithfulness', tier: 'online' },
    // high score IS bad → max form (verified ThresholdConfig)
    { id: 'hallucination', tier: 'online', threshold: { max: 0.3 } },
    { id: 'completeness-scorer', tier: 'offline', threshold: { min: 0.5 } },
    { id: 'keyword-coverage', tier: 'offline', threshold: 0.5 },
    { id: 'research-relevance', tier: 'offline', threshold: { min: 0.45 } },
  ],
  'task-management-agent': [
    { id: 'completeness-scorer', tier: 'offline', threshold: { min: 0.5 } },
    { id: 'keyword-coverage', tier: 'offline', threshold: { min: 0.5 } },
    // gates checks.calledTool('create_task') / checks.noToolErrors() are
    // ONLINE-ONLY (they read live tool runs) — see AGENT_GATE_SPECS
  ],
  'file-operations-agent': [
    { id: 'hallucination', tier: 'online', threshold: { max: 0.2 } }, // gotcha #7 agent
    { id: 'keyword-coverage', tier: 'offline', threshold: { min: 0.5 } },
    // gates checks.didNotCall / checks.toolOrder → AGENT_GATE_SPECS
  ],
  'communication-agent': [
    { id: 'tone-scorer', tier: 'offline', threshold: { min: 0.6 } },
    { id: 'bias', tier: 'online', threshold: { max: 0.3 } },
    { id: 'keyword-coverage', tier: 'offline', threshold: { min: 0.45 } },
  ],
};

/**
 * Live-run gate specs per agent (zero-LLM `checks.*`, but they read the LIVE
 * tool run → online-only; Tier A never executes agents, so gates run there
 * only inside skipIf(hasProviderKey) describes). `tool`/`order` entries are
 * parameterized per fixture expectation.
 */
export type AgentGateSpec =
  | { kind: 'calledTool'; tool: string }
  | { kind: 'didNotCall'; tool: string }
  | { kind: 'noToolErrors' }
  | { kind: 'toolOrder'; fromFixture: true };

export const AGENT_GATE_SPECS: Record<string, AgentGateSpec[]> = {
  'research-agent': [{ kind: 'calledTool', tool: 'web_search' }, { kind: 'noToolErrors' }],
  'task-management-agent': [{ kind: 'calledTool', tool: 'create_task' }, { kind: 'noToolErrors' }],
  'file-operations-agent': [
    { kind: 'didNotCall', tool: 'write_file' },
    { kind: 'toolOrder', fromFixture: true },
  ],
  'communication-agent': [{ kind: 'noToolErrors' }],
};

/** Convenience: the offline subset usable in Tier A keyless gates. */
export function offlineScorerEntries(): RegistryScorer[] {
  return buildEvalScorerEntries().filter(e => e.tier === 'offline');
}

/**
 * Sampling rate for the ONLINE (LLM-judge) scorers on live agent runs.
 *
 * Why this exists: `agentScorersFor` wires the matrix into every `new Agent`,
 * so a live chat turn triggered the judges too — research ran **3 LLM judges per
 * turn**, on top of the answer itself. The judges are an evaluation instrument,
 * not a runtime guardrail: judging every production turn pays full price to
 * re-measure a sample that a fraction of runs already represents.
 *
 * `EVAL_ONLINE_SAMPLING_RATE` (default 0.1 = one in ten runs). Mastra resolves
 * `ratio` by hashing the run's trace id, so the decision is deterministic per
 * run — the same run never flips between judged and unjudged. `1` restores the
 * old behavior; `0` turns the live judges off entirely.
 *
 * The GATES are unaffected: `tests/evals/gates/_helpers.ts` builds its own
 * entries from the matrix, so offline gate coverage stays 100%.
 */
export function onlineSamplingRate(): number {
  const raw = process.env.EVAL_ONLINE_SAMPLING_RATE?.trim();
  if (!raw) return DEFAULT_ONLINE_SAMPLING_RATE;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : DEFAULT_ONLINE_SAMPLING_RATE;
}

export const DEFAULT_ONLINE_SAMPLING_RATE = 0.1;

/**
 * Per-agent `scorers:` record for `new Agent({ ... })` wiring (spec 07 §3.2),
 * keyed by registry ID and built from the matrix — one line per agent.ts:
 *   scorers: agentScorersFor('research-agent'),
 * Live runs emit these scorer scores into storage (Studio per-run views);
 * thresholds are a runEvals/experiment concern and intentionally not part
 * of the agent wiring.
 *
 * The `online` entries carry the sampling above; the `offline` ones are model-free
 * and cost nothing, so they run on every turn.
 */
export function agentScorersFor(agentId: string): Record<
  string,
  { scorer: MastraScorer; sampling?: ScoringSamplingConfig }
> {
  const entries = buildEvalScorerEntries();
  const record: Record<string, { scorer: MastraScorer; sampling?: ScoringSamplingConfig }> = {};
  for (const spec of AGENT_SCORER_MATRIX[agentId] ?? []) {
    const found = entries.find(e => e.id === spec.id);
    if (!found) continue;
    record[spec.id] =
      spec.tier === 'online'
        ? { scorer: found.scorer, sampling: { type: 'ratio', rate: onlineSamplingRate() } }
        : { scorer: found.scorer };
  }
  return record;
}
