#!/bin/bash
# Update Mastra packages to latest versions

set -e

echo "🔄 Updating Mastra packages..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

success() { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${YELLOW}→${NC} $1"; }

# Update all Mastra packages
info "Updating @mastra/core..."
npm install @mastra/core@latest

info "Updating @mastra/memory..."
npm install @mastra/memory@latest

info "Updating @mastra/observability..."
npm install @mastra/observability@latest

info "Updating @mastra/evals..."
npm install @mastra/evals@latest

info "Updating @mastra/pg..."
npm install @mastra/pg@latest

info "Updating mastra CLI..."
npm install mastra@latest

# Run codemod if there are breaking changes
echo ""
info "Checking for migration scripts..."
if npx @mastra/codemod@latest --check 2>/dev/null; then
  info "Running codemod for compatibility..."
  npx @mastra/codemod@latest v1
  success "Codemod applied successfully"
else
  success "No migrations needed"
fi

# Update lock file
info "Updating lock file..."
npm install

# Run tests
echo ""
info "Running tests to verify update..."
if npm run test:unit 2>/dev/null; then
  success "All tests passed"
else
  echo -e "${YELLOW}⚠${NC} Some tests failed. Please review the changes."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Update complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Review the changes and commit when ready:"
echo "  git add ."
echo "  git commit -m 'chore: update Mastra packages'"
echo ""
