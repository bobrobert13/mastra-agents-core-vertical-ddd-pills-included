import { describe, expect, it } from 'vitest';
import { runEvals } from '@mastra/core/evals';
import { checks } from '@mastra/evals/checks';
import { createKeywordCoverageScorer } from '@mastra/evals/scorers/prebuilt';
import { mastra } from '../../src/mastra';

const hasProviderKey = ['DEEPINFRA_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY']
  .some(key => (process.env[key] ?? '').trim() !== '');

describe.skipIf(!hasProviderKey)('research evals', () => {
  it('passes the tool and keyword gates', async () => {
    const result = await runEvals({
      data: [{ input: 'Find the latest news about TypeScript 5.7 and cite sources.' }],
      target: mastra.getAgent('research'),
      gates: [checks.calledTool('web_search'), checks.noToolErrors()],
      scorers: [{ scorer: createKeywordCoverageScorer(), threshold: 0.5 }],
    });
    expect(result.verdict).toBe('passed');
  }, 120_000);
});
