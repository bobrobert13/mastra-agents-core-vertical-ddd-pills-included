import { buildDomainAgent, createScopeGuard } from '../../shared/agents/build-agent';
import { buildSecurityStack } from '../../shared/processors/security-stack';
import { askUserTool } from './tools/ask-user';
import { communicationScope } from './scope';
import { communicationSettings } from './config';
import { communicationInstructions } from './instructions';

// Kept for backward compat — structural wiring tests reference these exports
export const communicationScopeGuard = createScopeGuard(communicationScope);
export const communicationSecurityStack = buildSecurityStack({
  scope: communicationScope,
});

export const communicationAgent = buildDomainAgent({
  scope: communicationScope,
  instructionsBody: communicationInstructions,
  tools: { ask_user: askUserTool },
  ...communicationSettings,
});
