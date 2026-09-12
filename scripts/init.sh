#!/bin/bash
# Deep initialization script for Mastra Boilerplate

set -e

echo "🚀 Initializing Mastra Boilerplate..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
success() { echo -e "${GREEN}✓${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }
warning() { echo -e "${YELLOW}⚠${NC} $1"; }
info() { echo -e "${GREEN}→${NC} $1"; }

# 1. Check Node.js version
info "Checking Node.js version..."
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  error "Node.js 22+ required. Current version: $(node --version)"
fi
success "Node.js $(node --version)"

# 2. Check npm
info "Checking npm..."
NPM_VERSION=$(npm --version)
success "npm v${NPM_VERSION}"

# 3. Install dependencies
info "Installing dependencies..."
if [ -f "package-lock.json" ]; then
  npm ci
else
  npm install
fi
success "Dependencies installed"

# 4. Setup environment file
info "Setting up environment..."
if [ ! -f ".env" ]; then
  cp .env.example .env
  warning ".env file created from .env.example"
  warning "Please configure .env with your credentials before proceeding"
else
  success ".env file already exists"
fi

# 5. Check database configuration
info "Checking database configuration..."
if grep -q "DATABASE_URL=postgresql://" .env 2>/dev/null; then
  success "Database URL configured"
else
  warning "Database URL not configured. Please set DATABASE_URL in .env"
fi

# 6. Check API keys
info "Checking API keys..."
if grep -q "DEEPINFRA_API_KEY=." .env 2>/dev/null; then
  success "DeepInfra API key configured"
else
  warning "DeepInfra API key not configured. Set DEEPINFRA_API_KEY in .env"
fi

# 7. Create workspace directory
info "Creating workspace directory..."
mkdir -p workspace
success "Workspace directory created"

# 8. Run database migrations (if database is available)
info "Checking database connectivity..."
if command -v psql &> /dev/null && grep -q "DATABASE_URL=postgresql://" .env 2>/dev/null; then
  source .env
  if psql "$DATABASE_URL" -c '\q' 2>/dev/null; then
    success "Database connection successful"
    info "Running migrations..."
    npm run migrate || warning "Migrations failed or already applied"
  else
    warning "Cannot connect to database. Skipping migrations."
  fi
else
  warning "Database not configured or psql not available. Skipping migrations."
fi

# 9. Build the application
info "Building application..."
npm run build || warning "Build failed. This is normal for initial setup."

# 10. Run smoke tests
info "Running smoke tests..."
if npm run test:smoke 2>/dev/null; then
  success "Smoke tests passed"
else
  warning "Smoke tests failed or not configured yet"
fi

# 11. Initialize git (if not already initialized)
if [ ! -d ".git" ]; then
  info "Initializing git repository..."
  git init
  git add .
  git commit -m "Initial commit from Mastra Boilerplate"
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
echo "  1. Configure .env with your API keys and database credentials"
echo "  2. Start PostgreSQL: cd docker && docker-compose up -d postgres"
echo "  3. Run migrations: npm run migrate"
echo "  4. Start development: npm run dev"
echo "  5. Visit http://localhost:4111 for Mastra Studio"
echo ""
echo "📚 Documentation:"
echo "  - README.md: Main documentation"
echo "  - docs/ARCHITECTURE.md: Architecture decisions"
echo "  - docs/DEPLOYMENT.md: Deployment guide"
echo "  - docs/TESTING.md: Testing strategy"
echo ""
