// Mastra Agent: https://mastra.ai/docs/agents/overview
import { Agent } from '@mastra/core/agent';
import { buildMemory } from '../../shared/agents/memory';
import { inputProcessors, outputProcessors } from '../../shared/agents/security';
import { loadMcpToolsFor } from '../../shared/config/mcp';
import { agentModel } from '../../shared/config/model';
import { researchInstructions } from './instructions';
import { summarizeTool, webFetchTool, webSearchTool } from './tools';

export const researchAgent = new Agent({
  id: 'research-agent',
  name: 'Research Agent',
  description: 'Web research: search, fetch and summarize sources.',
  instructions: researchInstructions,
  model: agentModel.research(),
  tools: async () => ({
    ...(await loadMcpToolsFor('research')),
    web_search: webSearchTool,
    web_fetch: webFetchTool,
    summarize: summarizeTool,
  }),
  memory: buildMemory(),
  inputProcessors: inputProcessors(),
  outputProcessors: outputProcessors(),
  defaultOptions: { maxSteps: 50, autoResumeSuspendedTools: true },
});
