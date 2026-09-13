import { Agent } from '@mastra/core/agent';
import { agentModel } from '../../shared/config/model';
import { buildDomainMemory } from '../../shared/config/vectors';
import { createScopeGuard, type DomainScope } from '../../shared/processors/scope-guard';
import { buildSecurityStack } from '../../shared/processors/security-stack';
import { agentScorersFor } from '../../shared/evals';
import { scopedInstructions } from '../../shared/agents/scoped-instructions';
import { askUserTool } from './tools/ask-user';

export const communicationScope: DomainScope = {
  domain: 'communication',
  agentName: 'Communication Agent',
  scope: 'clarifying user intent through structured questions and restating understanding',
  outOfScopeExamples: [
    'directly answering domain questions (research, tasks, files)',
    'general-knowledge queries the user expects you to resolve yourself',
    'content creation beyond clarifying questions',
  ],
  siblings: [
    { name: 'Research Agent', description: 'web research: search, fetch and summarize sources' },
    { name: 'Task Management Agent', description: 'create, update and schedule tasks' },
    { name: 'File Operations Agent', description: 'read, write and edit local files' },
  ],
};

export const communicationScopeGuard = createScopeGuard(communicationScope);
// Spec 06 hard rule: processor arrays come from buildSecurityStack (scope guard is slot 0).
export const communicationSecurityStack = buildSecurityStack({ scope: communicationScope });

export const communicationAgent = new Agent({
  id: 'communication-agent',
  name: 'Communication Agent',
  description: 'Specialized agent for user communication and clarification',
  instructions: scopedInstructions(
    communicationScope,
    `You are a communication specialist. Help facilitate clear communication between the system and users.

Your capabilities:
- Ask clarifying questions when needed
- Provide clear explanations
- Confirm understanding

When communicating:
1. Be clear and concise
2. Ask questions when information is missing
3. Confirm understanding before proceeding
4. Use appropriate tone for the context

Always prioritize clear, effective communication.`
  ),
  model: agentModel.comms(),
  defaultOptions: {
    maxSteps: 10,
    autoResumeSuspendedTools: true,
  },
  inputProcessors: communicationSecurityStack.inputProcessors,
  outputProcessors: communicationSecurityStack.outputProcessors,
  scorers: agentScorersFor('communication-agent'), // spec 07 §3.2 (live-run score emission → Studio; thresholds are runEvals/experiment concerns)
  memory: buildDomainMemory({
    generateTitle: true,
  }),
  tools: {
    ask_user: askUserTool,
  },
});
