import type { DomainAgentSettings } from '../../shared/agents/build-agent';

/** Knobs del agente, visibles de un vistazo. RAG es opt-in: añade `rag: true` a `connectors`. */
export const taskManagementSettings: DomainAgentSettings = {
  modelKey: 'tasks',
  maxSteps: 30,
  connectors: { memory: 'observational' },
};

/**
 * Constantes del dominio task-management: única fuente de verdad para el id del
 * agente, el prefijo de los schedule rows, el parser de intervalos y la
 * programación por defecto del digest. Sin lógica — solo valores.
 */

/** Id canónico del agente (`task-management-agent`); los tests lo verifican. */
export const TASK_MANAGEMENT_AGENT_ID = 'task-management-agent';

/** Prefijo del schedule row que crea `schedule_task`; la API lo normaliza a `agent_<slug>`. */
export const TASK_SCHEDULE_ID_PREFIX = 'task-';

/** Intervalo back-compat aceptado por `schedule_task`: `<n>m` | `<n>h` | `<n>d`. */
export const TASK_INTERVAL_RE = /^(\d+)(m|h|d)$/;

/** Cron + timezone de la programación declarativa de `daily-digest` (row `wf_daily-digest`). */
export const DIGEST_SCHEDULE_CRON = '0 9 * * *';
export const DIGEST_SCHEDULE_TIMEZONE = 'UTC';
