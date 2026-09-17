import { DOMAIN_CATALOG, siblingsOf } from '../../shared/agents/domain-catalog';
import type { DomainScope } from '../../shared/processors/scope-guard';

// The catalog is the single source of the agent name + long scope line;
// only the out-of-scope examples and the refusal voice live here. `refusal.tone`
// is how THIS domain phrases a denial — communication speaks warmly because its
// whole job is to make the user feel understood.
const entry = DOMAIN_CATALOG.communication;

export const communicationScope: DomainScope = {
  domain: 'communication',
  agentName: entry.agentName, // from the catalog — one source
  scope: entry.scope,
  outOfScopeExamples: [
    'directly answering domain questions (research, tasks, files)',
    'general-knowledge queries the user expects you to resolve yourself',
    'content creation beyond clarifying questions',
  ],
  siblings: siblingsOf('communication'),
  refusal: { tone: 'warm', maxSentences: 1 },
};
