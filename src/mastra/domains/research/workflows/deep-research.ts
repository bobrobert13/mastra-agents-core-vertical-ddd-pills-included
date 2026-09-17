import { createWorkflow } from '@mastra/core/workflows';
import { deepResearchInputSchema, deepResearchOutputSchema } from './schemas';
import { searchStep } from './steps/search';
import { fetchStep } from './steps/fetch';
import { summarizeStep } from './steps/summarize';
import { reviewFindingsStep } from './steps/review';

/**
 * deep-research composition only (Wave 3: steps live in `./steps/*`).
 *
 * `reviewFindingsStep` is re-exported here so existing consumers keep
 * resolving it from this exact path — notably
 * `tests/integration/hitl-suspend-resume.test.ts`, which imports it directly.
 */
export { reviewFindingsStep } from './steps/review';

/** search → fetch → summarize → HITL review; public I/O schemas unchanged. */
export const deepResearchWorkflow = createWorkflow({
  id: 'deep-research',
  inputSchema: deepResearchInputSchema,
  outputSchema: deepResearchOutputSchema,
})
  .then(searchStep)
  .then(fetchStep)
  .then(summarizeStep)
  .then(reviewFindingsStep)
  .commit();
