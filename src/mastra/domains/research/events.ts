export interface ResearchStartedEvent {
  type: 'research.started';
  payload: {
    query: string;
    timestamp: Date;
  };
}

export interface ResearchCompletedEvent {
  type: 'research.completed';
  payload: {
    query: string;
    sources: string[];
    timestamp: Date;
  };
}

export type ResearchEvent = ResearchStartedEvent | ResearchCompletedEvent;
