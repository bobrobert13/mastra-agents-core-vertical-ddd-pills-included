import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { webSearchTool } from '../tools/web-search';
import { webFetchTool } from '../tools/web-fetch';
import { summarizeTool } from '../tools/summarize';
import { logger } from '../../../shared/logger';
import { runTool } from '../../../shared/tools/run-tool';

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}
interface WebSearchOutput {
  results: SearchResult[];
}
interface WebFetchOutput {
  content: string;
  title?: string;
  wordCount: number;
}
interface SummarizeOutput {
  summary: string;
  originalLength: number;
  summaryLength: number;
}

// Step 1: Search for relevant sources
const searchStep = createStep({
  id: 'search-sources',
  inputSchema: z.object({
    query: z.string(),
    maxSources: z.number().optional().default(3),
  }),
  outputSchema: z.object({
    query: z.string(),
    sources: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      })
    ),
  }),
  execute: async ({ inputData }) => {
    const result = await runTool<WebSearchOutput>(webSearchTool, {
      query: inputData.query,
      maxResults: inputData.maxSources,
    });

    return {
      query: inputData.query,
      sources: result.results,
    };
  },
});

// Step 2: Fetch content from sources
const fetchStep = createStep({
  id: 'fetch-content',
  inputSchema: z.object({
    query: z.string(),
    sources: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      })
    ),
  }),
  outputSchema: z.object({
    query: z.string(),
    contents: z.array(
      z.object({
        url: z.string(),
        title: z.string().optional(),
        content: z.string(),
        wordCount: z.number(),
      })
    ),
  }),
  execute: async ({ inputData }) => {
    const contents = await Promise.all(
      inputData.sources.map(async source => {
        try {
          const result = await runTool<WebFetchOutput>(webFetchTool, {
            url: source.url,
            extractMode: 'summary',
          });
          return {
            url: source.url,
            title: result.title,
            content: result.content,
            wordCount: result.wordCount,
          };
        } catch (error) {
          logger.error(`Failed to fetch ${source.url}:`, error);
          return null;
        }
      })
    );

    return {
      query: inputData.query,
      contents: contents.filter(c => c !== null),
    };
  },
});

// Step 3: Summarize all content
const summarizeStep = createStep({
  id: 'summarize-content',
  inputSchema: z.object({
    contents: z.array(
      z.object({
        url: z.string(),
        title: z.string().optional(),
        content: z.string(),
        wordCount: z.number(),
      })
    ),
    originalQuery: z.string(),
  }),
  outputSchema: z.object({
    summary: z.string(),
    sources: z.array(z.string()),
    totalWords: z.number(),
  }),
  execute: async ({ inputData }) => {
    const summaries = await Promise.all(
      inputData.contents.map(async content => {
        const result = await runTool<SummarizeOutput>(summarizeTool, {
          text: content.content,
          maxLength: 300,
        });
        return {
          url: content.url,
          title: content.title,
          summary: result.summary,
        };
      })
    );

    const combinedSummary = summaries
      .map(s => `**${s.title || s.url}**: ${s.summary}`)
      .join('\n\n');

    return {
      summary: combinedSummary,
      sources: summaries.map(s => s.url),
      totalWords: inputData.contents.reduce((acc, c) => acc + c.wordCount, 0),
    };
  },
});

// Complete workflow
export const deepResearchWorkflow = createWorkflow({
  id: 'deep-research',
  inputSchema: z.object({
    query: z.string(),
    maxSources: z.number().optional().default(3),
  }),
  outputSchema: z.object({
    summary: z.string(),
    sources: z.array(z.string()),
    totalWords: z.number(),
  }),
})
  .then(searchStep)
  .then(fetchStep)
  .then(
    createStep({
      id: 'prepare-summarization',
      inputSchema: z.object({
        query: z.string(),
        contents: z.array(
          z.object({
            url: z.string(),
            title: z.string().optional(),
            content: z.string(),
            wordCount: z.number(),
          })
        ),
      }),
      outputSchema: z.object({
        contents: z.array(
          z.object({
            url: z.string(),
            title: z.string().optional(),
            content: z.string(),
            wordCount: z.number(),
          })
        ),
        originalQuery: z.string(),
      }),
      execute: async ({ inputData }) => {
        return {
          contents: inputData.contents,
          originalQuery: inputData.query,
        };
      },
    })
  )
  .then(summarizeStep)
  .commit();
