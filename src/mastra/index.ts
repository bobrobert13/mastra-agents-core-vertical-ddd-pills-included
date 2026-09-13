import { Mastra } from '@mastra/core/mastra';

import { buildInfrastructure } from './shared/config/infrastructure';
import { detectSchedules } from './shared/config/schedules';
import { logServiceAvailability } from './shared/config/service-status';

// Import domains
import { researchAgent, deepResearchWorkflow } from './domains/research';
import { taskManagementAgent, dailyDigestWorkflow } from './domains/task-management';
import { fileOperationsAgent } from './domains/file-operations';
import { communicationAgent } from './domains/communication';

// All infrastructure is optional and driven by env vars (see shared/config/infrastructure.ts)
const { storage, observability, pubsub, auth, services } = buildInfrastructure();

// NOTE: the `server` object literal must contain NO local identifiers —
// `mastra dev` statically extracts this literal into a standalone
// .mastra/output/server-config.mjs where locals are out of scope
// (a spread like `...(auth && { auth })` breaks dev boot with
// "auth is not defined"). Attach auth imperatively instead.
const serverConfig: Record<string, unknown> = {
  port: parseInt(process.env.MASTRA_PORT || '4111', 10),
  host: process.env.MASTRA_HOST || '0.0.0.0',
};
if (auth) serverConfig.auth = auth;

export const mastra = new Mastra({
  agents: {
    research: researchAgent,
    tasks: taskManagementAgent,
    files: fileOperationsAgent,
    comms: communicationAgent,
  },
  workflows: {
    'deep-research': deepResearchWorkflow,
    'daily-digest': dailyDigestWorkflow,
  },
  storage,
  ...(observability && { observability }),
  ...(pubsub && { pubsub }),
  server: serverConfig,
});

detectSchedules(services, mastra);
logServiceAvailability(services);
