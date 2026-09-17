import { DOMAIN_CATALOG, siblingsOf } from '../../shared/agents/domain-catalog';
import type { DomainScope } from '../../shared/processors/scope-guard';

// El catálogo es la fuente ÚNICA de `agentName`/`scope` (y de los siblings):
// este archivo sólo añade lo específico del dominio. `refusal.tone` es la voz
// de la negativa de ESTE dominio (prevalece sobre SCOPE_GUARD_TONE).
const entry = DOMAIN_CATALOG['task-management'];

export const taskManagementScope: DomainScope = {
  domain: 'task-management',
  agentName: entry.agentName,
  scope: entry.scope,
  outOfScopeExamples: [
    'general-knowledge questions answerable from memory',
    'web research requests',
    'local file read/write/edit operations',
    'actual work execution — you track tasks, you do not perform them',
  ],
  siblings: siblingsOf('task-management'),
  refusal: { tone: 'warm', maxSentences: 1 },
};
