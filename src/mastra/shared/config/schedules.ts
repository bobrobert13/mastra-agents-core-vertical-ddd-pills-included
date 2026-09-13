import type { Mastra } from '@mastra/core/mastra';
import type { ServiceRegistry } from './service-status';

interface ScheduleLike {
  id?: string;
  cron?: string;
  timezone?: string;
}

/**
 * Schedules banner (spec 05 §3.8 / gotcha #11): a workflow declaring `schedule`
 * is auto-promoted to the evented engine, which publicly exposes
 * `getScheduleConfigs()`. Reporting is declarative-only at boot (imperative
 * `mastra.schedules` rows would need an async storage query; the scheduler
 * wakes itself for those).
 */
export function detectSchedules(services: ServiceRegistry, mastra: Mastra): void {
  const workersDisabled = (process.env.MASTRA_WORKERS ?? '').trim().toLowerCase() === 'false';

  const configs = Object.entries(mastra.listWorkflows()).flatMap(([workflowId, workflow]) => {
    const getter = (workflow as { getScheduleConfigs?: () => ScheduleLike[] }).getScheduleConfigs;
    if (typeof getter !== 'function') return [];
    return getter.call(workflow).map(config => ({
      workflowId,
      cron: config.cron ?? '?',
      timezone: config.timezone ?? 'local',
      row:
        config.id && config.id !== workflowId
          ? `wf_${workflowId}__${config.id}`
          : `wf_${workflowId}`,
    }));
  });

  if (configs.length === 0) {
    services.push({
      name: 'Schedules',
      active: false,
      detail: 'none declared — scheduler idle',
    });
    return;
  }

  if (workersDisabled) {
    services.push({
      name: 'Schedules',
      active: false,
      detail: `inactive — MASTRA_WORKERS=false; ${configs.map(c => c.row).join(', ')} will NOT fire (run one scheduler worker, see docs)`,
    });
    return;
  }

  services.push({
    name: 'Schedules',
    active: true,
    detail: configs.map(c => `${c.workflowId} @ ${c.cron} ${c.timezone} (row ${c.row})`).join(', '),
  });
}
