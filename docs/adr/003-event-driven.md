# ADR-003: Event-Driven Cross-Domain Communication

## Status
Accepted

## Context
With vertical slicing architecture, domains are isolated and should not directly import from each other. However, some features require cross-domain communication:
- Research domain completes → notify task domain to create a follow-up task
- Task domain completes → notify communication domain to send notification
- File operations complete → notify other domains of changes

We need a mechanism for domains to communicate without creating tight coupling.

## Options Considered

### Option 1: Direct Imports
Domains import and call each other directly

**Pros:**
- Simple to implement
- Synchronous communication
- Easy to debug

**Cons:**
- High coupling (domains depend on each other)
- Circular dependencies possible
- Hard to test domains in isolation
- Violates vertical slicing principles
- Changes in one domain affect others

### Option 2: Shared Service Layer
Create a service layer that orchestrates cross-domain calls

**Pros:**
- Centralized orchestration
- Clear control flow
- Easier to understand than events

**Cons:**
- Service layer becomes a "god object"
- Still creates coupling (services depend on domains)
- Hard to scale
- Single point of failure

### Option 3: Event Bus (Pub/Sub)
Domains publish events, other domains subscribe to events they care about

**Pros:**
- Loose coupling (domains don't know about each other)
- Easy to add new event listeners
- Supports async communication
- Easy to test domains in isolation
- Scales well (can add message queues later)
- Follows DDD principles

**Cons:**
- Asynchronous (harder to debug)
- Event ordering can be complex
- Need to handle event failures
- More complex initial setup

## Decision
We chose **Event Bus (Pub/Sub)** for cross-domain communication.

Implementation:
```typescript
// shared/events/event-bus.ts
class DomainEventBus extends EventEmitter {
  async publish<T>(event: T): Promise<void>
  subscribe<T>(eventType: string, handler: (event: T) => void): () => void
}

export const eventBus = DomainEventBus.getInstance();
```

Usage:
```typescript
// Research domain publishes event
await eventBus.publish({
  type: 'research.completed',
  payload: { query, sources, timestamp }
});

// Task domain subscribes
eventBus.subscribe('research.completed', async (event) => {
  // Create follow-up task
});
```

## Consequences

### Positive
- **Loose coupling**: Domains are independent
- **Extensibility**: Easy to add new event listeners
- **Testability**: Can test domains in isolation
- **Scalability**: Can move to distributed message queue (RabbitMQ, Kafka) later
- **DDD alignment**: Follows domain-driven design principles
- **Flexibility**: Supports both sync and async patterns

### Negative
- **Async complexity**: Harder to trace execution flow
- **Error handling**: Need to handle event processing failures
- **Ordering**: Event ordering can be non-deterministic
- **Debugging**: Harder to debug than direct calls

### Mitigations
- **Observability**: Use Mastra's tracing to track event flow
- **Error handling**: Implement retry logic and dead letter queues
- **Documentation**: Document all events in each domain's `events.ts`
- **Testing**: Test event publishing and subscription separately
- **Idempotency**: Design event handlers to be idempotent

## Event Types

Each domain defines its events:

```typescript
// domains/research/events.ts
export interface ResearchCompletedEvent {
  type: 'research.completed';
  payload: {
    query: string;
    sources: string[];
    timestamp: Date;
  };
}

// domains/task-management/events.ts
export interface TaskCreatedEvent {
  type: 'task.created';
  payload: {
    taskId: string;
    title: string;
    priority: string;
    timestamp: Date;
  };
}
```

## Future Enhancements
- Move to distributed message queue (RabbitMQ/Redis) for production
- Add event sourcing for audit trail
- Implement dead letter queue for failed events
- Add event replay capabilities
