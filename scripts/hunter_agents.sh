#!/bin/bash
# Launch LOCAL autonomous hunter agents driven by an LLM PLANNER, on YOUR own server
# (no prod realm, no multi-account detection). Hierarchical "ensemble": the planner
# (Codex CLI and/or Cleo) emits one strategic INTENT every ~8-20s; the proven rule
# executor (scripts/agent/agent_brain.mjs) flies the hunter at 20Hz on top of it.
#
# Usage:
#   scripts/hunter_agents.sh codex      # Codex CLI planner (ChatGPT-login subscription, no API key)
#   CLEO_BASE_URL=http://muse-infinite:PORT/v1 CLEO_MODEL=<id> CLEO_API_KEY=... \
#     scripts/hunter_agents.sh cleo     # Cleo (Hermes) planner via OpenAI-compatible endpoint
#   CLEO_BASE_URL=... CLEO_MODEL=... scripts/hunter_agents.sh both   # both hunters in parallel
#
# Prereqs (run once, in another terminal):  npm run db:up && npm run server
# Local login is plain username/password (Turnstile is auto-off locally), and the
# hunter character is auto-created by the orchestrator on first connect.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

WHICH="${1:-codex}"
SERVER="${SERVER:-http://localhost:8787}"
: "${CXHUNTER_PASS:=devhunter1}"
: "${CLHUNTER_PASS:=devhunter1}"
export CXHUNTER_PASS CLHUNTER_PASS

code=$(curl -s -o /dev/null -w '%{http_code}' "$SERVER/" 2>/dev/null || echo 000)
if [ "$code" = "000" ]; then
  echo "[hunter] local server not reachable at $SERVER"
  echo "         start it first (other terminal):  npm run db:up && npm run server"
  exit 1
fi
echo "[hunter] server up ($SERVER, http $code)"

register() {  # $1=user $2=pass -- idempotent (409 'taken' is fine)
  local out; out=$(curl -s -X POST "$SERVER/api/register" -H 'content-type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" 2>/dev/null || true)
  if echo "$out" | grep -q '"token"'; then echo "[hunter] registered $1"
  elif echo "$out" | grep -qi 'taken\|exists'; then echo "[hunter] account $1 already exists"
  else echo "[hunter] register $1 -> ${out:-<no response>}"; fi
}

launch_codex() {
  register cxhunter "$CXHUNTER_PASS"
  local soul="${AGENT_SOUL_FILE:-scripts/agent/soul.sonzai.md}"
  echo "[hunter] launching SONZAI hunter -- planner = codex exec (ChatGPT login), soul = $soul"
  AGENT_PROVIDER=codex AGENT_PLAN=1 AGENT_SOUL_FILE="$soul" \
    node scripts/multibox.mjs scripts/multibox.hunter.codex.json
}

launch_cleo() {
  : "${CLEO_BASE_URL:?set CLEO_BASE_URL to Cleo's OpenAI-compatible endpoint, e.g. http://muse-infinite:8000/v1}"
  : "${CLEO_MODEL:?set CLEO_MODEL to Cleo's model id}"
  register clhunter "$CLHUNTER_PASS"
  echo "[hunter] launching CLEO hunter (Cleo) -- planner = $CLEO_MODEL @ $CLEO_BASE_URL"
  AGENT_PROVIDER=openai AGENT_PLAN=1 \
    AGENT_BASE_URL="$CLEO_BASE_URL" AGENT_MODEL="$CLEO_MODEL" \
    AGENT_API_KEY="${CLEO_API_KEY:-}" AGENT_RESPONSE_FORMAT="${CLEO_RESPONSE_FORMAT:-0}" \
    node scripts/multibox.mjs scripts/multibox.hunter.cleo.json
}

case "$WHICH" in
  codex) launch_codex ;;
  cleo)  launch_cleo ;;
  both)
    ( launch_codex ) & CX=$!
    if [ -n "${CLEO_BASE_URL:-}" ]; then
      ( launch_cleo ) & CL=$!
      echo "[hunter] both running in parallel (codex pid $CX, cleo pid $CL). Ctrl-C to stop."
    else
      echo "[hunter] CLEO_BASE_URL unset -> running CODEX only. Set CLEO_BASE_URL+CLEO_MODEL to add Cleo."
    fi
    wait
    ;;
  *) echo "usage: $0 [codex|cleo|both]"; exit 1 ;;
esac
