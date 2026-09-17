import type { ServiceRegistry } from './service-status';
import type { ScopeGuardTone } from '../processors/scope-messaging';

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

/** Cómo responde el scope guard cuando el mensaje es de otro dominio. */
export type ScopeGuardMode = 'redirect' | 'block';

/**
 * Modo del scope guard (env `SCOPE_GUARD_MODE`), resuelto aquí y no en el
 * processor porque el banner también lo reporta: `redirect` (default desde
 * 2026-09-17) deja que el agente redacte la negativa sin ver la petición;
 * `block` conserva el corte duro (TripWire antes del modelo).
 */
export function readScopeGuardMode(env: NodeJS.ProcessEnv = process.env): ScopeGuardMode {
  return (env.SCOPE_GUARD_MODE ?? '').trim().toLowerCase() === 'block' ? 'block' : 'redirect';
}

/** Los tres registros de voz que admite la negativa del scope guard. */
export const SCOPE_GUARD_TONES = ['warm', 'formal', 'neutral'] as const;

/**
 * Tono de la negativa del scope guard (env `SCOPE_GUARD_TONE`). Default `warm`;
 * un valor vacío o desconocido también cae a `warm` — mismo espíritu que
 * `readScopeGuardMode`. El tipo se importa desde `scope-messaging` (que NO
 * importa de aquí: sin ciclo). Un dominio puede además declararlo en su
 * `scope.refusal.tone`, que prevalece sobre esta variable.
 */
export function readScopeGuardTone(env: NodeJS.ProcessEnv = process.env): ScopeGuardTone {
  const value = (env.SCOPE_GUARD_TONE ?? '').trim().toLowerCase();
  return (SCOPE_GUARD_TONES as readonly string[]).includes(value)
    ? (value as ScopeGuardTone)
    : 'warm';
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
      ? readScopeGuardMode() === 'block'
        ? `active (out-of-scope input → blocked with a notice, tone: ${readScopeGuardTone()})`
        : `active (out-of-scope input → the agent answers the refusal, tone: ${readScopeGuardTone()})`
      : 'inert without a provider key (fails open)',
  });
}
