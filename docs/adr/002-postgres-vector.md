# ADR-002: PostgreSQL with pgvector

Updated: 2026-09-15 (see ADR-006)

## Status
Accepted

## Context
We need a database solution for the Mastra boilerplate that:
- Supports Mastra's storage requirements (agents, memory, workflows)
- Provides vector similarity search for future RAG/embeddings use cases
- Is production-ready and scalable
- Works well in self-hosted environments
- Supports multi-region deployment

## Options Considered

### Option 1: LibSQL (SQLite)
Use LibSQL as the default database

**Pros:**
- Zero configuration
- Embedded database (no separate server)
- Fast for single-instance deployments
- Good for development and small projects

**Cons:**
- No vector search capabilities
- Limited scalability (single-writer)
- Not suitable for multi-region
- File-based (issues with serverless/ephemeral filesystems)
- No concurrent writes

### Option 2: PostgreSQL + pgvector
Use PostgreSQL with pgvector extension

**Pros:**
- Full vector similarity search support
- Production-ready and battle-tested
- Excellent scalability and performance
- Multi-region replication support
- Concurrent reads and writes
- Rich ecosystem and tooling
- Works well with Mastra's @mastra/pg package

**Cons:**
- Requires separate database server
- More complex setup than SQLite
- Higher resource requirements

### Option 3: Pinecone + PostgreSQL
Use Pinecone for vectors, PostgreSQL for relational data

**Pros:**
- Best-in-class vector search
- Managed service (less ops burden)
- Excellent performance for vector operations

**Cons:**
- Two separate databases to manage
- Higher cost (Pinecone is paid)
- More complex architecture
- Network latency between services

## Decision
We chose **PostgreSQL with pgvector** as the database solution.

This provides:
- Single database for both relational and vector data
- Production-ready scalability
- Future-proof for RAG/embeddings use cases
- Multi-region support via PostgreSQL replication
- Cost-effective (self-hosted)

## Consequences

### Positive
- **Unified storage**: One database for all data types
- **Vector-ready**: Can implement RAG/embeddings immediately
- **Scalable**: Handles high concurrency and large datasets
- **Multi-region**: PostgreSQL replication supports geo-distribution
- **Cost-effective**: Self-hosted, no per-query costs
- **Ecosystem**: Rich tooling (pgAdmin, PostgREST, etc.)

### Negative
- **Setup complexity**: Requires PostgreSQL server setup
- **Resource usage**: Higher memory/CPU than SQLite
- **Ops burden**: Need to manage backups, updates, monitoring

### Mitigations
- Docker Compose for easy PostgreSQL setup
- Automated backup scripts
- Health checks for monitoring
- Clear documentation for deployment
- pgvector indexes optimized for performance

## Implementation

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Create embeddings table
CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create vector index
CREATE INDEX embeddings_vector_idx 
ON embeddings USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```
