#!/usr/bin/env bash
# Self-update: pull the configured branch, reinstall, rebuild, restart the
# server. Broadcasts an optional maintenance warning and flips a .maintenance
# flag while the work runs so the app can serve a maintenance page.
#
# Usage:
#   sudo bash scripts/admin/update.sh
#   WOC_WARN_SECONDS=60 WOC_BRANCH=main sudo bash scripts/admin/update.sh
#
# Invoked by the admin API (POST /admin/api/update) and/or a systemd timer.
# Idempotent; exits non-zero on any failure with the offending step logged.

set -euo pipefail

WOC_HOME="${WOC_HOME:-$(cd "$(dirname "$0")/../.." && pwd)}"
WOC_WARN_SECONDS="${WOC_WARN_SECONDS:-300}"
WOC_BRANCH="${WOC_BRANCH:-main}"
WOC_LOG_FILE="${WOC_LOG_FILE:-/var/log/woc-update.log}"
WOC_REMOTE="${WOC_REMOTE:-origin}"
WOC_SERVICE="${WOC_SERVICE:-world-of-claudecraft.service}"
MAINT_FLAG="${WOC_HOME}/.maintenance"

LOG() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$WOC_LOG_FILE"; }
ERR() { LOG "ERROR: $*"; rm -f "$MAINT_FLAG" 2>/dev/null || true; exit 1; }
trap 'ERR "interrupted at line $LINENO"' INT TERM

cd "$WOC_HOME" || ERR "cd $WOC_HOME failed"
LOG "==== update start (branch=$WOC_BRANCH warn=${WOC_WARN_SECONDS}s) ===="

# Optional pre-downtime warning window.
if [ "$WOC_WARN_SECONDS" -gt 0 ]; then LOG "waiting ${WOC_WARN_SECONDS}s before downtime…"; sleep "$WOC_WARN_SECONDS"; fi

touch "$MAINT_FLAG"; LOG "maintenance flag set"
LOG "git fetch + pull…";   git fetch "$WOC_REMOTE" "$WOC_BRANCH" >>"$WOC_LOG_FILE" 2>&1 || ERR "fetch failed"
git checkout "$WOC_BRANCH" >>"$WOC_LOG_FILE" 2>&1 || ERR "checkout failed"
git pull --ff-only "$WOC_REMOTE" "$WOC_BRANCH" >>"$WOC_LOG_FILE" 2>&1 || ERR "git pull failed — resolve manually, then re-run"
LOG "npm install…";        npm install --no-audit --no-fund >>"$WOC_LOG_FILE" 2>&1 || ERR "npm install failed"
LOG "npm run build…";      npm run build >>"$WOC_LOG_FILE" 2>&1 || ERR "build failed"
if npm run | grep -q "build:server"; then
  LOG "npm run build:server…"; npm run build:server >>"$WOC_LOG_FILE" 2>&1 || ERR "server build failed"
fi
LOG "restarting ${WOC_SERVICE}…"; systemctl restart "$WOC_SERVICE" || ERR "service restart failed"
sleep 3
[ "$(systemctl is-active "$WOC_SERVICE")" = "active" ] || ERR "$WOC_SERVICE not active after restart"

rm -f "$MAINT_FLAG"; LOG "maintenance flag cleared"
LOG "==== update done ===="
