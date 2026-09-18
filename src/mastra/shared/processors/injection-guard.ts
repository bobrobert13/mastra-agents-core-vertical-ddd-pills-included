/**
 * Guard de INYECCIÓN con negativa conversacional: envuelve el
 * `PromptInjectionDetector` de Mastra para que una detección NO corte el turno.
 *
 * Contexto (incidente 2026-09-18, chat de `comms`): el scope guard reescribe el
 * último mensaje (nota de redirect) y el detector —que corría DESPUÉS— escaneaba
 * esa nota como si fuera input del usuario; su clasificador la marcaba como
 * `injection` y el `abort()` del detector mataba el stream. El orden de slots se
 * corrigió (los clasificadores de input crudo corren antes que cualquier guard
 * mutante), y este wrapper cierra la otra mitad: cuando la detección es real, el
 * contenido marcado se SUSTITUYE por una nota (`buildInjectionRefusalInstruction`)
 * y el agente redacta la negativa — el modelo nunca ve el contenido marcado,
 * misma garantía que el redirect del scope guard.
 *
 * Modos (`INJECTION_GUARD_MODE`): `graceful` (default) convierte la detección en
 * negativa; `block` restaura el TripWire del detector (corte duro, el contrato
 * anterior). Un fallo NO-TripWire del detector hace fail-open (warn + passthrough),
 * coherente con su fail-open interno y con el del scope guard.
 *
 * Acoplamiento declarado: el mensaje marcado es determinista porque el detector
 * se construye con `lastMessageOnly: true` (default de `createInjectionDetector`)
 * — escanea `messages.at(-1)` únicamente.
 */
import { TripWire } from '@mastra/core/agent';
import type { InputProcessor, PromptInjectionDetector } from '@mastra/core/processors';
import {
  readInjectionGuardMode,
  readScopeGuardTone,
  type InjectionGuardMode,
} from '../config/providers';
import { logger } from '../logger';
import { buildInjectionRefusalInstruction } from './injection-messaging';
import { replaceLastMessageText, textOfMessage, type MessageLike } from './message-text';
import { detectMessageLanguage } from './scope-messaging';
import type { DomainScope } from './scope-guard';

export interface InjectionGuardOptions {
  /** El scope del dominio: nombre del agente y voz de la negativa (`refusal`). */
  scope: DomainScope;
  /** El detector real (`createInjectionDetector()`), inyectable para tests offline. */
  detector: PromptInjectionDetector;
  /** Default: INJECTION_GUARD_MODE=graceful. */
  mode?: InjectionGuardMode;
}

/** El wrapper ES el slot del detector: conserva su id y expone el detector envuelto. */
export type InjectionGuard = InputProcessor & {
  /** El detector envuelto — su config (strategy/threshold/…) se lee aquí. */
  readonly detector: PromptInjectionDetector;
};

export function createInjectionGuard(options: InjectionGuardOptions): InjectionGuard {
  const { scope, detector, mode = readInjectionGuardMode() } = options;
  const id = detector.id; // 'prompt-injection-detector' — la etapa del trace no cambia
  const tone = scope.refusal?.tone ?? readScopeGuardTone();
  const maxSentences = scope.refusal?.maxSentences ?? 1;

  const guard = {
    id,
    detector,

    processInput: async (args: { messages: MessageLike[] } & Record<string, unknown>) => {
      const messages = args.messages;
      try {
        return (await detector.processInput({
          ...args,
          abort: (reason?: string): never => {
            throw new TripWire(reason ?? 'Prompt injection detected', { retry: false });
          },
        } as never)) as MessageLike[];
      } catch (error) {
        if (error instanceof TripWire) {
          if (mode === 'block') throw error;
          const language = detectMessageLanguage(textOfMessage(messages[messages.length - 1]));
          logger.warn(
            `[${id}] flagged → converted to a graceful refusal (no TripWire): ${error.message}`
          );
          return replaceLastMessageText(
            messages,
            buildInjectionRefusalInstruction({
              agentName: scope.agentName,
              tone,
              language,
              maxSentences,
            })
          );
        }

        logger.warn(`[${id}] detector failed — passing input through (fail-open):`, error);
        return messages;
      }
    },
  };

  return guard as unknown as InjectionGuard;
}
