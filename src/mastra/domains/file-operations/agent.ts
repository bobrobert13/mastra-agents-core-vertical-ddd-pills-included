// Mastra Agent: https://mastra.ai/docs/agents/overview — Workspace: https://mastra.ai/docs/workspace/overview
import { Agent } from '@mastra/core/agent';
import { buildMemory } from '../../shared/agents/memory';
import { inputProcessors, outputProcessors } from '../../shared/agents/security';
import { agentModel } from '../../shared/config/model';
import { workspace } from '../../workspace';
import { fileOperationsInstructions } from './instructions';

export const fileOperationsAgent = new Agent({
  id: 'file-operations-agent',
  name: 'File Operations Agent',
  description: 'Read, write, edit, list and search files inside the workspace.',
  instructions: fileOperationsInstructions,
  model: agentModel.files(),
  workspace,
  memory: buildMemory(),
  inputProcessors: inputProcessors(),
  outputProcessors: outputProcessors(),
  defaultOptions: { maxSteps: 20, autoResumeSuspendedTools: true },
});
