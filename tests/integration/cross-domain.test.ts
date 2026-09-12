import { describe, it, expect } from 'vitest';
import { eventBus } from '../../src/mastra/shared/events';
import { researchAgent } from '../../src/mastra/domains/research';
import { taskManagementAgent } from '../../src/mastra/domains/task-management';

describe('Cross-Domain Integration', () => {
  it('should allow event communication between domains', async () => {
    const receivedEvents: any[] = [];

    const unsubscribe = eventBus.subscribe('research.completed', event => {
      receivedEvents.push(event);
    });

    await eventBus.publish({
      type: 'research.completed',
      payload: {
        query: 'test',
        sources: ['source1'],
        timestamp: new Date(),
      },
    });

    expect(receivedEvents.length).toBe(1);
    unsubscribe();
  });

  it('should have all agents registered and accessible', () => {
    expect(researchAgent).toBeDefined();
    expect(taskManagementAgent).toBeDefined();
  });

  it('should support multi-domain workflows', async () => {
    // Test that events can flow between domains
    let taskCreated = false;

    eventBus.subscribe('task.created', () => {
      taskCreated = true;
    });

    await eventBus.publish({
      type: 'task.created',
      payload: {
        taskId: 'test-task',
        title: 'Test Task',
        priority: 'medium',
        timestamp: new Date(),
      },
    });

    expect(taskCreated).toBe(true);
  });
});
