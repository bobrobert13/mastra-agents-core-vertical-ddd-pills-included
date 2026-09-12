import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eventBus } from '../../../src/mastra/shared/events/event-bus';

describe('EventBus', () => {
  beforeEach(() => {
    eventBus.clearListeners();
  });

  afterEach(() => {
    eventBus.clearListeners();
  });

  it('should publish and subscribe to events', async () => {
    const receivedEvents: any[] = [];

    eventBus.subscribe('test.event', event => {
      receivedEvents.push(event);
    });

    await eventBus.publish({
      type: 'test.event',
      payload: { data: 'test' },
    });

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].payload.data).toBe('test');
  });

  it('should support multiple subscribers', async () => {
    let count = 0;

    eventBus.subscribe('multi.event', () => {
      count++;
    });

    eventBus.subscribe('multi.event', () => {
      count++;
    });

    await eventBus.publish({ type: 'multi.event', payload: {} });

    expect(count).toBe(2);
  });

  it('should unsubscribe correctly', async () => {
    let count = 0;

    const unsubscribe = eventBus.subscribe('unsub.event', () => {
      count++;
    });

    await eventBus.publish({ type: 'unsub.event', payload: {} });
    expect(count).toBe(1);

    unsubscribe();

    await eventBus.publish({ type: 'unsub.event', payload: {} });
    expect(count).toBe(1); // Should not increment
  });

  it('should handle async handlers', async () => {
    const results: string[] = [];

    eventBus.subscribe('async.event', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      results.push('async');
    });

    await eventBus.publish({ type: 'async.event', payload: {} });

    // Wait for async handler
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(results).toContain('async');
  });

  it('should throw error if event has no type', async () => {
    await expect(eventBus.publish({ payload: {} } as any)).rejects.toThrow(
      'Event must have a "type" property'
    );
  });
});
