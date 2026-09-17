import { buildDomainAgent, createScopeGuard } from '../../shared/agents/build-agent';
import { buildSecurityStack } from '../../shared/processors/security-stack';
import { createTaskTool } from './tools/create-task';
import { updateTaskTool } from './tools/update-task';
import { scheduleTaskTool } from './tools/schedule-task';
import { taskManagementScope } from './scope';
import { taskManagementSettings } from './config';
import { taskManagementInstructions } from './instructions';

// Kept for backward compat — structural wiring tests reference these exports
export const taskManagementScopeGuard = createScopeGuard(taskManagementScope);
export const taskManagementSecurityStack = buildSecurityStack({ scope: taskManagementScope });

export const taskManagementAgent = buildDomainAgent({
  scope: taskManagementScope,
  instructionsBody: taskManagementInstructions,
  tools: {
    create_task: createTaskTool,
    update_task: updateTaskTool,
    schedule_task: scheduleTaskTool,
  },
  ...taskManagementSettings,
});
