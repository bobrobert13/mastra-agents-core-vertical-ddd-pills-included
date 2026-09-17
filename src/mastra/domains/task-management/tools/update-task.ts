import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { isFail } from '../../../shared/handlers';
import { executeTaskUpdate, updateTaskInputSchema } from '../functions/update-task';
import { TaskConflictError } from '../handlers/errors';
import { toUpdateFailureReason } from '../handlers/responses';

export const updateTaskTool = createTool({
  id: 'task-update',
  description: 'Update an existing task (guarded write with optimistic locking)',
  inputSchema: updateTaskInputSchema,
  outputSchema: z.object({
    taskId: z.string(),
    updated: z.boolean(),
    reason: z.enum(['NOT_FOUND', 'CONFLICT']).optional(),
    message: z.string(),
    task: z
      .object({
        status: z.string(),
        priority: z.string(),
        version: z.number(),
        updatedAt: z.string(),
      })
      .optional(),
  }),
  execute: async input => {
    const { taskId } = input;
    const result = await executeTaskUpdate(input);

    if (isFail(result)) {
      const error = result.error;
      const reason = toUpdateFailureReason(error);
      // Infrastructure failures (DB down, …) keep propagating instead of
      // masquerading as a NOT_FOUND/CONFLICT business outcome.
      if (reason === undefined) throw error;
      return {
        taskId,
        updated: false,
        reason,
        message: error.message,
        ...(error instanceof TaskConflictError && error.current
          ? {
              task: {
                status: error.current.status,
                priority: error.current.priority,
                version: error.current.version ?? 0,
                updatedAt: error.current.updatedAt.toISOString(),
              },
            }
          : {}),
      };
    }

    const task = result.unwrap();
    return {
      taskId,
      updated: true,
      message: `Task ${taskId} updated successfully (version ${task.version}).`,
      task: {
        status: task.status,
        priority: task.priority,
        version: task.version ?? 0,
        updatedAt: task.updatedAt.toISOString(),
      },
    };
  },
});
