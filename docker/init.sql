-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create initial schema for Mastra storage
-- Note: Mastra will create its own tables, but we can add custom tables here

-- Example: Table for embeddings (RAG support)
CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI embedding dimension
  metadata JSONB DEFAULT '{}',
  domain VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS embeddings_vector_idx 
ON embeddings USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create index for domain filtering
CREATE INDEX IF NOT EXISTS embeddings_domain_idx 
ON embeddings(domain);

-- Create index for metadata queries
CREATE INDEX IF NOT EXISTS embeddings_metadata_idx 
ON embeddings USING GIN (metadata);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_embeddings_updated_at BEFORE UPDATE
  ON embeddings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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
