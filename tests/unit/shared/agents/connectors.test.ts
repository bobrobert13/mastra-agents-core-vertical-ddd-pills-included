import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the declarative connectors. No network, no real MCP:
 * `loadMcpToolsFor` is mocked so we can prove whether it is invoked at all
 * (the "no `mcp` ⇒ no spawn" contract) without ever loading `@mastra/mcp`.
 */
const { loadMcpToolsFor } = vi.hoisted(() => ({
  loadMcpToolsFor: vi.fn(async (_key: string) => ({}) as Record<string, unknown>),
}));

vi.mock('../../../../src/mastra/shared/config/mcp', () => ({ loadMcpToolsFor }));

import {
  RAG_TOOL_KEY,
  memoryOptionsFor,
  resolveConnectorTools,
} from '../../../../src/mastra/shared/agents/connectors';

beforeEach(() => {
  loadMcpToolsFor.mockClear();
  loadMcpToolsFor.mockResolvedValue({});
});

describe('resolveConnectorTools', () => {
  it('no connectors ⇒ {} (never throws)', async () => {
    await expect(resolveConnectorTools(undefined, {})).resolves.toEqual({});
  });

  it('rag undefined/false ⇒ nothing wired even when the registry has the tool', async () => {
    const registered = { [RAG_TOOL_KEY]: { id: 'search_knowledge' } };
    const ctx = { mastra: { listTools: () => registered } };

    await expect(resolveConnectorTools({}, ctx)).resolves.toEqual({});
    await expect(resolveConnectorTools({ rag: false }, ctx)).resolves.toEqual({});
  });

  it('rag: true + registry has the key ⇒ includes the SAME tool object', async () => {
    const tool = { id: 'search_knowledge' };
    const ctx = { mastra: { listTools: () => ({ [RAG_TOOL_KEY]: tool }) } };

    const tools = await resolveConnectorTools({ rag: true }, ctx);

    expect(tools).toEqual({ [RAG_TOOL_KEY]: tool });
    expect(tools[RAG_TOOL_KEY]).toBe(tool);
  });

  it('rag: true + registry WITHOUT the key ⇒ {} and does not throw', async () => {
    const ctx = { mastra: { listTools: () => ({ some_other_tool: {} }) } };
    await expect(resolveConnectorTools({ rag: true }, ctx)).resolves.toEqual({});
  });

  it('rag: true + no mastra / no listTools ⇒ {} and does not throw (degradation contract)', async () => {
    await expect(resolveConnectorTools({ rag: true }, {})).resolves.toEqual({});
    await expect(resolveConnectorTools({ rag: true }, { mastra: {} })).resolves.toEqual({});
  });

  it('mcp undefined ⇒ loadMcpToolsFor is never called (no spawn)', async () => {
    await resolveConnectorTools({ rag: true, memory: 'observational' }, {});

    expect(loadMcpToolsFor).not.toHaveBeenCalled();
  });

  it('empty mcp string ⇒ loadMcpToolsFor is never called', async () => {
    await resolveConnectorTools({ mcp: '' }, {});
    expect(loadMcpToolsFor).not.toHaveBeenCalled();
  });

  it('mcp key ⇒ routes through loadMcpToolsFor(key) and merges its tools', async () => {
    loadMcpToolsFor.mockResolvedValueOnce({ wiki_search: { id: 'wiki_search' } });

    const tools = await resolveConnectorTools({ mcp: 'research' }, {});

    expect(loadMcpToolsFor).toHaveBeenCalledWith('research');
    expect(tools).toEqual({ wiki_search: { id: 'wiki_search' } });
  });
});

describe('memoryOptionsFor', () => {
  it("basic ⇒ title only, no observationalMemory", () => {
    const options = memoryOptionsFor('basic');

    expect(options).toEqual({ generateTitle: true });
    expect(options).not.toHaveProperty('observationalMemory');
  });

  it('observational ⇒ adds observationalMemory with a non-empty model string', () => {
    const options = memoryOptionsFor('observational');

    expect(options.generateTitle).toBe(true);
    expect(typeof options.observationalMemory?.model).toBe('string');
    expect(options.observationalMemory.model.length).toBeGreaterThan(0);
  });
});
