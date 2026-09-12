import { describe, it, expect } from 'vitest';
import { createTaskTool } from '../../../../../src/mastra/domains/task-management/tools/create-task';
import { runTool } from '../../../../../src/mastra/shared/tools/run-tool';

interface CreateTaskOutput {
  taskId: string;
  title: string;
  status: string;
  createdAt: string;
}

describe('CreateTaskTool', () => {
  it('should create a task with required fields', async () => {
    const result = await runTool<CreateTaskOutput>(createTaskTool, {
      title: 'Test Task',
    });

    expect(result).toBeDefined();
    expect(result.taskId).toBeDefined();
    expect(result.title).toBe('Test Task');
    expect(result.status).toBe('pending');
    expect(result.createdAt).toBeDefined();
  });

  it('should create a task with all fields', async () => {
    const result = await runTool<CreateTaskOutput>(createTaskTool, {
      title: 'Important Task',
      description: 'This is important',
      priority: 'high',
      dueDate: '2026-12-31',
    });

    expect(result).toBeDefined();
    expect(result.title).toBe('Important Task');
  });

  it('should generate unique task IDs', async () => {
    const result1 = await runTool<CreateTaskOutput>(createTaskTool, { title: 'Task 1' });
    const result2 = await runTool<CreateTaskOutput>(createTaskTool, { title: 'Task 2' });

    expect(result1.taskId).not.toBe(result2.taskId);
  });
});
