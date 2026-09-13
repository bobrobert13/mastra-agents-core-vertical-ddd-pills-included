// Streaming agent answers with @mastra/client-js — no glue code needed.
// Run against a live server:  node examples/stream-consumer.mjs [agentId] [baseUrl]
// Consumer dep (documented, dev-only): npm i @mastra/client-js --legacy-peer-deps
// When MASTRA_JWT_SECRET is set, add: new MastraClient({ baseUrl, headers: { Authorization: `Bearer <jwt>` } })
import { MastraClient } from '@mastra/client-js';

const client = new MastraClient({ baseUrl: process.argv[3] ?? 'http://localhost:4111' });
const agent = client.getAgent(process.argv[2] ?? 'research');

const response = await agent.stream('Summarize your scope in one line', {
  memory: { thread: 'example-thread', resource: 'example-user' },
});

await response.processDataStream({
  onChunk: async chunk => {
    if (chunk.type === 'text-delta') process.stdout.write(chunk.payload.text);
  },
});

process.stdout.write('\n');
