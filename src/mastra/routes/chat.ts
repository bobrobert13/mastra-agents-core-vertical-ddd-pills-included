import { chatRoute } from '@mastra/ai-sdk';

/**
 * AI-SDK UI chat stream (spec 08, Scenario 4) — now the framework-official bridge.
 *
 * This route used to replicate `createUIMessageStreamResponse` frame by frame
 * (headers + `data: {json}\n\n` + `[DONE]`) only because the `ai` package was not
 * a backend dependency. `chatRoute()` owns that wire format, so there is no
 * serializer left here to drift from the SDK, and both contracts are Mastra's
 * documented ones:
 *
 *   POST /chat/:agentId
 *   { "messages": UIMessage[], "memory": { "thread": string, "resource": string } }
 *
 * `version: 'v7'` selects which AI SDK stream contract is emitted. The consumer
 * (the Astro chat island) is typed against `ai@7` / `@ai-sdk/vue@4`, so the
 * default `'v5'` shape would be parsed by the wrong contract: this is the single
 * knob that keeps both ends on the same protocol.
 *
 * Auth stays at the framework default (`requiresAuth: true`). The browser never
 * reaches this route — the Astro BFF relays to it with `Authorization: Bearer`.
 * `chatRoute()` forwards the incoming request's AbortSignal to `agent.stream()`,
 * so stopping the stream in the UI cancels the generation here.
 */
export const agentChatRoute = chatRoute({
  path: '/chat/:agentId',
  version: 'v7',
});
