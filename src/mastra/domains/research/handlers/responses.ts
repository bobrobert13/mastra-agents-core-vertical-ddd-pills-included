import { AppResult } from '../../../shared/handlers';
import type { ResearchError } from './errors';

/** A research outcome as a typed VALUE; the instance stays inside the domain. */
export type ResearchResult<T> = AppResult<T, ResearchError>;

/** Success branch of a `ResearchResult`. */
export const researchOk = <T>(value: T): ResearchResult<T> => AppResult.ok<T, ResearchError>(value);

/** Failure branch of a `ResearchResult`. */
export const researchFail = <T>(error: ResearchError): ResearchResult<T> =>
  AppResult.fail<T, ResearchError>(error);
