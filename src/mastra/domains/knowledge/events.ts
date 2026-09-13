/**
 * Knowledge domain event contracts (spec 03 §3.6). Published on the shared
 * bus; consumers subscribe via `eventBus.subscribe('knowledge.indexed', …)`.
 */

export interface KnowledgeIndexedEvent {
  type: 'knowledge.indexed';
  payload: {
    docId: string;
    indexName: string;
    dimension: number;
    chunkCount: number;
    skippedChunks: number;
    timestamp: Date;
  };
}

export interface KnowledgeIndexFailedEvent {
  type: 'knowledge.index-failed';
  payload: {
    docId: string;
    stage: 'read' | 'chunk' | 'embed' | 'store';
    reason: string;
    timestamp: Date;
  };
}

export type KnowledgeEvent = KnowledgeIndexedEvent | KnowledgeIndexFailedEvent;
