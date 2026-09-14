import { z } from 'zod';

/**
 * Shared Zod schemas for the deep-research workflow.
 *
 * Extracted so each inter-step shape is declared ONCE. The `sources` array
 * shape was previously copied twice and the `contents` array shape four
 * times — editing one and missing the others silently breaks the step chain.
 */

/** Workflow entry point (spec 06 §3.4: workflow I/O schemas UNCHANGED). */
export const deepResearchInputSchema = z.object({
  query: z.string(),
  maxSources: z.number().optional().default(3),
});

/** One source returned by web_search — `search-sources` output = `fetch-content` input. */
export const sourceItemSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

export const sourcesSchema = z.array(sourceItemSchema);

export type SearchResult = z.infer<typeof sourceItemSchema>;

/** web_search tool contract (mirrors its outputSchema). */
export const webSearchOutputSchema = z.object({ results: sourcesSchema });
export type WebSearchOutput = z.infer<typeof webSearchOutputSchema>;

/** One fetched document — `fetch-content` output = `summarize-content` input. */
export const contentItemSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  content: z.string(),
  wordCount: z.number(),
});

export const contentsSchema = z.array(contentItemSchema);

/** `search-sources` output = `fetch-content` input. */
export const searchOutputSchema = z.object({
  query: z.string(),
  sources: sourcesSchema,
});

/** `fetch-content` output = `summarize-content` input. */
export const fetchOutputSchema = z.object({
  query: z.string(),
  contents: contentsSchema,
});

/** Public workflow output; also the review-findings passthrough shape. */
export const deepResearchOutputSchema = z.object({
  summary: z.string(),
  sources: z.array(z.string()),
  totalWords: z.number(),
});
