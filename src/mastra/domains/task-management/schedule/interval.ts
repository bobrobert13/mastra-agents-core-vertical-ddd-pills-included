import { TASK_INTERVAL_RE } from '../config';

/**
 * Back-compat interval → cron mapping used by `schedule_task` (spec 05 §3.4).
 * Pure and side-effect free so it is trivially unit-testable.
 */
export function intervalToCron(interval: string): string | null {
  const match = TASK_INTERVAL_RE.exec(interval.trim());
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n <= 0) return null;
  switch (match[2]) {
    case 'm':
      return `*/${n} * * * *`;
    case 'h':
      return `0 */${n} * * *`;
    case 'd':
      return `0 0 */${n} * * *`;
    default:
      return null;
  }
}
