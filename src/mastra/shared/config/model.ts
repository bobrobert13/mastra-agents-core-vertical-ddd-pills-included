// Mastra model routing: https://mastra.ai/docs/models
export type ModelKey = 'research' | 'tasks' | 'files';
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function resolveModel(key: ModelKey): string {
  return env(`MODEL_${key.toUpperCase()}`) ?? env('MODEL') ?? DEFAULT_MODEL;
}

export const agentModel = {
  research: () => resolveModel('research'),
  tasks: () => resolveModel('tasks'),
  files: () => resolveModel('files'),
};
