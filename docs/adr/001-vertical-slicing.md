# ADR-001: Vertical Slicing Architecture

## Status
Accepted

## Context
We need to organize a Mastra boilerplate that will be used as a starting point for multiple AI agent projects. The architecture should:
- Be easy to understand and navigate
- Allow independent development of features
- Minimize coupling between different concerns
- Support scaling the codebase as features grow
- Make it easy to delete or refactor features

## Options Considered

### Option 1: Horizontal/Layered Architecture
Organize by technical layers: `agents/`, `tools/`, `workflows/`, `scorers/`

**Pros:**
- Clear separation of technical concerns
- Easy to find all tools in one place
- Simple mental model for technical roles

**Cons:**
- High coupling between layers
- Hard to understand feature boundaries
- Difficult to delete features (code spread across layers)
- Multiple teams working on same files causes conflicts
- "Where is the weather feature logic?" → spread across 4 folders

### Option 2: Vertical Slicing Architecture
Organize by business domains/features: `domains/research/`, `domains/tasks/`, etc.

**Pros:**
- Maximum cohesion: everything about "research" lives together
- Minimum coupling: domains don't import each other directly
- Easy to understand: "Where is research logic?" → one folder
- Safe deletion: remove feature = delete directory
- Parallel development: teams work on different domains without conflicts
- Independent evolvability: each domain can be rewritten independently

**Cons:**
- Some code duplication across domains
- Need to decide what goes in `shared/`
- Slightly more complex initial setup

### Option 3: Hybrid Approach
Mix of horizontal and vertical organization

**Pros:**
- Flexibility to choose organization per component

**Cons:**
- Inconsistent structure
- Confusing for new developers
- Harder to maintain conventions

## Decision
We chose **Vertical Slicing Architecture** organized by business domains.

Each domain contains all its components:
```
domains/research/
├── agent.ts
├── tools/
├── workflows/
├── scorers/
├── types.ts
├── events.ts
└── index.ts
```

Cross-domain communication happens via an event bus in `shared/events/`.

## Consequences

### Positive
- **Discoverability**: New developers can understand one domain at a time
- **Maintainability**: Changes are contained within domains
- **Scalability**: Easy to add new domains without affecting existing ones
- **Deletability**: Removing a feature is as simple as deleting its directory
- **Team autonomy**: Multiple developers can work on different domains simultaneously

### Negative
- **Shared code decisions**: Need clear guidelines for what goes in `shared/`
- **Initial complexity**: Slightly more files than horizontal approach
- **Cross-domain features**: Requires event-driven patterns for domain communication

### Mitigations
- Clear documentation in AGENTS.md about architecture principles
- Event bus for cross-domain communication
- Minimal `shared/` directory (only truly cross-cutting concerns)
- Code review process to enforce domain boundaries
