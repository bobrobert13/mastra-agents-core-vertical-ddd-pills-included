import { WebFetchError, WebSearchError } from '../handlers/errors';
import { researchFail, researchOk, type ResearchResult } from '../handlers/responses';
import { extractHtmlTitle, htmlToText } from './web-parse';

/** Fetch the DuckDuckGo Instant Answer JSON for `query` (raw payload). */
export async function fetchDuckDuckGo(query: string): Promise<ResearchResult<unknown>> {
  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
    );

    if (!response.ok) {
      return researchFail(new WebSearchError(`DuckDuckGo API error: ${response.status}`));
    }

    return researchOk(await response.json());
  } catch (error) {
    return researchFail(new WebSearchError(`Failed to reach DuckDuckGo: ${error}`, { cause: error }));
  }
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
): Promise<ResearchResult<FetchedPage>> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      return researchFail(new WebFetchError(`HTTP error! status: ${response.status}`));
    }

    const html = await response.text();
    const text = htmlToText(html);

    // For summary mode, take first 1000 characters
    const content = extractMode === 'summary' ? text.substring(0, 1000) : text;

    return researchOk({
      content,
      title: extractHtmlTitle(html),
      wordCount: text.split(/\s+/).length,
      rawText: text,
    });
  } catch (error) {
    if (error instanceof WebFetchError) return researchFail(error);
    return researchFail(new WebFetchError(`Failed to fetch URL: ${error}`, { cause: error }));
  }
}
