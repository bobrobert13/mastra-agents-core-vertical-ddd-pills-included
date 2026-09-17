/**
 * Pure web-parsing helpers (no I/O): HTML → text, `<title>` extraction and the
 * DuckDuckGo response mapping. Extracted verbatim from the tools so the network
 * side (`web-io.ts`) and the tool adapters stay free of parsing logic.
 */

/** Strip script/style/tags and collapse whitespace (the tools' old pipeline). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The page `<title>`, or `undefined` when absent. */
export function extractHtmlTitle(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1] : undefined;
}

/** One mapped search result (mirrors the web-search tool outputSchema item). */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Only the DuckDuckGo fields this mapper reads (all optional by construction). */
interface DuckDuckGoTopic {
  Text?: string;
  FirstURL?: string;
}

interface DuckDuckGoResponse {
  Abstract?: string;
  AbstractURL?: string;
  Heading?: string;
  RelatedTopics?: DuckDuckGoTopic[];
}

/** Map the DuckDuckGo Instant Answer payload (Abstract first, then RelatedTopics). */
export function mapDuckDuckGoResults(data: unknown, maxResults: number): WebSearchResult[] {
  const payload = (data ?? {}) as DuckDuckGoResponse;
  const results: WebSearchResult[] = [];

  // Add abstract if available
  if (payload.Abstract) {
    results.push({
      title: payload.Heading || 'Summary',
      url: payload.AbstractURL || '',
      snippet: payload.Abstract,
    });
  }

  // Add related topics
  if (payload.RelatedTopics && Array.isArray(payload.RelatedTopics)) {
    for (const topic of payload.RelatedTopics.slice(0, maxResults - results.length)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 60),
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
    }
  }

  return results.slice(0, maxResults);
}
