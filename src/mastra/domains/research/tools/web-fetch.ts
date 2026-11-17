// Mastra tools: https://mastra.ai/docs/agents/tools
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { extractHtmlTitle, htmlToText } from '../functions/web-parse';

const MAX_BYTES = 2_000_000;

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  if (host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.')) return true;
  if (host.startsWith('169.254.')) return true;
  const match = /^172\.(\d{1,3})\./.exec(host);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function assertSafeUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Refusing to fetch non-HTTP URL: ${value}`);
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error(`Refusing to fetch private/loopback host: ${url.hostname}`);
  }
  return url;
}

export async function fetchPage(
  url: string,
  mode: 'full' | 'summary'
): Promise<{ content: string; title?: string; wordCount: number }> {
  const target = assertSafeUrl(url);
  const response = await fetch(target, {
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });
  assertSafeUrl(response.url);

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BYTES) {
    throw new Error(`Response too large: ${contentLength} bytes (limit ${MAX_BYTES})`);
  }

  const html = await response.text();
  if (html.length > MAX_BYTES) {
    throw new Error(`Response body too large: ${html.length} chars (limit ${MAX_BYTES})`);
  }

  const text = htmlToText(html);
  return {
    content: mode === 'summary' ? text.substring(0, 1000) : text,
    title: extractHtmlTitle(html),
    wordCount: text.split(/\s+/).length,
  };
}

export const webFetchTool = createTool({
  id: 'research-web-fetch',
  description: 'Fetch and extract content from a URL',
  inputSchema: z.object({
    url: z.string().url().describe('URL to fetch'),
    extractMode: z
      .enum(['full', 'summary'])
      .optional()
      .default('summary')
      .describe('Extraction mode'),
  }),
  outputSchema: z.object({
    content: z.string(),
    title: z.string().optional(),
    wordCount: z.number(),
  }),
  execute: async ({ url, extractMode = 'summary' }) => fetchPage(url, extractMode),
});
