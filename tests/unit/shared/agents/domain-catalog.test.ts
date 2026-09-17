import { describe, expect, it } from 'vitest';

import {
  DOMAIN_CATALOG,
  siblingsOf,
  type DomainId,
} from '../../../../src/mastra/shared/agents/domain-catalog';

const ALL: DomainId[] = ['research', 'task-management', 'file-operations', 'communication'];

describe('DOMAIN_CATALOG', () => {
  it('exposes the four domains with non-empty agentName/scope/description', () => {
    for (const id of ALL) {
      const entry = DOMAIN_CATALOG[id];
      expect(entry).toBeDefined();
      expect(entry.agentName.length).toBeGreaterThan(0);
      expect(entry.scope.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});

describe('siblingsOf', () => {
  it("research ⇒ the other 3, excluding Research Agent, with today's exact descriptions", () => {
    const siblings = siblingsOf('research');

    expect(siblings).toHaveLength(3);
    expect(siblings.map(s => s.name)).not.toContain('Research Agent');
    // Literals copied verbatim from domains/research/agent.ts
    expect(siblings.map(s => s.description)).toEqual([
      'create, update and schedule tasks',
      'read, write and edit local files',
      'clarify user intent with structured questions',
    ]);
  });

  it('every domain has exactly 3 siblings (and never itself)', () => {
    for (const id of ALL) {
      const siblings = siblingsOf(id);
      expect(siblings).toHaveLength(3);
      expect(siblings.map(s => s.name)).not.toContain(DOMAIN_CATALOG[id].agentName);
    }
  });
});
