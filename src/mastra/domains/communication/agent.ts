import {
  buildDomainAgent,
  createScopeGuard,
  type DomainScope,
} from '../../shared/agents/build-agent';
import { buildSecurityStack } from '../../shared/processors/security-stack';
import { askUserTool } from './tools/ask-user';

export const communicationScope: DomainScope = {
  domain: 'communication',
  agentName: 'Communication Agent',
  scope:
    'clarifying user intent through structured questions and restating understanding',
  outOfScopeExamples: [
    'directly answering domain questions (research, tasks, files)',
    'general-knowledge queries the user expects you to resolve yourself',
    'content creation beyond clarifying questions',
  ],
  siblings: [
    {
      name: 'Research Agent',
      description: 'web research: search, fetch and summarize sources',
    },
    {
      name: 'Task Management Agent',
      description: 'create, update and schedule tasks',
    },
    {
      name: 'File Operations Agent',
      description: 'read, write and edit local files',
    },
  ],
};

// Kept for backward compat — structural wiring tests reference these exports
export const communicationScopeGuard = createScopeGuard(communicationScope);
export const communicationSecurityStack = buildSecurityStack({
  scope: communicationScope,
});

export const communicationAgent = buildDomainAgent({
  scope: communicationScope,
  instructionsBody: `You are a communication specialist. Help facilitate clear communication between the system and users.

Your capabilities:
- Ask clarifying questions when needed
- Provide clear explanations
- Confirm understanding

When communicating:
1. Be clear and concise
2. Ask questions when information is missing
3. Confirm understanding before proceeding
4. Use appropriate tone for the context

Always prioritize clear, effective communication.`,
  modelKey: 'comms',
  maxSteps: 10,
  tools: {
    ask_user: askUserTool,
  },
});
