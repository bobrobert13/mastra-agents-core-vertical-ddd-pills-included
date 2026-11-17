#!/bin/bash
# Initialize the project: install deps, create .env if absent, print next step.

set -e

echo "Initializing mastra-boilerplate..."

NODE_MAJOR=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22+ required. Current version: $(node --version)"
  exit 1
fi

npm install --legacy-peer-deps

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ".env created from .env.example — every variable is optional."
else
  echo ".env already exists."
fi

echo ""
echo "Done. Start the app with: npm run dev"
