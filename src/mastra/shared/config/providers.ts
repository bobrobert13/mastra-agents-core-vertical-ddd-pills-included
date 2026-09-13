import type { ServiceRegistry } from './service-status';

const PROVIDER_ENV_KEYS: Array<[displayName: string, envKey: string]> = [
  ['DeepInfra', 'DEEPINFRA_API_KEY'],
  ['OpenAI', 'OPENAI_API_KEY'],
  ['Anthropic', 'ANTHROPIC_API_KEY'],
  ['Google', 'GOOGLE_API_KEY'],
];

/** True when at least one provider API key is configured. */
export function hasAnyProviderKey(): boolean {
  return PROVIDER_ENV_KEYS.some(([, envKey]) => {
    const value = process.env[envKey];
    return value && value.trim() !== '';
  });
}

/** Provider API keys are only detected for the banner — model choice itself
 *  is resolved at agent construction time by config/model.ts. */
export function detectModelProviders(services: ServiceRegistry): void {
  const available = PROVIDER_ENV_KEYS.filter(([, envKey]) => {
    const value = process.env[envKey];
    return value && value.trim() !== '';
  }).map(([name]) => name);

  services.push({
    name: 'Model providers',
    active: available.length > 0,
    detail:
      available.length > 0
        ? available.join(', ')
        : 'no API keys found — set a provider key (see .env.example)',
  });
}

/** Scope-guard status: on by default, needs a provider key to classify. */
export function detectScopeGuard(services: ServiceRegistry, hasProviderKeys: boolean): void {
  if (process.env.SCOPE_GUARD === 'off') {
    services.push({
      name: 'Scope guard',
      active: false,
      detail: 'disabled via SCOPE_GUARD=off — agents will answer off-topic',
    });
    return;
  }

  services.push({
    name: 'Scope guard',
    active: hasProviderKeys,
    detail: hasProviderKeys
      ? 'active (agents refuse out-of-scope input)'
      : 'inert without a provider key (fails open)',
  });
}
