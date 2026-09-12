import { describe, it, expect } from 'vitest';
import { resolveModel } from '../../src/mastra/shared/config/model';
import { researchAgent } from '../../src/mastra/domains/research';
import researchDataset from './datasets/research-dataset.json';

describe('Research Agent Evals', () => {
  it('should be defined', () => {
    expect(researchAgent).toBeDefined();
    expect(researchAgent.id).toBe('research-agent');
  });

  it('should process dataset items correctly', () => {
    expect(researchDataset.items).toBeDefined();
    expect(researchDataset.items.length).toBeGreaterThan(0);

    for (const item of researchDataset.items) {
      expect(item.input).toBeDefined();
      expect(item.input.query).toBeDefined();
      expect(item.groundTruth).toBeDefined();
    }
  });

  it('should have correct model', () => {
    expect(researchAgent.model).toBe(resolveModel('research'));
  });
});
