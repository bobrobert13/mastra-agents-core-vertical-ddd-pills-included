# Mastra Boilerplate

Self-updating Mastra boilerplate with vertical slicing architecture, high availability, and comprehensive testing.

## 🎯 Features

- **Vertical Slicing Architecture**: Domain-driven design with maximum cohesion
- **High Availability**: Docker Compose with separated workers (API, Orchestration, Scheduler, Background)
- **PostgreSQL + pgvector**: Production-ready database with vector support for RAG
- **Multi-Region Support**: Configurable via environment variables
- **Comprehensive Testing**: Unit, integration, and E2E tests with Mastra Evals
- **Auto-Update**: Renovate + changesets for automatic dependency updates
- **Observability**: Built-in tracing, logging, and metrics
- **Example Domains**: 4 reference domains (research, task-management, file-operations, communication)

## 📋 Prerequisites

- Node.js 22.13.0 or later
- PostgreSQL 16+ with pgvector extension
- npm or yarn

## 🚀 Quick Start

### 1. Initialize the project

```bash
# Clone or create the project
git clone <your-repo-url>
cd mastra-boilerplate

# Run initialization script
npm run init
```

### 2. Configure environment

```bash
# Edit .env with your credentials
nano .env
```

Required:
- `DEEPINFRA_API_KEY` (or other model provider keys)
- `DATABASE_URL` (PostgreSQL connection string)
- `MASTRA_JWT_SECRET` (for API authentication)

### 3. Start PostgreSQL

```bash
cd docker
docker-compose up -d postgres
```

### 4. Run migrations

```bash
npm run migrate
```

### 5. Start development server

```bash
npm run dev
```

Visit http://localhost:4111 for Mastra Studio.

## 🏗️ Architecture

### Vertical Slicing

The project is organized by business domains, not technical layers:

```
src/mastra/
├── domains/
│   ├── research/          # Web research domain
│   │   ├── agent.ts
│   │   ├── tools/
│   │   ├── workflows/
│   │   └── scorers/
│   ├── task-management/   # Task management domain
│   ├── file-operations/   # File operations domain
│   └── communication/     # Communication domain
├── shared/                # Cross-domain utilities
└── infrastructure/        # Database, observability, external services
```

### High Availability

Production deployment uses separated workers:

```
┌─────────────┐     ┌──────────────────┐
│   API       │────▶│  Orchestration   │
│  (3 reps)   │     │    (2 reps)      │
└─────────────┘     └──────────────────┘
                            │
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                    ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Scheduler  │     │  Background │     │  PostgreSQL │
│  (1 rep)    │     │   (2 reps)  │     │  (pgvector) │
└─────────────┘     └─────────────┘     └─────────────┘
```

## 🧪 Testing

### Run all tests

```bash
npm run test:all
```

### Run specific test suites

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# E2E evaluations with Mastra Evals
npm run test:evals

# Smoke tests
npm run test:smoke
```

### Testing strategy

- **Unit tests**: Fast, deterministic tests for individual components
- **Integration tests**: Cross-domain and workflow tests
- **Evals**: LLM-based quality evaluation with gates and scorers
- **CI/CD**: Automated testing on every push/PR

## 📦 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run init` | Initialize project |
| `npm run migrate` | Run database migrations |
| `npm run health-check` | Verify system health |
| `npm run update` | Update Mastra packages |
| `npm run test` | Run all tests |
| `npm run lint` | Lint code |
| `npm run format` | Format code |

## 🐳 Docker

### Development

```bash
cd docker
docker-compose up
```

### Production (High Availability)

```bash
cd docker
docker-compose -f docker-compose.prod.yml up -d
```

### Multi-Region (Optional)

```bash
# Enable in .env
ENABLE_MULTI_REGION=true
PRIMARY_REGION=us-east-1
SECONDARY_REGION=eu-west-1

# Start with multi-region config
docker-compose -f docker-compose.multi-region.yml up -d
```

## 📚 Documentation

- [Architecture](docs/ARCHITECTURE.md) - Design decisions and patterns
- [Deployment](docs/DEPLOYMENT.md) - Production deployment guide
- [Testing](docs/TESTING.md) - Testing strategy and best practices
- [Domains](docs/domains/) - Documentation for each domain

## 🔧 Configuration

### Environment Variables

See `.env.example` for all available configuration options.

Key variables:
- `DEEPINFRA_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` - Model provider API keys (set one)
- `MODEL` / `MODEL_<AGENT>` - Provider-agnostic model selection, e.g. `MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731`
- `DATABASE_URL` - PostgreSQL connection string
- `ENABLE_MULTI_REGION` - Enable multi-region support
- `MASTRA_WORKERS` - Worker role assignment
- `LOG_LEVEL` - Logging verbosity

### Multi-Region

Enable multi-region support by setting:

```bash
ENABLE_MULTI_REGION=true
PRIMARY_REGION=us-east-1
SECONDARY_REGION=eu-west-1
```

## 🔄 Auto-Update

The boilerplate includes automatic dependency updates via Renovate:

- Updates Mastra packages automatically
- Runs tests before merging
- Creates PRs for review
- Uses changesets for changelog

Manual update:

```bash
npm run update
```

## 📊 Monitoring

Basic monitoring is built-in:

- **Health checks**: `GET /health` endpoint
- **Observability**: Tracing, logging, metrics via `@mastra/observability`
- **Scripts**: `npm run health-check` for system verification

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test:all`
5. Submit a pull request

## 📄 License

MIT

## 🙏 Acknowledgments

- [Mastra Framework](https://mastra.ai) - AI agent framework
- [Vertical Slice Architecture](https://jeremydmiller.com/2026/06/04/the-codebase-is-the-prompt-wolverine-vertical-slices-and-ai-assisted-development/)
- [Domain-Driven Design for AI Agents](https://slavadubrov.github.io/blog/2025/10/20/domain-driven-design-ai-agents/)
