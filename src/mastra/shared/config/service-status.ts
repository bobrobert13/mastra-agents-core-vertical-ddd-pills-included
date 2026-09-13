import { logger } from '../logger';

/** One line of the startup service-availability report. */
export interface ServiceStatus {
  name: string;
  active: boolean;
  detail: string;
}

/** Status collectors receive this list and push one entry per service. */
export type ServiceRegistry = ServiceStatus[];

export function logServiceAvailability(services: ServiceRegistry): void {
  const lines = services.map(s => `${s.active ? '✅' : '○'} ${s.name.padEnd(16)} ${s.detail}`);

  logger.raw(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Mastra Boilerplate — service availability
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Environment: ${process.env.NODE_ENV || 'development'}
${lines.join('\n')}
Agents: research, tasks, files, comms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}
