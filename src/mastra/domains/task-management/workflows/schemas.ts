import { z } from 'zod';

/**
 * Shared Zod schemas for the daily-digest workflow (spec 05 §3.5).
 *
 * Extracted so the inter-step shape is declared ONCE: `collect-open-tasks`
 * output is `build-digest` input, and both used to duplicate the same
 * five-field object.
 */

/** Digest window: the date label + the resource being reported on. */
export interface DigestWindow {
  date: string;
  resourceId: string;
}

/** One open-task row as it travels between the two steps. */
export const openTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  dueDate: z.string().nullable(),
});

export type OpenTaskRow = z.infer<typeof openTaskSchema>;

export const collectOpenTasksInputSchema = z.object({
  resourceId: z.string(),
  date: z.string().optional(),
});

/** `collect-open-tasks` output = `build-digest` input. */
export const collectOpenTasksOutputSchema = z.object({
  date: z.string(),
  resourceId: z.string(),
  open: z.array(openTaskSchema),
});

export const buildDigestInputSchema = collectOpenTasksOutputSchema;

export const digestOutputSchema = z.object({
  date: z.string(),
  openCount: z.number(),
  lines: z.array(z.string()),
});

/** Workflow entry point. */
export const dailyDigestInputSchema = z.object({
  resourceId: z.string().default('default'),
  date: z.string().optional(),
});
