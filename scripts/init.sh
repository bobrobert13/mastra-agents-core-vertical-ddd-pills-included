#!/bin/bash
# Initialization script for Mastra Boilerplate.
# Zero-config safe: the app runs without any setup step below beyond deps.

set -e

echo "🚀 Initializing Mastra Boilerplate..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

success() { echo -e "${GREEN}✓${NC} $1"; }
error()   { echo -e "${RED}✗${NC} $1"; exit 1; }
warning() { echo -e "${YELLOW}⚠${NC} $1"; }
info()    { echo -e "${GREEN}→${NC} $1"; }

# 1. Node.js version
info "Checking Node.js version..."
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  error "Node.js 22+ required. Current version: $(node --version)"
fi
success "Node.js $(node --version)"

# 2. npm
info "Checking npm..."
success "npm v$(npm --version)"

# 3. Install dependencies (--legacy-peer-deps: @mastra/evals ↔ vitest peer conflict)
info "Installing dependencies..."
if [ -f "package-lock.json" ]; then
  npm ci --legacy-peer-deps
else
  npm install --legacy-peer-deps
fi
success "Dependencies installed"

# 4. Environment file (OPTIONAL — app boots zero-config with LibSQL fallback)
info "Setting up environment..."
if [ ! -f ".env" ]; then
  cp .env.example .env
  warning ".env created from .env.example — every variable is optional;"
  warning "set a provider API key (DEEPINFRA_API_KEY, OPENAI_API_KEY, ...) to enable generation."
else
  success ".env already exists"
fi

# 5. Quality gate (mirrors CI: lint strict, build, smoke + unit + integration)
info "Running lint (0 errors / 0 warnings)..."
npm run lint
success "Lint clean"

info "Building application..."
npm run build
success "Build produced .mastra/output/"

info "Running smoke + unit + integration tests..."
npm run test:smoke
npm run test:unit
npm run test:integration
success "Tests passed (structural evals run with 'npm run test:all' / CI)"

# 6. Git
if [ ! -d ".git" ]; then
  info "Initializing git repository..."
  git init
  git add .
  git commit -m "chore: initialize from Mastra Boilerplate"
  success "Git repository initialized"
else
  success "Git repository already exists"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Initialization complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Next steps:"
echo "  1. (Optional) Add a provider API key to .env to enable generation"
echo "  2. npm run dev   # Studio: http://localhost:4111 (watch the service banner)"
echo "  3. npm run health-check   # probe a running instance"
echo "  4. cd docker && docker-compose up -d   # optional PostgreSQL/pgvector stack"
echo ""
echo "📚 Documentation:"
echo "  - README.md: quickstart and features"
echo "  - AGENTS.md: rules, conventions, deployment, self-update"
echo "  - docs/adr/: architecture decision records"
echo "  - docs/TESTING.md: test tiers"
echo ""
