import { describe, it, expect } from 'vitest';
import { resolveModel } from '../../../../src/mastra/shared/config/model';
import { researchAgent } from '../../../../src/mastra/domains/research/agent';

describe('ResearchAgent', () => {
  it('should be defined', () => {
    expect(researchAgent).toBeDefined();
    expect(researchAgent.id).toBe('research-agent');
    expect(researchAgent.name).toBe('Research Agent');
  });

  it('should have correct model', () => {
    expect(researchAgent.model).toBe(resolveModel('research'));
  });
});
