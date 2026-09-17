import { WebFetchError, WebSearchError } from '../handlers/errors';
import { extractHtmlTitle, htmlToText } from './web-parse';

/** Fetch the DuckDuckGo Instant Answer JSON for `query` (raw payload). */
export async function fetchDuckDuckGo(query: string): Promise<unknown> {
  const response = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
  );

  if (!response.ok) {
    throw new WebSearchError(`DuckDuckGo API error: ${response.status}`);
  }

  return response.json();
}

export interface FetchedPage {
  content: string;
  title?: string;
  wordCount: number;
  /** Full extracted text, exposed so the tool can scan it for injection. */
  rawText: string;
}

/** Fetch `url` and extract its text/title; `summary` mode keeps the first 1000 chars. */
export async function fetchAndExtract(
  url: string,
  extractMode: 'full' | 'summary'
): Promise<FetchedPage> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new WebFetchError(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const text = htmlToText(html);

    // For summary mode, take first 1000 characters
    const content = extractMode === 'summary' ? text.substring(0, 1000) : text;

    return {
      content,
      title: extractHtmlTitle(html),
      wordCount: text.split(/\s+/).length,
      rawText: text,
    };
  } catch (error) {
    if (error instanceof WebFetchError) throw error;
    throw new WebFetchError(`Failed to fetch URL: ${error}`, { cause: error });
  }
}
