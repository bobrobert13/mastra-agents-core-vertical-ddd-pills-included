#!/bin/bash
# Health check script for Mastra Boilerplate.
# Zero-config safe: missing .env / DB / API keys are WARNINGS, never failures.
# Fatal only when the running instance itself is unhealthy.

set -u

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

success() { echo -e "${GREEN}✓${NC} $1"; }
error()   { echo -e "${RED}✗${NC} $1"; }
warning() { echo -e "${YELLOW}⚠${NC} $1"; }

PORT="${MASTRA_PORT:-4111}"
BASE="http://localhost:${PORT}"
FAIL=0

# Load .env values (if present) without failing on comments
ENVLINE() { [ -f ".env" ] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }

echo "🔍 Running health checks (port ${PORT})..."
echo ""

# 1. Mastra server
echo "1. Checking Mastra server..."
if curl -f -s "${BASE}/health" > /dev/null 2>&1; then
  success "Mastra server is healthy"
else
  error "Mastra server is not responding at ${BASE} (start it with: npm run dev)"
  FAIL=1
fi

# 2. Registered agents (functional API response, not just TCP)
echo "2. Checking agent API..."
AGENTS_JSON=$(curl -f -s "${BASE}/api/agents" 2>/dev/null || true)
AGENTS_COUNT=$(echo "$AGENTS_JSON" | grep -o '"name"' | wc -l)
if [ -n "$AGENTS_JSON" ] && [ "$AGENTS_COUNT" -ge 4 ]; then
  success "API exposes ${AGENTS_COUNT} agents"
elif [ -n "$AGENTS_JSON" ]; then
  error "API exposed only ${AGENTS_COUNT} agents (expected 4)"
  FAIL=1
else
  error "GET /api/agents returned no data"
  FAIL=1
fi

# 3. Workflows API
echo "3. Checking workflows API..."
if curl -f -s "${BASE}/api/workflows" | grep -q '"deep-research"'; then
  success "deep-research workflow is exposed"
else
  error "deep-research workflow missing from GET /api/workflows"
  FAIL=1
fi

# 4. Storage mode (informational — the app boots with none of these set)
echo "4. Checking storage configuration..."
DB_URL="${DATABASE_URL:-$(ENVLINE DATABASE_URL)}"
LIBSQL_URL="${LIBSQL_URL:-$(ENVLINE LIBSQL_URL)}"
if [ -n "$DB_URL" ]; then
  success "PostgreSQL mode (DATABASE_URL set)"
  if command -v psql > /dev/null 2>&1; then
    if psql "$DB_URL" -c '\q' 2>/dev/null; then
      success "Database connection successful"
    else
      error "DATABASE_URL set but connection failed"
      FAIL=1
    fi
  else
    warning "psql not available, live connection not probed"
  fi
elif [ -n "$LIBSQL_URL" ]; then
  success "LibSQL mode (LIBSQL_URL=${LIBSQL_URL})"
else
  success "LibSQL default fallback (file:./mastra.db) — zero-config mode"
fi

# 5. Model providers (informational: agents 401 at call time without keys)
echo "5. Checking model provider keys..."
PROVIDERS_FOUND=0
for KEY in DEEPINFRA_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_API_KEY; do
  VAL="${!KEY:-$(ENVLINE $KEY)}"
  if [ -n "$VAL" ]; then
    success "$KEY configured"
    PROVIDERS_FOUND=$((PROVIDERS_FOUND + 1))
  fi
done
if [ "$PROVIDERS_FOUND" -eq 0 ]; then
  warning "No provider API keys set — generation calls will fail until one is configured (.env.example)"
fi

# 6. Project layout
echo "6. Checking required paths..."
if [ -d "src/mastra" ]; then
  success "Directory src/mastra exists"
else
  error "Directory src/mastra missing"
  FAIL=1
fi

# 7. Dependencies
echo "7. Checking dependencies..."
if [ -d "node_modules" ]; then
  success "Dependencies installed"
else
  error "node_modules not found. Run 'npm install --legacy-peer-deps'"
  FAIL=1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}✅ All health checks passed!${NC}"
else
  echo -e "${RED}❌ Health checks reported failures.${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit $FAIL
