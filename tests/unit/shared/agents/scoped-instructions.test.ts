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

  it('keeps the original capabilities body', () => {
    expect(result).toContain('ORIGINAL CAPABILITIES BODY');
    // body comes after the boundary blocks
    expect(result.indexOf('ORIGINAL CAPABILITIES BODY')).toBeGreaterThan(
      result.indexOf('## Tool-use honesty')
    );
  });
});
