import { describe, expect, it } from 'vitest';
import { runEvals } from '@mastra/core/evals';
import { checks } from '@mastra/evals/checks';
import { createKeywordCoverageScorer } from '@mastra/evals/scorers/prebuilt';
import { mastra } from '../../src/mastra';

const hasProviderKey = ['DEEPINFRA_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY']
  .some(key => (process.env[key] ?? '').trim() !== '');

describe.skipIf(!hasProviderKey)('task-management evals', () => {
  it('creates a task through the tool', async () => {
    const result = await runEvals({
      data: [{ input: 'Create a high priority task titled "prepare the demo".' }],
      target: mastra.getAgent('tasks'),
      gates: [checks.calledTool('create_task'), checks.noToolErrors()],
      scorers: [{ scorer: createKeywordCoverageScorer(), threshold: 0.5 }],
    });
    expect(result.verdict).toBe('passed');
  }, 120_000);
});
