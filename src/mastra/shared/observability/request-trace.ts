/**
 * Traza mínima del pipeline de chat para la terminal (diagnóstico en desarrollo).
 *
 * Un request a `/chat/:agentId` atraviesa una cadena larga ANTES de que el
 * cliente reciba el primer byte —memoria, scope guard, token limiter, detector
 * de inyección, response cache, modelo, PII— y el server no imprimía NI UNA
 * línea por request: cuando algo se atoraba, la única pista era el silencio.
 *
 * Este módulo abre un contexto por request (`AsyncLocalStorage`) con un id corto
 * y deja huellas de UNA línea a nivel `info`:
 *
 *   [chat 3f7a91c2] → POST /chat/comms msgs=1 thread=nuevo-9c1d
 *   [chat 3f7a91c2] · scope-guard:communication pass 1.25s
 *   [chat 3f7a91c2] · prompt-injection-detector ok 1.84s
 *   [chat 3f7a91c2] ← 200 ttfb=8.90s [scope-guard:communication 1.25s, …]
 *   [chat 3f7a91c2] ✓ done 12.40s first-byte=9.12s bytes=1183
 *
 * `tracedProcessor()` envuelve un procesador con un Proxy transparente (mismo
 * prototype ⇒ `instanceof` y los campos privados intactos: los métodos se
 * invocan con `this` = instancia original) que mide cada llamada. Los métodos
 * de streaming (`processOutputStream`, uno por chunk) acumulan ms pero NO se
 * loguean por llamada: serían cientos de líneas por turno.
 *
 * Encendido: por defecto en desarrollo (`NODE_ENV !== 'production'`), apagado
 * en producción. `CHAT_TRACE=on|off` fuerza cualquiera de los dos estados.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { TripWire } from '@mastra/core/agent';
import { logger } from '../logger';

export interface ChatTrace {
  /** 8 hex — el mismo que viaja como `x-mastra-trace` en la respuesta. */
  id: string;
  agentId: string;
  startedAt: number;
  /** label → ms acumulados (una etapa puede invocarse más de una vez). */
  stages: Map<string, number>;
  /** Última etapa que arrancó — nombra dónde se quedó si el request revienta. */
  lastStage: string;
}

const storage = new AsyncLocalStorage<ChatTrace>();

/** Métodos por-chunk: miden, pero no loguean cada invocación. */
const PER_CHUNK_METHODS = new Set(['processOutputStream']);

export function chatTraceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.CHAT_TRACE ?? '').trim().toLowerCase();
  if (raw === 'off') return false;
  if (raw === 'on') return true;
  return env.NODE_ENV !== 'production';
}

export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Id corto y estable a partir del `x-request-id` que ya manda el BFF; si el
 * header falta o no trae hex suficiente, se acuña uno nuevo.
 */
export function shortTraceId(seed?: string | null): string {
  const hex = (seed ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.length >= 8 ? hex.slice(0, 8) : randomBytes(4).toString('hex');
}

export function openChatTrace(agentId: string, seed?: string | null): ChatTrace {
  return {
    id: shortTraceId(seed),
    agentId,
    startedAt: Date.now(),
    stages: new Map(),
    lastStage: 'receive',
  };
}

export function runWithChatTrace<T>(trace: ChatTrace, fn: () => T): T {
  return storage.run(trace, fn);
}

export function currentChatTrace(): ChatTrace | undefined {
  return storage.getStore();
}

export function chatTraceLine(trace: ChatTrace, message: string): void {
  logger.info(`[chat ${trace.id}] ${message}`);
}

/** Resumen compacto de etapas acumuladas: `scope-guard 1.25s, cache 0.00s`. */
export function stageSummary(trace: ChatTrace): string {
  return [...trace.stages].map(([label, ms]) => `${label} ${formatMs(ms)}`).join(', ');
}

function recordStage(trace: ChatTrace, name: string, elapsed: number, outcome: string, method: string): void {
  trace.stages.set(name, (trace.stages.get(name) ?? 0) + elapsed);
  if (PER_CHUNK_METHODS.has(method)) return;
  chatTraceLine(trace, `· ${name} ${outcome} ${formatMs(elapsed)}`);
}

/**
 * Proxy de timing para un procesador. Transparente: sólo intercepta los métodos
 * `process*` para medir; todo lo demás (id, name, opciones, `instanceof`) se
 * lee del original. Fuera de un trace activo devuelve el procesador tal cual.
 */
export function tracedProcessor<T extends object>(processor: T, label?: string): T {
  if (!chatTraceEnabled()) return processor;
  const name = label ?? (processor as { id?: string }).id ?? 'processor';

  return new Proxy(processor, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (typeof prop !== 'string' || !prop.startsWith('process')) {
        // Resto de métodos con `this` = instancia original: sin esto, un método
        // con campos privados (`#x`) reventaría al recibir el Proxy como `this`.
        return value.bind(target);
      }
      const method = value as (...args: unknown[]) => Promise<unknown>;
      return async (...args: unknown[]) => {
        const trace = currentChatTrace();
        if (!trace) return method.apply(target, args);
        trace.lastStage = name;
        const startedAt = Date.now();
        try {
          const result = await method.apply(target, args);
          recordStage(trace, name, Date.now() - startedAt, 'ok', prop);
          return result;
        } catch (error) {
          recordStage(trace, name, Date.now() - startedAt, error instanceof TripWire ? 'block' : 'fail', prop);
          throw error;
        }
      };
    },
  });
}
