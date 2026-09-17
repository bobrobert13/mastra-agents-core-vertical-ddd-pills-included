/**
 * SINGLE SOURCE of the domain table (spec: fase 2a).
 *
 * Today each `domains/*\/agent.ts` repeats the three sibling descriptions
 * (12 duplicated strings measured). This catalog holds them once; domains
 * (and the scope guard) read siblings from here instead of hand-copying.
 *
 * The values are LITERALLY the current ones (copied from the 4 `agent.ts`):
 * `scope` is the long scope line, `description` is the SHORT sibling blurb.
 */

export type DomainId = 'research' | 'task-management' | 'file-operations' | 'communication';

export interface DomainCatalogEntry {
  /** Display name, e.g. 'Research Agent'. */
  agentName: string;
  /** The long scope line shown to the guard/instructions. */
  scope: string;
  /** Short sibling description, e.g. 'web research: search, fetch and summarize sources'. */
  description: string;
}

export const DOMAIN_CATALOG: Record<DomainId, DomainCatalogEntry> = {
  research: {
    agentName: 'Research Agent',
    scope: 'web research — searching the web, fetching URLs and summarizing the retrieved sources',
    description: 'web research: search, fetch and summarize sources',
  },
  'task-management': {
    agentName: 'Task Management Agent',
    scope: 'creating, updating and scheduling tasks the user wants tracked',
    description: 'create, update and schedule tasks',
  },
  'file-operations': {
    agentName: 'File Operations Agent',
    scope: 'local file operations — reading, writing or editing files at paths the user provides',
    description: 'read, write and edit local files',
  },
  communication: {
    agentName: 'Communication Agent',
    scope: 'clarifying user intent through structured questions and restating understanding',
    description: 'clarify user intent with structured questions',
  },
};

/**
 * Stable declaration order. `siblingsOf` follows it (minus the caller), which
 * reproduces the exact sibling order each `domains/*\/agent.ts` uses today.
 */
const DOMAIN_ORDER: DomainId[] = [
  'research',
  'task-management',
  'file-operations',
  'communication',
];

/**
 * The OTHER three domains, in declaration order, in the shape of
 * `DomainScope.siblings` (plain data — no cross-domain imports).
 */
export function siblingsOf(domain: DomainId): Array<{ name: string; description: string }> {
  return DOMAIN_ORDER.filter(id => id !== domain).map(id => ({
    name: DOMAIN_CATALOG[id].agentName,
    description: DOMAIN_CATALOG[id].description,
  }));
}
