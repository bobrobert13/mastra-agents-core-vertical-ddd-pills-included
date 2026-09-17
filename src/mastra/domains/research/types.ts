/**
 * Persisted research record. Renamed from `ResearchResult` in Phase 3: the
 * `handlers/responses.ts` result-pattern alias now owns that name (both were
 * re-exported by `index.ts`, so the shared name was a `TS2308` collision).
 */
export interface ResearchFindings {
  query: string;
  summary: string;
  sources: string[];
  totalWords: number;
  timestamp: Date;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface FetchedContent {
  url: string;
  title?: string;
  content: string;
  wordCount: number;
}
