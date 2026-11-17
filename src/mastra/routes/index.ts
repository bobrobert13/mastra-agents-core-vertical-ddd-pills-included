// Mastra server config: https://mastra.ai/docs/server/overview
import type { ApiRoute, CorsOptions } from '@mastra/core/server';
import { agentChatRoute } from './chat';

export interface ServerSurface {
  cors?: CorsOptions;
  apiRoutes: ApiRoute[];
}

export function parseCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CORS_ORIGIN ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export function buildServerSurface(): ServerSurface {
  const origins = parseCorsOrigins();
  return {
    ...(origins.length > 0 ? { cors: { origin: origins } } : {}),
    apiRoutes: [agentChatRoute],
  };
}
