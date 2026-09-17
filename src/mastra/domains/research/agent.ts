import { buildDomainAgent, createScopeGuard } from '../../shared/agents/build-agent';
import { buildSecurityStack } from '../../shared/processors/security-stack';
import { webSearchTool } from './tools/web-search';
import { webFetchTool } from './tools/web-fetch';
import { summarizeTool } from './tools/summarize';
import { researchScope } from './scope';
import { researchSettings } from './config';
import { researchInstructions } from './instructions';

// Kept for backward compat — structural wiring tests reference these exports
export const researchScopeGuard = createScopeGuard(researchScope);
export const researchSecurityStack = buildSecurityStack({ scope: researchScope });

// Static local tools: the MCP (research-routed) tools arrive via `connectors.mcp`
// and `search_knowledge` is NOT wired — `rag: true` opts into it (opt-in contract).
export const researchAgent = buildDomainAgent({
  scope: researchScope,
  instructionsBody: researchInstructions,
  tools: { web_search: webSearchTool, web_fetch: webFetchTool, summarize: summarizeTool },
  ...researchSettings,
});
