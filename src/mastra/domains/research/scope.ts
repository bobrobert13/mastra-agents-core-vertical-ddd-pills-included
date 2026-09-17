import { DOMAIN_CATALOG, siblingsOf } from '../../shared/agents/domain-catalog';
import type { DomainScope } from '../../shared/processors/scope-guard';

// El catálogo es la fuente ÚNICA de `agentName`/`scope` (y de los siblings):
// este archivo sólo añade lo específico del dominio. `refusal.tone` es la voz
// de la negativa de ESTE dominio (prevalece sobre SCOPE_GUARD_TONE).
const entry = DOMAIN_CATALOG.research;

export const researchScope: DomainScope = {
  domain: 'research',
  agentName: entry.agentName,
  scope: entry.scope,
  outOfScopeExamples: [
    'general-knowledge or encyclopedia questions you could answer from memory',
    'task creation or scheduling',
    'local file read/write/edit requests',
    'math, code writing or creative writing with no web component',
  ],
  siblings: siblingsOf('research'),
  refusal: { tone: 'warm', maxSentences: 1 },
};
