import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { logger } from '../../../../shared/logger';
import { ResearchRejectedError } from '../../handlers/errors';
import { deepResearchOutputSchema } from '../schemas';

/**
 * HITL suspend point (spec 06 §3.4): a human reviews the findings BEFORE the
 * run is allowed to finish with them. In 1.66.0 `suspended` is an array of
 * step PATHS ([string[], ...string[][]]); the suspend payload is exactly what
 * the reviewer is shown, the resume payload exactly what they decide.
 * Durability: suspend() persists a snapshot in the configured storage
 * (default LibSQL file:./mastra.db) and survives process restarts — recovery
 * via getWorkflowRunById + createWorkflowStateReader (Scenario 5).
 */
export const reviewFindingsStep = createStep({
  id: 'review-findings',
  inputSchema: deepResearchOutputSchema,
  outputSchema: deepResearchOutputSchema,
  suspendSchema: z.object({
    // what the reviewer is shown
    reason: z.string(),
    summary: z.string(),
    sources: z.array(z.string()),
    findingsWordCount: z.number(),
  }),
  resumeSchema: z.object({
    // what the reviewer sends back
    approved: z.boolean(),
    note: z.string().optional(), // audit trail only
  }),
  execute: async ({ inputData, resumeData, suspend, suspendData }) => {
    // Non-interactive / scheduled runs pass through (REVIEW_APPROVAL=off;
    // loud ⚠ banner clause — security-stack.ts §3.7).
    if (process.env.REVIEW_APPROVAL === 'off') return inputData;

    if (!resumeData) {
      // suspend() payload is REQUIRED when suspendSchema is set.
      return await suspend({
        reason: 'Human review required before releasing research findings',
        summary: inputData.summary,
        sources: inputData.sources,
        findingsWordCount: inputData.totalWords,
      });
    }

    if (!resumeData.approved) {
      // Rejection = terminal failure of the run (a decision, not a crash).
      throw new ResearchRejectedError(
        `Research findings rejected by reviewer${resumeData.note ? `: ${resumeData.note}` : ''}`
      );
    }

    logger.info(`[deep-research] approved after suspend at ${suspendData?.reason}`);
    return inputData;
  },
});
