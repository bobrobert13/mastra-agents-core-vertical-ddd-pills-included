import type { DomainAgentSettings } from '../../shared/agents/build-agent';

/** Knobs del agente, visibles de un vistazo. RAG es opt-in: añade `rag: true` a `connectors`. */
export const communicationSettings: DomainAgentSettings = {
  modelKey: 'comms',
  maxSteps: 10,
  connectors: { memory: 'basic' },
};
