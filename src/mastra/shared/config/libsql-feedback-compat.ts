import { ObservabilityLibSQL } from '@mastra/libsql';
import { MastraError, ErrorDomain, ErrorCategory } from '@mastra/core/error';
import type {
  ListFeedbackArgs,
  ListFeedbackResponse,
  GetFeedbackAggregateArgs,
  GetFeedbackAggregateResponse,
  GetFeedbackBreakdownArgs,
  GetFeedbackBreakdownResponse,
  GetFeedbackTimeSeriesArgs,
  GetFeedbackTimeSeriesResponse,
  GetFeedbackPercentilesArgs,
  GetFeedbackPercentilesResponse,
  UpdateFeedbackReviewStatusArgs,
  FeedbackRecord,
} from '@mastra/core/storage';

/**
 * LibSQL fallback for the Studio feedback endpoints.
 *
 * LibSQL only persists spans/traces — the feedback tables (list/aggregate/
 * breakdown/time-series/percentiles) are implemented only by PostgreSQL.
 * Out of the box the Studio polls GET /observability/feedback* and every
 * call throws "This storage provider does not support listing feedback"
 * (HTTP 500 noise in logs and the UI).
 *
 * This shim keeps the GET surface honest-but-empty (schema-conformant), so
 * the app works fully in zero-config/LibSQL mode. Write operations still
 * fail loudly with a clear migration hint. Use DATABASE_URL=postgresql://…
 * for the complete observability feedback surface.
 */
export class LibSQLFeedbackCompatStore extends ObservabilityLibSQL {
  async listFeedback(_args: ListFeedbackArgs): Promise<ListFeedbackResponse> {
    return { feedback: [] };
  }

  async getFeedbackAggregate(_args: GetFeedbackAggregateArgs): Promise<GetFeedbackAggregateResponse> {
    return { value: null };
  }

  async getFeedbackBreakdown(_args: GetFeedbackBreakdownArgs): Promise<GetFeedbackBreakdownResponse> {
    return { groups: [] };
  }

  async getFeedbackTimeSeries(_args: GetFeedbackTimeSeriesArgs): Promise<GetFeedbackTimeSeriesResponse> {
    return { series: [] };
  }

  async getFeedbackPercentiles(
    _args: GetFeedbackPercentilesArgs
  ): Promise<GetFeedbackPercentilesResponse> {
    return { series: [] };
  }

  async updateFeedbackReviewStatus(
    _args: UpdateFeedbackReviewStatusArgs
  ): Promise<FeedbackRecord> {
    throw new MastraError({
      id: 'FEEDBACK_WRITE_UNSUPPORTED_ON_LIBSQL',
      domain: ErrorDomain.MASTRA_OBSERVABILITY,
      category: ErrorCategory.USER,
      text: 'Storing feedback requires PostgreSQL (set DATABASE_URL). LibSQL fallback keeps feedback read-only.',
    });
  }
}
