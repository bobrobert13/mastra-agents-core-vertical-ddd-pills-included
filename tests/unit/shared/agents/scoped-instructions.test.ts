import { describe, it, expect } from 'vitest';
import { scopedInstructions } from '../../../../src/mastra/shared/agents/scoped-instructions';
import type { DomainScope } from '../../../../src/mastra/shared/processors/scope-guard';

const scope: DomainScope = {
  domain: 'demo',
  agentName: 'Demo Agent',
  scope: 'demo operations',
  outOfScopeExamples: ['encyclopedia questions', 'cooking recipes'],
  siblings: [{ name: 'Other Agent', description: 'other work' }],
};

describe('scopedInstructions', () => {
  const result = scopedInstructions(scope, 'ORIGINAL CAPABILITIES BODY');

  it('prepends all four hard-boundary blocks', () => {
    expect(result).toContain('## Scope (hard boundary)');
    expect(result).toContain('## Out of scope');
    expect(result).toContain('## Refusal protocol');
    expect(result).toContain('## Tool-use honesty');
  });

  it('names the agent, its scope and out-of-scope examples', () => {
    expect(result).toContain('Demo Agent');
    expect(result).toContain('demo operations');
    expect(result).toContain('encyclopedia questions');
  });

  it('lists sibling redirects', () => {
    expect(result).toContain('Other Agent: other work');
  });

  it('frames the sibling list as context, not a script to recite (phase 3)', () => {
    expect(result).toContain('never recite this list');
    expect(result).toContain('at most one');
    // the refusal protocol asks for ONE natural sentence, not a paragraph
    expect(result).toContain('ONE short sentence, natural and warm');
    expect(result).toContain('no paragraph, no list');
    expect(result).toContain('name no one');
  });

  it('keeps the original capabilities body', () => {
    expect(result).toContain('ORIGINAL CAPABILITIES BODY');
    // body comes after the boundary blocks
    expect(result.indexOf('ORIGINAL CAPABILITIES BODY')).toBeGreaterThan(
      result.indexOf('## Tool-use honesty')
    );
  });
});
