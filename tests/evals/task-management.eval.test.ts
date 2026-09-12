import { describe, it, expect } from 'vitest';
import { resolveModel } from '../../src/mastra/shared/config/model';
import { taskManagementAgent } from '../../src/mastra/domains/task-management';
import taskDataset from './datasets/task-dataset.json';

describe('Task Management Agent Evals', () => {
  it('should be defined', () => {
    expect(taskManagementAgent).toBeDefined();
    expect(taskManagementAgent.id).toBe('task-management-agent');
  });

  it('should process dataset items correctly', () => {
    expect(taskDataset.items).toBeDefined();
    expect(taskDataset.items.length).toBeGreaterThan(0);

    for (const item of taskDataset.items) {
      expect(item.input).toBeDefined();
      expect(item.input.query).toBeDefined();
      expect(item.groundTruth).toBeDefined();
    }
  });

  it('should have correct model', () => {
    expect(taskManagementAgent.model).toBe(resolveModel('tasks'));
  });
});
