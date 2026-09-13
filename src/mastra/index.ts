import { Mastra } from '@mastra/core/mastra';

import { buildInfrastructure } from './shared/config/infrastructure';
import { logServiceAvailability } from './shared/config/service-status';

// Import domains
import { researchAgent, deepResearchWorkflow } from './domains/research';
import { taskManagementAgent } from './domains/task-management';
import { fileOperationsAgent } from './domains/file-operations';
import { communicationAgent } from './domains/communication';

// All infrastructure is optional and driven by env vars (see shared/config/infrastructure.ts)
const { storage, observability, services } = buildInfrastructure();

export const mastra = new Mastra({
  agents: {
    research: researchAgent,
    tasks: taskManagementAgent,
    files: fileOperationsAgent,
    comms: communicationAgent,
  },
  workflows: {
    'deep-research': deepResearchWorkflow,
  },
  storage,
  ...(observability && { observability }),
  server: {
    port: parseInt(process.env.MASTRA_PORT || '4111', 10),
    host: process.env.MASTRA_HOST || '0.0.0.0',
  },
});

logServiceAvailability(services);
