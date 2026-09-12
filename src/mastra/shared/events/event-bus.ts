import { EventEmitter } from 'events';

/**
 * Domain Event Bus for cross-domain communication
 * Implements pub/sub pattern for domain events
 */
class DomainEventBus extends EventEmitter {
  private static instance: DomainEventBus;

  private constructor() {
    super();
    this.setMaxListeners(100); // Allow many listeners
  }

  static getInstance(): DomainEventBus {
    if (!DomainEventBus.instance) {
      DomainEventBus.instance = new DomainEventBus();
    }
    return DomainEventBus.instance;
  }

  /**
   * Publish an event to the bus
   */
  async publish<T>(event: T): Promise<void> {
    const eventType = (event as { type?: string }).type;
    if (!eventType) {
      throw new Error('Event must have a "type" property');
    }

    this.emit(eventType, event);
  }

  /**
   * Subscribe to an event type
   */
  subscribe<T>(eventType: string, handler: (event: T) => void | Promise<void>): () => void {
    this.on(eventType, handler);

    // Return unsubscribe function
    return () => {
      this.off(eventType, handler);
    };
  }

  /**
   * Subscribe to an event type once
   */
  subscribeOnce<T>(eventType: string, handler: (event: T) => void | Promise<void>): () => void {
    this.once(eventType, handler);

    return () => {
      this.off(eventType, handler);
    };
  }

  /**
   * Clear all listeners for an event type
   */
  clearListeners(eventType?: string): void {
    if (eventType) {
      this.removeAllListeners(eventType);
    } else {
      this.removeAllListeners();
    }
  }
}

export const eventBus = DomainEventBus.getInstance();
