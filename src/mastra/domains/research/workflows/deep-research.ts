// Mastra workflows: https://mastra.ai/docs/workflows/overview — suspend/resume: https://mastra.ai/docs/workflows/suspend-and-resume
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { logger } from '../../../shared/logger';
import { summarizeText } from '../functions/summarize-text';
import { fetchPage } from '../tools/web-fetch';
import { searchWeb } from '../tools/web-search';

const sourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

const contentSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  content: z.string(),
  wordCount: z.number(),
});

const inputSchema = z.object({
  query: z.string(),
  maxSources: z.number().int().min(1).max(10).default(5),
});

const outputSchema = z.object({
  summary: z.string(),
  sources: z.array(z.string()),
  totalWords: z.number(),
});

const searchStep = createStep({
  id: 'search',
  inputSchema,
  outputSchema: z.object({ query: z.string(), sources: z.array(sourceSchema) }),
  execute: async ({ inputData }) => ({
    query: inputData.query,
    sources: await searchWeb(inputData.query, inputData.maxSources),
  }),
});

const fetchStep = createStep({
  id: 'fetch-content',
  inputSchema: z.object({ query: z.string(), sources: z.array(sourceSchema) }),
  outputSchema: z.object({ query: z.string(), contents: z.array(contentSchema) }),
  execute: async ({ inputData }) => {
    const contents = await Promise.all(
      inputData.sources.map(async source => {
        try {
          const page = await fetchPage(source.url, 'summary');
          return {
            url: source.url,
            title: page.title,
            content: page.content,
            wordCount: page.wordCount,
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

const summarizeStep = createStep({
  id: 'summarize',
  inputSchema: z.object({ query: z.string(), contents: z.array(contentSchema) }),
  outputSchema,
  execute: async ({ inputData }) => {
    const summaries = inputData.contents.map(page => ({
      url: page.url,
      title: page.title,
      summary: summarizeText(page.content, 300).summary,
    }));

    return {
      summary: summaries.map(s => `**${s.title || s.url}**: ${s.summary}`).join('\n\n'),
      sources: summaries.map(s => s.url),
      totalWords: inputData.contents.reduce((acc, page) => acc + page.wordCount, 0),
    };
  },
});

const reviewStep = createStep({
  id: 'review-findings',
  inputSchema: outputSchema,
  outputSchema,
  suspendSchema: z.object({
    reason: z.string(),
    summary: z.string(),
    sources: z.array(z.string()),
    findingsWordCount: z.number(),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    note: z.string().optional(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (process.env.REVIEW_APPROVAL === 'off') return inputData;

    if (!resumeData) {
      return await suspend({
        reason: 'Human review required before releasing research findings',
        summary: inputData.summary,
        sources: inputData.sources,
        findingsWordCount: inputData.totalWords,
      });
    }

    if (!resumeData.approved) {
      throw new Error(
        `Research findings rejected by reviewer${resumeData.note ? `: ${resumeData.note}` : ''}`
      );
    }

    return inputData;
  },
});

export const deepResearchWorkflow = createWorkflow({
  id: 'deep-research',
  inputSchema,
  outputSchema,
})
  .then(searchStep)
  .then(fetchStep)
  .then(summarizeStep)
  .then(reviewStep)
  .commit();
