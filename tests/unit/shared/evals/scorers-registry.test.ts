import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_SCORER_MATRIX,
  EVAL_SCORER_IDS,
  agentScorersFor,
  buildEvalScorerEntries,
  buildEvalScorers,
  offlineScorerEntries,
} from '../../../../src/mastra/shared/evals/scorers-registry';
import {
  createToneScorer,
  createCompletenessScorer,
  createKeywordCoverageScorer,
} from '@mastra/evals/scorers/prebuilt';

/**
 * Registry contract tests (spec 07 §3.2). Offline only: constructing the LLM
 * judges merely stores the `judgeModel()` string — no network at build time.
 */

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('scorers-registry — §3.2 registration surface', () => {
  it('registers exactly the matrix IDs under registry keys resolvable by startExperiment', () => {
    const scorers = buildEvalScorers();
    expect(Object.keys(scorers).sort()).toEqual(
      [
        'answer-relevancy',
        'faithfulness',
        'hallucination',
        'bias',
        'completeness-scorer',
        'tone-scorer',
        'keyword-coverage',
        'research-relevance',
      ].sort()
    );
  });

  it('code-based scorer identities match the installed factories (no hard-coded model strings)', () => {
    const byId = Object.fromEntries(buildEvalScorerEntries().map(e => [e.id, e.scorer]));
    expect(byId['completeness-scorer'].id).toBe(createCompletenessScorer().id);
    expect(byId['tone-scorer'].id).toBe(createToneScorer().id);
    expect(byId['keyword-coverage'].id).toBe(createKeywordCoverageScorer().id);
    expect(byId['research-relevance'].id).toBe(EVAL_SCORER_IDS.researchRelevance);
  });

  it('offline tier = the zero-LLM set moved out of the judge tier by §3.2 (completeness, tone, keyword-coverage, research-relevance)', () => {
    expect(offlineScorerEntries().map(e => e.id).sort()).toEqual([
      'completeness-scorer',
      'keyword-coverage',
      'research-relevance',
      'tone-scorer',
    ]);
  });

  it('hallucination/bias thresholds use the `max` form (high score IS bad)', () => {
    const research = AGENT_SCORER_MATRIX['research-agent'];
    expect(research.find(s => s.id === 'hallucination')?.threshold).toEqual({ max: 0.3 });
    const comms = AGENT_SCORER_MATRIX['communication-agent'];
    expect(comms.find(s => s.id === 'bias')?.threshold).toEqual({ max: 0.3 });
    expect(AGENT_SCORER_MATRIX['file-operations-agent'].find(s => s.id === 'hallucination')?.threshold).toEqual({
      max: 0.2,
    });
  });

  it('all four agents have ≥1 offline gateable scorer (Tier A coverage per agent)', () => {
    for (const [agentId, list] of Object.entries(AGENT_SCORER_MATRIX)) {
      expect(list.some(s => s.tier === 'offline'), agentId).toBe(true);
    }
  });

  it('agentScorersFor builds the agent-level `scorers:` record from the matrix (§3.2 wiring helper)', () => {
    const research = agentScorersFor('research-agent');
    expect(Object.keys(research).sort()).toEqual(
      [
        'answer-relevancy',
        'faithfulness',
        'hallucination',
        'completeness-scorer',
        'keyword-coverage',
        'research-relevance',
      ].sort()
    );
    // each entry is a { scorer } pair usable in new Agent({ scorers })
    expect(research['keyword-coverage'].scorer.id).toBe('keyword-coverage-scorer');
    // unknown agent → empty record, never throws (zero-config)
    expect(agentScorersFor('nope-agent')).toEqual({});
  });

  it('judgeModel chain: EVAL_JUDGE_MODEL > MODEL > DEFAULT_MODEL (gotcha #5)', async () => {
    process.env.EVAL_JUDGE_MODEL = 'test/judge-model';
    delete process.env.MODEL;
    const { judgeModel } = await import('../../../../src/mastra/shared/config/model');
    expect(judgeModel()).toBe('test/judge-model');
    delete process.env.EVAL_JUDGE_MODEL;
    process.env.MODEL = 'test/fallback-model';
    expect(judgeModel()).toBe('test/fallback-model');
    delete process.env.MODEL;
    const { DEFAULT_MODEL } = await import('../../../../src/mastra/shared/config/model');
    expect(judgeModel()).toBe(DEFAULT_MODEL);
  });
});
