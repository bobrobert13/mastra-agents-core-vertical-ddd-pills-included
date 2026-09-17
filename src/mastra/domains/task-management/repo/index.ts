/**
 * Barrel for the task repository. Keeps the historic `.../task-management/repo`
 * import path resolving to the directory index — the public surface is exactly
 * what `repo.ts` exported before the split.
 */
export { createTaskRepository } from './task-repository';
export type {
  CreateTaskInput,
  ListTasksFilter,
  TaskRepository,
  UpdateTaskPatch,
} from './types';
