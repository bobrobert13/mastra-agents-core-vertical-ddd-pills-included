export interface ResearchResult {
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
