import type { z } from 'zod';
import type { scheduleTaskInputSchema } from '../schedule/schemas';
import { intervalToCron } from '../schedule/interval';
import { InvalidScheduleError } from '../handlers/errors';
import { taskFail, taskOk, type TaskResult } from '../handlers/responses';

/** Fully-resolved schedule inputs, with the nested form already folded in. */
export interface ResolvedScheduleSpec {
  cron: string;
  timezone?: string;
  prompt?: string;
  enabled: boolean;
}

/**
 * Resolve the flat + grouped schedule fields (nested wins over flat) and map a
 * back-compat interval to cron. Pure: no I/O, no clock, no runtime — the exact
 * spec the tool used to compute inline, now independently testable.
 */
export function resolveScheduleSpec(
  input: z.input<typeof scheduleTaskInputSchema>
): TaskResult<ResolvedScheduleSpec> {
  const spec = input.schedule ?? {};
  const rawCron = spec.cron ?? input.cron;
  const rawInterval = spec.interval ?? input.interval;
  const timezone = spec.timezone ?? input.timezone;
  const prompt = spec.prompt ?? input.prompt;

  const resolvedCron = rawCron ?? (rawInterval ? intervalToCron(rawInterval) : null);
  if (!resolvedCron) {
    return taskFail(
      new InvalidScheduleError('Provide a cron expression or an interval like "15m" / "1h" / "2d".')
    );
  }

  return taskOk({ cron: resolvedCron, timezone, prompt, enabled: input.enabled ?? true });
}
