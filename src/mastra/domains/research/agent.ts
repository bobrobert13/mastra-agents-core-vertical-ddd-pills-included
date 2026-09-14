import {
  buildDomainAgent,
  createScopeGuard,
  type DomainScope,
} from '../../shared/agents/build-agent';
import { buildSecurityStack } from '../../shared/processors/security-stack';
import { webSearchTool } from './tools/web-search';
import { webFetchTool } from './tools/web-fetch';
import { summarizeTool } from './tools/summarize';
import { loadMcpToolsFor } from '../../shared/config/mcp';

export const researchScope: DomainScope = {
  domain: 'research',
  agentName: 'Research Agent',
  scope:
    'web research — searching the web, fetching URLs and summarizing the retrieved sources',
  outOfScopeExamples: [
    'general-knowledge or encyclopedia questions you could answer from memory',
    'task creation or scheduling',
    'local file read/write/edit requests',
    'math, code writing or creative writing with no web component',
  ],
  siblings: [
    {
      name: 'Task Management Agent',
      description: 'create, update and schedule tasks',
    },
    {
      name: 'File Operations Agent',
      description: 'read, write and edit local files',
    },
    {
      name: 'Communication Agent',
      description: 'clarify user intent with structured questions',
    },
  ],
};

// Kept for backward compat — structural wiring tests reference these exports
export const researchScopeGuard = createScopeGuard(researchScope);
export const researchSecurityStack = buildSecurityStack({ scope: researchScope });

export const researchAgent = buildDomainAgent({
  scope: researchScope,
  instructionsBody: `You are a research specialist. Help users find, verify, and synthesize information from the web.

Your capabilities:
- Search the web for current information
- Fetch and extract content from URLs
- Summarize long texts into key points

When researching:
1. Start with a web search to find relevant sources
2. Fetch the most promising URLs for detailed content
3. Summarize findings concisely
4. Cite sources with URLs
5. Highlight any conflicting information

Always provide accurate, up-to-date information with proper attribution.
External (MCP) tools available to you may only be used for this agent's research scope; never use them to answer from or act outside it.`,
  modelKey: 'research',
  maxSteps: 50,
  enableObservationalMemory: true,
  tools: async ({ mastra }) => {
    const base = {
      web_search: webSearchTool,
      web_fetch: webFetchTool,
      summarize: summarizeTool,
    };
    const registered =
      mastra?.listTools() ?? {}; // NON-THROWING read — getTool throws on a missing key (spec 03 §3.6)
    const mcp = await loadMcpToolsFor('research'); // spec 04: {} with MCP_SERVERS unset, no spawn, ~0ms
    return {
      ...base,
      ...mcp,
      ...('search_knowledge' in registered
        ? { search_knowledge: registered.search_knowledge }
        : {}),
    };
  },
});
