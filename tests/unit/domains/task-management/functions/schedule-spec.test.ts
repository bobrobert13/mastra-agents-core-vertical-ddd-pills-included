import { describe, it, expect } from 'vitest';
import { isFail } from '../../../../../src/mastra/shared/handlers';
import { resolveScheduleSpec } from '../../../../../src/mastra/domains/task-management/functions/schedule-spec';
import { InvalidScheduleError } from '../../../../../src/mastra/domains/task-management/handlers/errors';

describe('resolveScheduleSpec', () => {
  it('folds the nested schedule form over the flat fields', () => {
    const spec = resolveScheduleSpec({
      taskId: 't1',
      cron: '0 1 * * *',
      timezone: 'UTC',
      prompt: 'flat',
      schedule: { cron: '0 9 * * *', timezone: 'Europe/Madrid', prompt: 'nested' },
    }).unwrap();

    expect(spec.cron).toBe('0 9 * * *');
    expect(spec.timezone).toBe('Europe/Madrid');
    expect(spec.prompt).toBe('nested');
  });

  it('maps a back-compat interval to cron when no cron is given', () => {
    expect(resolveScheduleSpec({ taskId: 't1', interval: '1h' }).unwrap().cron).toBe(
      '0 */1 * * *'
    );
  });

  it('fails with InvalidScheduleError when neither cron nor a usable interval is given', () => {
    const result = resolveScheduleSpec({ taskId: 't1', interval: '7x' });
    expect(isFail(result)).toBe(true);
    if (isFail(result)) expect(result.error).toBeInstanceOf(InvalidScheduleError);
  });

  it('defaults enabled to true and honours an explicit false', () => {
    expect(resolveScheduleSpec({ taskId: 't1', cron: '0 9 * * *' }).unwrap().enabled).toBe(true);
    expect(
      resolveScheduleSpec({ taskId: 't1', cron: '0 9 * * *', enabled: false }).unwrap().enabled
    ).toBe(false);
  });
});
