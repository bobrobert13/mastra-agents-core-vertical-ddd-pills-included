import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { agentModel, memoryModel } from '../../shared/config/model';
import { webSearchTool } from './tools/web-search';
import { webFetchTool } from './tools/web-fetch';
import { summarizeTool } from './tools/summarize';

export const researchAgent = new Agent({
  id: 'research-agent',
  name: 'Research Agent',
  description: 'Specialized agent for web research and information synthesis',
  instructions: `You are a research specialist. Help users find, verify, and synthesize information from the web.

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

Always provide accurate, up-to-date information with proper attribution.`,
  model: agentModel.research(),
  defaultOptions: {
    maxSteps: 50,
    autoResumeSuspendedTools: true,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
      observationalMemory: {
        model: memoryModel(),
      },
    },
  }),
  tools: {
    web_search: webSearchTool,
    web_fetch: webFetchTool,
    summarize: summarizeTool,
  },
});
