export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  scheduleId?: string;
  /** Per-resource isolation column (spec 05); 'default' when unset. Optional on the interface for barrel back-compat. */
  resourceId?: string;
  /** Optimistic-lock counter, bumped on every mutation (Scenario 5). Optional for back-compat. */
  version?: number;
}

export type TaskStatus = 'pending' | 'in-progress' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskSchedule {
  id: string;
  taskId: string;
  interval: string;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
}
