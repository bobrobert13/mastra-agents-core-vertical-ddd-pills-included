#!/usr/bin/env bash
# =============================================================================
# Chaos trial (Spec 02, OKR #1) — MANUAL TIER, not a CI job.
# Requires: docker + the prod compose stack up (redis + postgres + 3x api +
# orchestration + scheduler + background-tasks) run from the docker/ dir.
#
# Loop: start a deep-research run against the api → kill the api container
# that answered → bring the stack back up → poll run state.
# Assertion: the run reaches a terminal state (success|failed|paused|canceled)
# OR is observably still `running` in the workflows API — NEVER 404/vanished.
# (No DLQ / no auto-retry: a run stuck in `running` after a mid-step crash is
# a documented Mastra limitation, not a failure — see ADR-005.)
#
# Usage:  TRIALS=10 bash tests/chaos/api-kill.sh   (default 10)
# =============================================================================
set -euo pipefail

TRIALS="${TRIALS:-10}"
API_URL="${API_URL:-http://localhost:4111}"
COMPOSE_DIR="${COMPOSE_DIR:-docker}"
COMPOSE_FILE="docker-compose.prod.yml"
POLL_TIMEOUT="${POLL_TIMEOUT:-180}"

pass=0; fail=0
for i in $(seq 1 "$TRIALS"); do
  echo "── trial ${i}/${TRIALS} ──────────────────────────────"
  RESP="$(curl -sf -X POST "${API_URL}/api/workflows/deep-research/start" \
    -H 'content-type: application/json' \
    -d "{\"inputData\":{\"query\":\"chaos-trial-${i}\",\"maxSources\":2}}" || true)"
  RUN_ID="$(printf '%s' "$RESP" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).runId||"")}catch{console.log("")}})')"
  [ -n "$RUN_ID" ] || { echo "FAIL: could not start run"; fail=$((fail+1)); continue; }

  # Kill one api container (compose scales share the service name; kill any one
  # api replica container to exercise the crash path)
  API_CONTAINER="$(docker compose -f "$COMPOSE_FILE" ps --format '{{.Name}}' api | head -n1)"
  ( cd "$COMPOSE_DIR" && docker compose -f "$COMPOSE_FILE" kill "${API_CONTAINER##*/}" ) || true
  ( cd "$COMPOSE_DIR" && docker compose -f "$COMPOSE_FILE" up -d api ) >/dev/null

  # Poll run state until terminal, observably running, or timeout
  deadline=$(( $(date +%s) + POLL_TIMEOUT )); state="unknown"
  while [ "$(date +%s)" -lt "$deadline" ]; do
    STATE_JSON="$(curl -sf "${API_URL}/api/workflows/deep-research/runs/${RUN_ID}" || true)"
    if [ -n "$STATE_JSON" ]; then
      state="$(printf '%s' "$STATE_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).status||JSON.parse(d).state||"?")}catch{console.log("?")}})')"
      case "$state" in
        success|failed|paused|canceled|running|waiting|suspended) break ;;
      esac
    fi
    sleep 3
  done

  if [ "$state" = "unknown" ]; then
    echo "FAIL trial ${i}: run ${RUN_ID} vanished (no state after ${POLL_TIMEOUT}s)"
    fail=$((fail+1))
  else
    echo "PASS trial ${i}: run ${RUN_ID} state=${state} (terminal-or-observable)"
    pass=$((pass+1))
  fi
done

echo "──────────────────────────────────────────────────────"
echo "chaos result: ${pass}/${TRIALS} visible, ${fail} lost"
[ "$fail" -eq 0 ] || exit 1
