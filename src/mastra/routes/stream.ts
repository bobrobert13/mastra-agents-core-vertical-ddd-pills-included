import { registerApiRoute } from '@mastra/core/server';
import type { CoreMessage } from '@mastra/core/llm';
import { toAISdkStream } from '@mastra/ai-sdk';
import { z } from 'zod';

const streamBodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant', 'system']), content: z.string() }))
    .min(1),
  memory: z.object({ thread: z.string(), resource: z.string() }).optional(),
});

/**
 * Headers + SSE frame format of the AI SDK's `createUIMessageStreamResponse`
 * (v5 UI message stream), replicated verbatim from the internals bundled in
 * @mastra/ai-sdk@1.10.2 (JsonToSseTransformStream + UI_MESSAGE_STREAM_HEADERS).
 *
 * DEVIATION (spec 08 §3.2 named it `createUIMessageStreamResponse` from 'ai'):
 * the `ai` package is NOT installed (it is not a peer of @mastra/ai-sdk — only
 * @mastra/core + zod are) and this wave forbids `npm install`. The wire format
 * below is byte-identical to what `createUIMessageStream({ execute: writer =>
 * … writer.write(part) … })` + `createUIMessageStreamResponse` emit for the
 * same part sequence (`data: <json>\n\n` per part, `data: [DONE]\n\n` last,
 * error part `{type:'error',errorText}` on throw). When `ai` becomes a direct
 * dep this helper can be replaced by it in one commit — nothing else changes.
 */
const UI_MESSAGE_STREAM_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'x-vercel-ai-ui-message-stream': 'v1',
  'x-accel-buffering': 'no',
};

function uiMessageStreamResponse(parts: ReadableStream<unknown>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start: async controller => {
      try {
        for await (const part of parts) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
        }
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', errorText })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { headers: UI_MESSAGE_STREAM_HEADERS });
}

/**
 * AI-SDK-compatible SSE streaming of an agent answer (Scenario 4).
 * `requiresAuth` stays DEFAULT (true): protected once Spec 01's auth is on;
 * no key material in the URL — messages travel in the POST body.
 */
export const agentStreamRoute = registerApiRoute('/stream/:agentId', {
  method: 'POST',
  openapi: { summary: 'Stream an agent answer as AI-SDK UI chunks', tags: ['Streaming'] },
  handler: async c => {
    const parsed = streamBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid stream payload' }, 400);

    const agentId = c.req.param('agentId');
    const mastra = c.get('mastra');
    let agent; // mastra.getAgent(id) THROWS for unknown ids (verified runtime);
    try {
      agent = mastra.getAgent(agentId); // an uncaught throw would surface as 500
    } catch {
      return c.json({ error: `agent "${agentId}" not found` }, 404); // via onError — catch it here
    }

    // zod-verified {role, content:string} items ARE valid AI-SDK core messages;
    // TS just cannot distribute the role-union across the message-shape union,
    // so the per-element assertion below is the typed bridge (content: string
    // is a legal member of every role's content type).
    const messages = parsed.data.messages.map(m => ({ role: m.role, content: m.content }) as CoreMessage);

    const output = await agent.stream(messages, {
      memory: parsed.data.memory,
      abortSignal: c.req.raw.signal, // client disconnect cancels generation (docs pattern)
    });

    return uiMessageStreamResponse(
      toAISdkStream(output, { from: 'agent' }) as unknown as ReadableStream<unknown>,
    );
  },
});
