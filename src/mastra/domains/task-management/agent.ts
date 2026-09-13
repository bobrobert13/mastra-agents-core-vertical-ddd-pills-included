import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { agentModel, memoryModel } from '../../shared/config/model';
import { createScopeGuard, type DomainScope } from '../../shared/processors/scope-guard';
import { scopedInstructions } from '../../shared/agents/scoped-instructions';
import { createTaskTool } from './tools/create-task';
import { updateTaskTool } from './tools/update-task';
import { scheduleTaskTool } from './tools/schedule-task';

export const taskManagementScope: DomainScope = {
  domain: 'task-management',
  agentName: 'Task Management Agent',
  scope: 'creating, updating and scheduling tasks the user wants tracked',
  outOfScopeExamples: [
    'general-knowledge questions answerable from memory',
    'web research requests',
    'local file read/write/edit operations',
    'actual work execution — you track tasks, you do not perform them',
  ],
  siblings: [
    { name: 'Research Agent', description: 'web research: search, fetch and summarize sources' },
    { name: 'File Operations Agent', description: 'read, write and edit local files' },
    { name: 'Communication Agent', description: 'clarify user intent with structured questions' },
  ],
};

export const taskManagementScopeGuard = createScopeGuard(taskManagementScope);

export const taskManagementAgent = new Agent({
  id: 'task-management-agent',
  name: 'Task Management Agent',
  description: 'Specialized agent for task creation, management, and scheduling',
  instructions: scopedInstructions(
    taskManagementScope,
    `You are a task management specialist. Help users create, organize, and schedule tasks.

Your capabilities:
- Create new tasks with priorities and due dates
- Update existing tasks (status, priority, details)
- Schedule tasks to run at specific intervals

When managing tasks:
1. Understand the user's needs clearly
2. Create tasks with appropriate priorities
3. Set realistic due dates when mentioned
4. Use scheduling for recurring tasks
5. Provide clear confirmation of actions

Always be organized and precise with task details.`
  ),
  model: agentModel.tasks(),
  defaultOptions: {
    maxSteps: 30,
    autoResumeSuspendedTools: true,
  },
  inputProcessors: [taskManagementScopeGuard],
  memory: new Memory({
    options: {
      generateTitle: true,
      observationalMemory: {
        model: memoryModel(),
      },
    },
  }),
  tools: {
    create_task: createTaskTool,
    update_task: updateTaskTool,
    schedule_task: scheduleTaskTool,
  },
});
