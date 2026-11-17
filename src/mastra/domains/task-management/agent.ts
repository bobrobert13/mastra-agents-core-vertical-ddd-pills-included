// Mastra Agent: https://mastra.ai/docs/agents/overview
import { Agent } from '@mastra/core/agent';
import { buildMemory } from '../../shared/agents/memory';
import { inputProcessors, outputProcessors } from '../../shared/agents/security';
import { agentModel } from '../../shared/config/model';
import { taskManagementInstructions } from './instructions';
import { createTaskTool, scheduleTaskTool, updateTaskTool } from './tools';

export const taskManagementAgent = new Agent({
  id: 'task-management-agent',
  name: 'Task Management Agent',
  description: 'Create, update and schedule tasks.',
  instructions: taskManagementInstructions,
  model: agentModel.tasks(),
  tools: {
    create_task: createTaskTool,
    update_task: updateTaskTool,
    schedule_task: scheduleTaskTool,
  },
  memory: buildMemory(),
  inputProcessors: inputProcessors(),
  outputProcessors: outputProcessors(),
  defaultOptions: { maxSteps: 30, autoResumeSuspendedTools: true },
});
