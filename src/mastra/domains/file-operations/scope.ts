import { DOMAIN_CATALOG, siblingsOf } from '../../shared/agents/domain-catalog';
import type { DomainScope } from '../../shared/processors/scope-guard';

// The catalog is the single source of the agent name + long scope line;
// only the out-of-scope examples and the refusal voice live here. `refusal.tone`
// is how THIS domain phrases a denial — file-operations speaks soberly (formal)
// because it acts on the user's files.
const entry = DOMAIN_CATALOG['file-operations'];

export const fileOperationsScope: DomainScope = {
  domain: 'file-operations',
  agentName: entry.agentName, // from the catalog — one source
  scope: entry.scope,
  outOfScopeExamples: [
    'general-knowledge, historical or religious questions (answer ONLY from files, never from memory)',
    'web research requests',
    'task creation or scheduling',
    'anything that does not involve a concrete local file',
  ],
  siblings: siblingsOf('file-operations'),
  refusal: { tone: 'formal', maxSentences: 1 },
};
