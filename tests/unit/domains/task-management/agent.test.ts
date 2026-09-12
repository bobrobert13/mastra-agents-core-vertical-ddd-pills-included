import { describe, it, expect } from 'vitest';
import { resolveModel } from '../../../../src/mastra/shared/config/model';
import { taskManagementAgent } from '../../../../src/mastra/domains/task-management/agent';

describe('TaskManagementAgent', () => {
  it('should be defined', () => {
    expect(taskManagementAgent).toBeDefined();
    expect(taskManagementAgent.id).toBe('task-management-agent');
    expect(taskManagementAgent.name).toBe('Task Management Agent');
  });

  it('should have correct model', () => {
    expect(taskManagementAgent.model).toBe(resolveModel('tasks'));
  });
});
