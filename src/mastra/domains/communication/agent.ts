import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { agentModel, memoryModel } from '../../shared/config/model';
import { askUserTool } from './tools/ask-user';

export const communicationAgent = new Agent({
  id: 'communication-agent',
  name: 'Communication Agent',
  description: 'Specialized agent for user communication and clarification',
  instructions: `You are a communication specialist. Help facilitate clear communication between the system and users.

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
  model: agentModel.comms(),
  defaultOptions: {
    maxSteps: 10,
    autoResumeSuspendedTools: true,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
  tools: {
    ask_user: askUserTool,
  },
});
