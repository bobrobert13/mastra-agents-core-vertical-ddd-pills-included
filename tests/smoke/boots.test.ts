import { describe, expect, it } from 'vitest';
import { mastra } from '../../src/mastra';

describe('Mastra instance smoke', () => {
  it('boots with zero configuration and registers the native agents', () => {
    expect(Object.keys(mastra.listAgents()).sort()).toEqual(['files', 'research', 'tasks']);
  });

  it('registers the three workflows', () => {
    // Mastra also registers one `<agent>-input-processor` workflow per processor stack.
    const workflows = Object.keys(mastra.listWorkflows())
      .filter(id => !id.endsWith('-input-processor'))
      .sort();
    expect(workflows).toEqual(['daily-digest', 'deep-research', 'index-knowledge']);
  });

  it('has storage configured', () => {
    expect(mastra.getStorage()).toBeDefined();
  });

  it('does not register knowledge tools without an embedder', () => {
    expect(mastra.listTools()).not.toHaveProperty('search_knowledge');
  });
});
