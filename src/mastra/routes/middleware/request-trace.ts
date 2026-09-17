/**
 * Traza por request de la superficie de chat (diagnóstico de desarrollo).
 *
 * GLOBAL `server.middleware` (mismo mecanismo que `requestContextPopulator`):
 * se salta las rutas framework-public y sólo actúa sobre `/chat/:agentId` —el
 * resto de la superficie custom (webhooks, health) no se ensucia—.
 *
 * Escribe cuatro huellas de una línea por request, con el mismo id corto:
 * entrada (+ agente/thread/mensajes leídos del body sin consumirlo), TTFB
 * (cuándo el handler devolvió el `Response`: el final real del preámbulo de
 * guardrails), primer byte del stream y cierre con bytes totales. El id viaja
 * de vuelta como `x-mastra-trace`, así que el log del navegador y el de la
 * terminal se pueden correlacionar.
 *
 * El body se inspecciona con un CLON: el original queda intacto para el
 * handler (mismo truco que usa el bridge de Mastra con su request prístino).
 * Sólo se lee si es JSON y por debajo de 64 KB; fuera de eso, se traza igual
 * sin detalle.
 */
import type { RouteMiddleware } from './types';
import {
  chatTraceEnabled,
  chatTraceLine,
  formatMs,
  openChatTrace,
  runWithChatTrace,
  stageSummary,
  type ChatTrace,
} from '../../shared/observability/request-trace';

const CHAT_PATH = /^\/chat\/([^/]+)\/?$/;
const MAX_BODY_INSPECT_BYTES = 64 * 1024;

export const requestTrace: RouteMiddleware = async (c, next) => {
  if (!chatTraceEnabled()) return next();

  const path = new URL(c.req.url).pathname;
  const match = CHAT_PATH.exec(path);
  if (!match) return next();

  const trace = openChatTrace(decodeURIComponent(match[1]), c.req.header('x-request-id'));
  chatTraceLine(trace, `→ ${c.req.method} ${path}${await describeBody(c.req.raw)}`);

  try {
    await runWithChatTrace(trace, next);
  } catch (error) {
    chatTraceLine(
      trace,
      `✗ failed after ${formatMs(Date.now() - trace.startedAt)} at ${trace.lastStage}: ${errorText(error)}`
    );
    throw error;
  }

  const response = c.res;
  const stages = stageSummary(trace);
  chatTraceLine(
    trace,
    `← ${response.status} ttfb=${formatMs(Date.now() - trace.startedAt)}${stages ? ` [${stages}]` : ''}`
  );

  const headers = new Headers(response.headers);
  headers.set('x-mastra-trace', trace.id);
  const isEventStream = (response.headers.get('content-type') ?? '').includes('text/event-stream');
  const body = isEventStream && response.body ? trackStream(response.body, trace) : response.body;

  c.res = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/** Detalle opcional (`msgs=1 thread=nuevo-9c1d`) leído del clon del body. */
async function describeBody(request: Request): Promise<string> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return '';
  try {
    const raw = await request.clone().text();
    if (raw.length === 0 || raw.length > MAX_BODY_INSPECT_BYTES) return '';
    const parsed = JSON.parse(raw) as { messages?: unknown; memory?: { thread?: unknown } };
    const bits: string[] = [];
    if (Array.isArray(parsed.messages)) bits.push(`msgs=${parsed.messages.length}`);
    if (typeof parsed.memory?.thread === 'string') bits.push(`thread=${parsed.memory.thread}`);
    return bits.length > 0 ? ` ${bits.join(' ')}` : '';
  } catch {
    // Un body ilegible no es asunto de la traza: se sigue sin detalle.
    return '';
  }
}

/**
 * Envoltura passthrough del stream: mide el primer byte y el cierre (o la
 * cancelación del cliente) sin bufferizar nada — cada chunk se reenvía tal cual.
 */
function trackStream(body: ReadableStream<Uint8Array>, trace: ChatTrace): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let bytes = 0;
  let firstByteAt: number | undefined;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        const stages = stageSummary(trace);
        chatTraceLine(
          trace,
          `✓ done ${formatMs(Date.now() - trace.startedAt)}` +
            ` first-byte=${firstByteAt === undefined ? 'n/a' : formatMs(firstByteAt)}` +
            ` bytes=${bytes}${stages ? ` [${stages}]` : ''}`
        );
        controller.close();
        return;
      }
      firstByteAt ??= Date.now() - trace.startedAt;
      bytes += value.byteLength;
      controller.enqueue(value);
    },
    cancel(reason) {
      chatTraceLine(
        trace,
        `✗ cancelled after ${formatMs(Date.now() - trace.startedAt)} bytes=${bytes}`
      );
      return reader.cancel(reason);
    },
  });
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n')[0] ?? error.message;
  return String(error);
}
