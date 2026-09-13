#!/bin/bash
# Update all Mastra packages to their latest versions, then re-run the gate.
# NOTE: every npm install here uses --legacy-peer-deps on purpose
# (@mastra/evals ↔ vitest peer conflict; see root AGENTS.md gotcha #1).

set -e

echo "🔄 Updating Mastra packages..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

success() { echo -e "${GREEN}✓${NC} $1"; }
info()    { echo -e "${YELLOW}→${NC} $1"; }
fail()    { echo -e "${RED}✗${NC} $1"; exit 1; }

MASTRA_PACKAGES=(
  "@mastra/core"
  "@mastra/memory"
  "@mastra/observability"
  "@mastra/evals"
  "@mastra/pg"
  "@mastra/libsql"
  "mastra"
)

for pkg in "${MASTRA_PACKAGES[@]}"; do
  info "Updating ${pkg}..."
  npm install "${pkg}@latest" --legacy-peer-deps --save-exact=false
done
success "All Mastra packages updated"

# Breaking-change guidance (never auto-rewrite sources from a script like this;
# review codemod output and apply deliberately, then re-run this gate).
echo ""
info "Checking for available codemods..."
npx @mastra/codemod@latest list 2>/dev/null \
  || info "codemod CLI unavailable — check https://mastra.ai/docs for migration notes"

# Re-run the same gate CI enforces
echo ""
info "Running quality gate (lint + typecheck + tests + build)..."
npm run lint
npx tsc --noEmit
npm run test:all
npm run build
success "Quality gate green after update"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Update complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Review the changes and commit when ready:"
echo "  git diff"
echo "  git add package.json package-lock.json"
echo "  git commit -m 'chore(deps): update Mastra packages'"
echo ""
