import { describe, it, expect } from 'vitest';
import { mastra } from '../../src/mastra';

/**
 * Smoke tier: proves the core promise of the boilerplate — the whole Mastra
 * instance constructs successfully with ZERO env vars (no DB, no API keys)
 * and every example domain is registered. Must stay deterministic and
 * offline: no model calls here (that belongs to the evals tier).
 */
describe('Mastra instance smoke', () => {
  it('boots with zero configuration and registers all domain agents', () => {
    const agents = mastra.listAgents();
    expect(Object.keys(agents).sort()).toEqual(['comms', 'files', 'research', 'tasks']);
  });

  it('exposes each agent through getAgent with identity and model resolved', () => {
    for (const name of ['research', 'tasks', 'files', 'comms'] as const) {
      const agent = mastra.getAgent(name);
      expect(agent, `agent "${name}" missing`).toBeDefined();
      expect(agent.id).toMatch(/-agent$/);
      expect(agent.name).toBeTruthy();
      // Model comes from config/model.ts; a string provider/model-id must exist
      // even with no env vars (built-in default), proving agnostic resolution.
      expect(typeof agent.model).toBe('string');
      expect((agent.model as string).length).toBeGreaterThan(0);
    }
  });

  it('has storage configured (env-optional fallback active)', () => {
    expect(mastra.getStorage()).toBeDefined();
  });
});
