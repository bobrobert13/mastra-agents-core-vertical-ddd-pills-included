import { createEvent, makeEvent, type DomainEvent, type EventDef } from '../../shared/events';

/**
 * Domain events for the task-management slice.
 * Built with `createEvent` + `makeEvent` to eliminate the repeated
 * `type` / `payload` / `timestamp` boilerplate — each event is a one-liner.
 */

export const taskCreatedEvent: EventDef<'task.created', {
  taskId: string;
  title: string;
  priority: string;
  timestamp: Date;
}> = createEvent('task.created')<{
  taskId: string;
  title: string;
  priority: string;
  timestamp: Date;
}>();

export const taskUpdatedEvent: EventDef<'task.updated', {
  taskId: string;
  changes: Record<string, unknown>;
  timestamp: Date;
}> = createEvent('task.updated')<{
  taskId: string;
  changes: Record<string, unknown>;
  timestamp: Date;
}>();

export const taskCompletedEvent: EventDef<'task.completed', {
  taskId: string;
  completedAt: Date;
}> = createEvent('task.completed')<{
  taskId: string;
  completedAt: Date;
}>();

export const taskScheduledEvent: EventDef<'task.scheduled', {
  taskId: string;
  scheduleId: string;
  interval: string;
  timestamp: Date;
}> = createEvent('task.scheduled')<{
  taskId: string;
  scheduleId: string;
  interval: string;
  timestamp: Date;
}>();

export const tasksDigestReadyEvent: EventDef<'tasks.digest.ready', {
  date: string;
  resourceId: string;
  openCount: number;
  lines: string[];
  timestamp: Date;
}> = createEvent('tasks.digest.ready')<{
  date: string;
  resourceId: string;
  openCount: number;
  lines: string[];
  timestamp: Date;
}>();

// Type aliases for consumers (tests, subscribers)
export type TaskCreatedEvent = DomainEvent<'task.created', {
  taskId: string;
  title: string;
  priority: string;
  timestamp: Date;
}>;
export type TaskUpdatedEvent = DomainEvent<'task.updated', {
  taskId: string;
  changes: Record<string, unknown>;
  timestamp: Date;
}>;
export type TaskCompletedEvent = DomainEvent<'task.completed', {
  taskId: string;
  completedAt: Date;
}>;
export type TaskScheduledEvent = DomainEvent<'task.scheduled', {
  taskId: string;
  scheduleId: string;
  interval: string;
  timestamp: Date;
}>;
export type TasksDigestReadyEvent = DomainEvent<'tasks.digest.ready', {
  date: string;
  resourceId: string;
  openCount: number;
  lines: string[];
  timestamp: Date;
}>;

export type TaskEvent =
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | TaskCompletedEvent
  | TaskScheduledEvent
  | TasksDigestReadyEvent;

export { makeEvent };
