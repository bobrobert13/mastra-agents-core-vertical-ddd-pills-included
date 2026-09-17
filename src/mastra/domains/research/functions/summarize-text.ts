/**
 * Pure extractive summarizer — the exact algorithm previously inlined in
 * `tools/summarize.ts`. Sentence split, accumulate whole sentences up to
 * `maxLength`, then a `'...'` truncation fallback; the tool is now a thin
 * adapter over this.
 */
export interface SummaryOutput {
  summary: string;
  originalLength: number;
  summaryLength: number;
}

export function summarizeText(text: string, maxLength: number): SummaryOutput {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

  if (sentences.length === 0) {
    return {
      summary: '',
      originalLength: text.length,
      summaryLength: 0,
    };
  }

  // Take first few sentences up to maxLength
  let summary = '';
  for (const sentence of sentences) {
    const candidate = summary + sentence.trim() + '. ';
    if (candidate.length <= maxLength) {
      summary = candidate;
    } else {
      break;
    }
  }

  // If no sentences fit, truncate the first one
  if (!summary && sentences.length > 0) {
    summary = sentences[0].trim().substring(0, maxLength - 3) + '...';
  }

  // Ensure summary doesn't exceed maxLength
  if (summary.length > maxLength) {
    summary = summary.substring(0, maxLength - 3) + '...';
  }

  return {
    summary: summary.trim(),
    originalLength: text.length,
    summaryLength: summary.length,
  };
}
