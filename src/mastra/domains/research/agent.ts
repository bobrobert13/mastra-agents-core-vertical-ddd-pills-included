import { Agent } from '@mastra/core/agent';
import { agentModel, memoryModel } from '../../shared/config/model';
import { buildDomainMemory } from '../../shared/config/vectors';
import { createScopeGuard, type DomainScope } from '../../shared/processors/scope-guard';
import { scopedInstructions } from '../../shared/agents/scoped-instructions';
import { webSearchTool } from './tools/web-search';
import { webFetchTool } from './tools/web-fetch';
import { summarizeTool } from './tools/summarize';

export const researchScope: DomainScope = {
  domain: 'research',
  agentName: 'Research Agent',
  scope: 'web research — searching the web, fetching URLs and summarizing the retrieved sources',
  outOfScopeExamples: [
    'general-knowledge or encyclopedia questions you could answer from memory',
    'task creation or scheduling',
    'local file read/write/edit requests',
    'math, code writing or creative writing with no web component',
  ],
  siblings: [
    { name: 'Task Management Agent', description: 'create, update and schedule tasks' },
    { name: 'File Operations Agent', description: 'read, write and edit local files' },
    { name: 'Communication Agent', description: 'clarify user intent with structured questions' },
  ],
};

export const researchScopeGuard = createScopeGuard(researchScope);

export const researchAgent = new Agent({
  id: 'research-agent',
  name: 'Research Agent',
  description: 'Specialized agent for web research and information synthesis',
  instructions: scopedInstructions(
    researchScope,
    `You are a research specialist. Help users find, verify, and synthesize information from the web.

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

Always provide accurate, up-to-date information with proper attribution.`
  ),
  model: agentModel.research(),
  defaultOptions: {
    maxSteps: 50,
    autoResumeSuspendedTools: true,
  },
  inputProcessors: [researchScopeGuard],
  memory: buildDomainMemory({
    generateTitle: true,
    observationalMemory: {
      model: memoryModel(),
    },
  }),
  tools: async ({ mastra }) => {
    const base = { web_search: webSearchTool, web_fetch: webFetchTool, summarize: summarizeTool };
    const registered = mastra?.listTools() ?? {}; // NON-THROWING read — getTool throws on a missing key (spec 03 §3.6)
    return 'search_knowledge' in registered
      ? { ...base, search_knowledge: registered.search_knowledge }
      : base;
  },
});
