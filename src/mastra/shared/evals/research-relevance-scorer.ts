/**
 * `research-relevance` — the research domain's heuristic relevance scorer
 * (spec 07 §3.2) wrapped as a real `MastraScorer` so it is registrable on
 * the `Mastra` instance, selectable in Studio, resolvable by ID in
 * `startExperiment({ scorers: ['research-relevance'] })`, and gateable in
 * `runEvals` thresholds.
 *
 * The scoring LOGIC is the existing zero-LLM heuristic from
 * `domains/research/scorers/relevance-scorer.ts` (query-term overlap + URL
 * citation + length sanity). It is duplicated here, NOT imported, because
 * `shared/` must not import from a domain (vertical-slice rule); the domain
 * module keeps working unchanged for legacy call sites.
 *
 * Model-free by construction → runs in Tier A (keyless CI) against recorded
 * fixtures.
 */

import { createScorer } from '@mastra/core/evals';
import { getUserMessageFromRunInput } from '@mastra/evals/scorers/utils';

function heuristicRelevance(query: string, response: string): { score: number; reason: string } {
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3);
  const responseLower = response.toLowerCase();

  const matchingWords = queryWords.filter(word => responseLower.includes(word));
  const wordMatchScore = queryWords.length > 0 ? matchingWords.length / queryWords.length : 0;

  // URLs in the answer indicate the research loop actually cited sources.
  const hasUrls = /https?:\/\//.test(response);
  const urlBonus = hasUrls ? 0.2 : 0;

  const responseLength = response.length;
  const lengthScore =
    responseLength > 100 && responseLength < 2000 ? 0.1 : responseLength > 50 ? 0.05 : 0;

  const finalScore = Math.min(1, wordMatchScore * 0.7 + urlBonus + lengthScore);
  return {
    score: finalScore,
    reason: `Relevance score: ${finalScore.toFixed(2)}. ${hasUrls ? 'Sources cited.' : 'No sources cited.'}`,
  };
}

function extractText(run: { input?: unknown; output?: unknown }): string {
  const out = run.output;
  if (typeof out === 'string') return out;
  if (Array.isArray(out)) {
    return out
      .map(m =>
        typeof m === 'string'
          ? m
          : String(
              (
                m as { content?: { parts?: Array<{ type: string; text?: string }> } }
              )?.content?.parts
                ?.filter(p => p.type === 'text')
                .map(p => p.text ?? '')
                .join(' ') ?? ''
            )
      )
      .join(' ');
  }
  if (out && typeof out === 'object' && 'text' in out)
    return String((out as { text: unknown }).text);
  return '';
}

export const researchRelevanceScorer = createScorer({
  id: 'research-relevance',
  name: 'Research Relevance Scorer',
  description:
    'Zero-LLM heuristic: query-term overlap + cited URLs + answer-length sanity (spec 07 §3.2, wrapped relevance-scorer.ts logic)',
})
  .preprocess(({ run }) => {
    const query = getUserMessageFromRunInput(run.input) ?? '';
    const response = extractText(run);
    return { query, response };
  })
  .generateScore(({ results }) => {
    if (!results.preprocessStepResult) return 0;
    const { query, response } = results.preprocessStepResult as { query: string; response: string };
    return heuristicRelevance(query, response).score;
  })
  .generateReason(({ results }) => {
    const pre = results.preprocessStepResult as { query: string; response: string } | undefined;
    if (!pre) return 'No preprocess result';
    return heuristicRelevance(pre.query, pre.response).reason;
  });
