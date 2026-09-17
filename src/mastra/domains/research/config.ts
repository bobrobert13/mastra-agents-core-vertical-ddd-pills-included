import type { DomainAgentSettings } from '../../shared/agents/build-agent';

/** Knobs del agente, visibles de un vistazo. RAG es opt-in: añade `rag: true` a `connectors`. */
export const researchSettings: DomainAgentSettings = {
  modelKey: 'research',
  maxSteps: 50,
  connectors: { memory: 'observational', mcp: 'research' },
};

/** Knobs del workflow `deep-research` (sin literales sueltos dentro de los steps). */
export const deepResearchSettings = {
  /** Tope de caracteres por resumen entregado a `summarize`. */
  summaryMaxLength: 300,
} as const;
