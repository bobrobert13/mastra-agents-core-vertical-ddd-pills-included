import type { DomainAgentSettings } from '../../shared/agents/build-agent';

/** Knobs del agente, visibles de un vistazo. RAG es opt-in: añade `rag: true` a `connectors`. */
export const taskManagementSettings: DomainAgentSettings = {
  modelKey: 'tasks',
  maxSteps: 30,
  connectors: { memory: 'observational' },
};
