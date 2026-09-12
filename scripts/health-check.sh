#!/bin/bash
# Health check script for Mastra Boilerplate

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

success() { echo -e "${GREEN}✓${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }
warning() { echo -e "${YELLOW}⚠${NC} $1"; }

echo "🔍 Running health checks..."
echo ""

# Check Mastra server
echo "1. Checking Mastra server..."
if curl -f -s http://localhost:4111/health > /dev/null 2>&1; then
  success "Mastra server is healthy"
else
  error "Mastra server is not responding"
  exit 1
fi

# Check database connection
echo "2. Checking database connection..."
if [ -f ".env" ]; then
  source .env
  if command -v psql &> /dev/null && [ -n "$DATABASE_URL" ]; then
    if psql "$DATABASE_URL" -c '\q' 2>/dev/null; then
      success "Database connection successful"
    else
      error "Cannot connect to database"
      exit 1
    fi
  else
    warning "Database check skipped (psql not available or DATABASE_URL not set)"
  fi
else
  warning ".env file not found"
fi

# Check API keys
echo "3. Checking API keys..."
if [ -f ".env" ]; then
  if grep -q "DEEPINFRA_API_KEY=." .env 2>/dev/null; then
    success "DeepInfra API key configured"
  else
    warning "DeepInfra API key not configured"
  fi
else
  warning ".env file not found"
fi

# Check required directories
echo "4. Checking required directories..."
for dir in workspace src/mastra; do
  if [ -d "$dir" ]; then
    success "Directory $dir exists"
  else
    error "Directory $dir missing"
    exit 1
  fi
done

# Check Node modules
echo "5. Checking dependencies..."
if [ -d "node_modules" ]; then
  success "Dependencies installed"
else
  error "node_modules not found. Run 'npm install'"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ All health checks passed!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
