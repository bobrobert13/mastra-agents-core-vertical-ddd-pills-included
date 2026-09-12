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
