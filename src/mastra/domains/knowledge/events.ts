import { createEvent, makeEvent, type DomainEvent, type EventDef } from '../../shared/events';

/**
 * Knowledge domain event contracts (spec 03 §3.6). Published on the shared
 * bus; consumers subscribe via `eventBus.subscribe('knowledge.indexed', …)`.
 *
 * Built with `createEvent` + `makeEvent` to eliminate the repeated
 * `type` / `payload` / `timestamp` boilerplate.
 */

export const knowledgeIndexedEvent: EventDef<'knowledge.indexed', {
  docId: string;
  indexName: string;
  dimension: number;
  chunkCount: number;
  skippedChunks: number;
  timestamp: Date;
}> = createEvent('knowledge.indexed')<{
  docId: string;
  indexName: string;
  dimension: number;
  chunkCount: number;
  skippedChunks: number;
  timestamp: Date;
}>();

export const knowledgeIndexFailedEvent: EventDef<'knowledge.index-failed', {
  docId: string;
  stage: 'read' | 'chunk' | 'embed' | 'store';
  reason: string;
  timestamp: Date;
}> = createEvent('knowledge.index-failed')<{
  docId: string;
  stage: 'read' | 'chunk' | 'embed' | 'store';
  reason: string;
  timestamp: Date;
}>();

export type KnowledgeIndexedEvent = DomainEvent<'knowledge.indexed', {
  docId: string;
  indexName: string;
  dimension: number;
  chunkCount: number;
  skippedChunks: number;
  timestamp: Date;
}>;

export type KnowledgeIndexFailedEvent = DomainEvent<'knowledge.index-failed', {
  docId: string;
  stage: 'read' | 'chunk' | 'embed' | 'store';
  reason: string;
  timestamp: Date;
}>;

export type KnowledgeEvent = KnowledgeIndexedEvent | KnowledgeIndexFailedEvent;

export { makeEvent };
