export interface TaskCreatedEvent {
  type: 'task.created';
  payload: {
    taskId: string;
    title: string;
    priority: string;
    timestamp: Date;
  };
}

export interface TaskUpdatedEvent {
  type: 'task.updated';
  payload: {
    taskId: string;
    changes: Record<string, unknown>;
    timestamp: Date;
  };
}

export interface TaskCompletedEvent {
  type: 'task.completed';
  payload: {
    taskId: string;
    completedAt: Date;
  };
}

export interface TaskScheduledEvent {
  type: 'task.scheduled';
  payload: {
    taskId: string;
    scheduleId: string;
    interval: string;
    timestamp: Date;
  };
}

export type TaskEvent =
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | TaskCompletedEvent
  | TaskScheduledEvent;
