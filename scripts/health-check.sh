#!/bin/bash
# Probe a running instance's /health endpoint.

set -u

PORT="${MASTRA_PORT:-4111}"
BASE="http://localhost:${PORT}"

echo "Checking ${BASE}/health ..."
if curl -f -s "${BASE}/health" > /dev/null 2>&1; then
  echo "OK: Mastra is healthy"
  exit 0
fi

echo "FAIL: no healthy response from ${BASE}/health (start it with: npm run dev)"
exit 1
