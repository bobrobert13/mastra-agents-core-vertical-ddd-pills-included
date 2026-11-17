import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mastra } from '../../src/mastra';

const DDG = {
  Abstract: 'TypeScript 5.7 adds inferred type predicates.',
  AbstractURL: 'https://example.test/typescript-5-7',
  Heading: 'TypeScript 5.7',
  RelatedTopics: [],
};

const HTML = '<html><head><title>TypeScript 5.7</title></head><body>Release notes body.</body></html>';

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith('https://api.duckduckgo.com/')) {
        return {
          ok: true,
          status: 200,
          url,
          headers: new Headers(),
          json: async () => DDG,
          text: async () => JSON.stringify(DDG),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers({ 'content-length': String(HTML.length) }),
        json: async () => ({}),
        text: async () => HTML,
      } as unknown as Response;
    })
  );
}

describe('deep-research HITL suspend/resume', () => {
  const savedReviewApproval = process.env.REVIEW_APPROVAL;

  beforeEach(() => {
    delete process.env.REVIEW_APPROVAL;
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedReviewApproval === undefined) delete process.env.REVIEW_APPROVAL;
    else process.env.REVIEW_APPROVAL = savedReviewApproval;
  });

  it('suspends at review-findings and resumes on approval', async () => {
    const workflow = mastra.getWorkflow('deep-research');
    const run = await workflow.createRun();

    const suspended = await run.start({ inputData: { query: 'typescript 5.7', maxSources: 1 } });
    expect(suspended.status).toBe('suspended');

    const resumed = await run.resume({ resumeData: { approved: true } });
    expect(resumed.status).toBe('success');
    if (resumed.status === 'success') {
      expect(resumed.result).toMatchObject({ sources: ['https://example.test/typescript-5-7'] });
    }
  }, 30_000);
});
