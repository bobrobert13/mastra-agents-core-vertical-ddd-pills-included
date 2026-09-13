-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create initial schema for Mastra storage
-- Note: Mastra will create its own tables, but we can add custom tables here

-- Vector tables are owned by PgVector.createIndex (mastra_<indexname>);
-- the former hand-made vector demo table and all its dependents
-- (indexes, trigger function, trigger) were removed by spec 03 §3.8 —
-- a fixed-dimension table contradicts the local E5 embedder default and
-- falls into the "declared but broken" defect class (see ADR-006).

-- Example: Table for domain events
CREATE TABLE IF NOT EXISTS domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  domain VARCHAR(255) NOT NULL,
  aggregate_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for event queries
CREATE INDEX IF NOT EXISTS domain_events_type_idx ON domain_events(event_type);
CREATE INDEX IF NOT EXISTS domain_events_domain_idx ON domain_events(domain);
CREATE INDEX IF NOT EXISTS domain_events_created_idx ON domain_events(created_at DESC);
