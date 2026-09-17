import type { DomainAgentSettings } from '../../shared/agents/build-agent';

/** Knobs del agente, visibles de un vistazo. RAG es opt-in: añade `rag: true` a `connectors`. */
export const fileOperationsSettings: DomainAgentSettings = {
  modelKey: 'files',
  maxSteps: 20,
  connectors: { memory: 'basic' },
  disableResponseCache: true, // agente mutador: un hit de caché replicaría tool calls (spec 06 R2)
};
