#!/usr/bin/env bash
# World of ClaudeCraft: game container watchdog.
#
# WHY THIS EXISTS
# Docker's `restart: unless-stopped` policy only fires when the container process
# EXITS. A wedged-but-alive game process (the world loop stops advancing while the
# container keeps holding its port) never exits, so Docker never restarts it: an
# external watcher is the only thing that can. This script is that watcher. The
# compose healthcheck probes the game's `GET /livez`, which answers 503 once the
# world loop has not completed a pass in over 30 seconds; Docker turns repeated 503s
# into a container health status of `unhealthy`; this script reads that status and
# restarts the container.
#
# Docker's own health status is the single source of truth. The watchdog never
# probes the game itself, so it can never disagree with what Docker already
# decided. Two separate guards keep it off a container it should not touch: the
# never-restart-a-draining-container contract below (a drain keeps /livez at 200, so a
# draining container never reports unhealthy), and the running-check, which is what
# covers the window AFTER a drain: a stopped container keeps its last health status, so
# `docker compose stop` can leave it reading `unhealthy`, and only the running-check
# stops the watchdog from fighting the operator who stopped it.
#
# IT MUST NEVER RESTART A DRAINING CONTAINER, AND IT CANNOT.
# A draining process (a deploy, an operator `docker compose stop`) deliberately
# keeps /livez at 200 for the whole shutdown chain, precisely so that a graceful
# drain is never misread as a wedge. A draining container therefore stays
# `healthy`, and this script acts on `unhealthy` and on nothing else. Killing a
# container mid-drain would discard the character saves the drain exists to flush,
# so this is a design contract, not a happy accident. Do not "improve" the
# detection into probing the port directly: that reintroduces the exact race the
# contract closes.
#
# INSTALL (deploy/user-data.sh does this at EC2 first boot; on an already
# provisioned host, run it by hand, see DEPLOY.md)
#   sudo install -m 755 deploy/game_watchdog.sh /usr/local/bin/eastbrook-watchdog
#   sudo install -d -m 755 /var/lib/eastbrook
#   printf '%s\n' '* * * * * root /usr/local/bin/eastbrook-watchdog >> /var/log/eastbrook-watchdog.log 2>&1' \
#     | sudo tee /etc/cron.d/eastbrook-watchdog
#
# DRY RUN (safe anywhere: logs the restart it would issue and changes nothing)
#   /usr/local/bin/eastbrook-watchdog --dry-run
#
# ENV KNOBS
#   WATCHDOG_CONTAINER        container to watch        (default: eastbrook-game)
#   WATCHDOG_COMPOSE_DIR      compose project directory (default: /opt/eastbrook)
#   WATCHDOG_COOLDOWN         seconds between restarts  (default: 300)
#   WATCHDOG_STATE_FILE       last-restart stamp        (default: /var/lib/eastbrook/watchdog-last-restart)
#   WATCHDOG_LOCK_FILE        serialization lock        (default: /var/lib/eastbrook/watchdog.lock)
#   WATCHDOG_INSPECT_TIMEOUT  seconds before a hung docker inspect is abandoned (default: 55)
#   WATCHDOG_RESTART_TIMEOUT  seconds before a hung docker restart is abandoned (default: 150)
#   WATCHDOG_DRY_RUN=1        same as --dry-run
#   WATCHDOG_VERBOSE=1        also log the quiet no-op paths (healthy, not running)

set -euo pipefail

# Cron runs with a minimal PATH (often just /usr/bin:/bin), so docker or flock installed
# under /usr/local/bin or /snap/bin would be invisible and the watchdog would silently
# no-op. APPEND the usual locations (never prepend, so an operator's PATH still wins).
export PATH="${PATH:-}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"

CONTAINER="${WATCHDOG_CONTAINER:-eastbrook-game}"
COMPOSE_DIR="${WATCHDOG_COMPOSE_DIR:-/opt/eastbrook}"
COOLDOWN="${WATCHDOG_COOLDOWN:-300}"
# Same sanitization as the state-file stamp below: a non-numeric operator
# override would make the cooldown comparison error out and fall through to a
# restart with NO cooldown protection, the exact failure the knob exists to
# prevent. Fall back to the default instead.
case "$COOLDOWN" in
  '' | *[!0-9]*) COOLDOWN=300 ;;
esac
STATE_FILE="${WATCHDOG_STATE_FILE:-/var/lib/eastbrook/watchdog-last-restart}"
# Root-owned dir, not world-writable /var/lock: a lockfile opened for write follows
# symlinks, so a world-writable location lets a local user symlink-truncate a root file
# or hold the lock to block wedge recovery. /var/lib/eastbrook is created root-owned.
LOCK_FILE="${WATCHDOG_LOCK_FILE:-/var/lib/eastbrook/watchdog.lock}"
DRY_RUN="${WATCHDOG_DRY_RUN:-0}"
VERBOSE="${WATCHDOG_VERBOSE:-0}"

# A hung docker daemon must not park a run on the flock forever: every later cron
# fire would then exit with the skip line and the wedge would never recover, so
# every docker call below runs under a bound. The inspect bound fits inside the
# one-minute cron interval. The restart bound must EXCEED the container's stop
# grace period (75s in compose): a wedged process ignores SIGTERM and eats the
# full grace before SIGKILL, so a WORKING recovery routinely takes longer than a
# minute, and a tighter bound would misreport the exact restart this script
# exists to issue. 150s bounds only a truly hung daemon. Same sanitization as
# the cooldown: a non-numeric override must not turn into a timeout error.
INSPECT_TIMEOUT="${WATCHDOG_INSPECT_TIMEOUT:-55}"
case "$INSPECT_TIMEOUT" in
  '' | *[!0-9]*) INSPECT_TIMEOUT=55 ;;
esac
RESTART_TIMEOUT="${WATCHDOG_RESTART_TIMEOUT:-150}"
case "$RESTART_TIMEOUT" in
  '' | *[!0-9]*) RESTART_TIMEOUT=150 ;;
esac
# GNU timeout treats a bound of 0 as NO bound at all, so an operator 0 (or 00)
# would silently restore the exact unbounded hang these knobs exist to prevent.
if [ "$INSPECT_TIMEOUT" -eq 0 ]; then INSPECT_TIMEOUT=55; fi
if [ "$RESTART_TIMEOUT" -eq 0 ]; then RESTART_TIMEOUT=150; fi
if command -v timeout >/dev/null 2>&1; then
  # -k 5: TERM at the bound, KILL 5 seconds later. Without the escalation a
  # docker CLI stuck in uninterruptible sleep would shrug off the TERM and the
  # wrapper would wait forever, re-creating the park-on-the-flock hang the
  # bound exists to close.
  bounded() { timeout -k 5 "$@"; }
else
  # coreutils timeout ships on every provisioned host (deploy/user-data.sh boxes
  # are Ubuntu). Where it is genuinely absent (a macOS dry run), degrade to the
  # old unbounded behavior rather than refusing to act.
  bounded() { shift; "$@"; }
fi

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --verbose) VERBOSE=1 ;;
    *)
      printf 'usage: %s [--dry-run] [--verbose]\n' "$0" >&2
      exit 2
      ;;
  esac
done

log() { printf '%s eastbrook-watchdog: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# The no-op paths run every minute from cron. Keep them silent by default: a
# watchdog that writes (or mails) a line a minute is a watchdog someone disables.
quiet_log() {
  if [ "$VERBOSE" = "1" ]; then log "$@"; fi
  return 0
}

if ! command -v docker >/dev/null 2>&1; then
  # Loud, not quiet: docker missing from PATH means the watchdog is installed but can
  # NEVER act. That is a permanent-blindness misconfiguration, worth one line in the log
  # rather than a silent no-op every minute forever.
  log "docker is not on PATH, cannot watch ${CONTAINER}"
  exit 0
fi

# Serialize. A restart takes as long as the container's stop grace period, which is
# longer than the cron interval, so the next fire WILL overlap this one. Acquire the
# lock without blocking and exit 0 when another run holds it: a queue of waiting
# watchdogs is how one wedge turns into two restarts.
if ! command -v flock >/dev/null 2>&1; then
  # Fail safe: with no lock there is no serialization guarantee, so do nothing.
  log "flock is not available, refusing to run unserialized"
  exit 0
fi
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "another watchdog run holds ${LOCK_FILE}, skipping"
  exit 0
fi

# Docker's health status decides, and nothing else. An image built before the
# healthcheck existed has no .State.Health at all, so print an explicit "none"
# rather than letting the template emit "<no value>".
state="$(bounded "$INSPECT_TIMEOUT" docker inspect \
  -f '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
  "$CONTAINER" 2>/dev/null)" || {
  rc=$?
  if [ "$rc" -eq 124 ]; then
    # Loud, not quiet: a hung docker daemon is an active incident, and this line is
    # the only breadcrumb distinguishing it from a plainly absent container.
    log "docker inspect ${CONTAINER} timed out after ${INSPECT_TIMEOUT}s, is the docker daemon hung?"
  elif [ "$rc" -ge 125 ]; then
    # 125/126/127 are wrapper or exec failures (and 137 is the -k KILL
    # escalation), not "container absent": stay loud, because the quiet arm
    # would hide a permanently broken watchdog behind a silent per-minute no-op
    # while 2>/dev/null has already discarded the wrapper's own diagnostic.
    log "docker inspect ${CONTAINER} failed with exit ${rc} (timeout wrapper or exec failure)"
  else
    quiet_log "container ${CONTAINER} does not exist (compose project ${COMPOSE_DIR}), nothing to do"
  fi
  exit 0
}
running="${state%% *}"
health="${state##* }"

if [ "$running" != "true" ]; then
  # Docker's restart policy owns a stopped or exited container. A watchdog that
  # also starts one fights the deploy that deliberately stopped it.
  quiet_log "container ${CONTAINER} is not running (running=${running}, health=${health}), nothing to do"
  exit 0
fi

case "$health" in
  unhealthy) ;;
  none | '')
    quiet_log "container ${CONTAINER} reports no health status (image predates the healthcheck), nothing to do"
    exit 0
    ;;
  *)
    # healthy, or starting (still inside start_period, or restarting right now).
    quiet_log "container ${CONTAINER} is ${health}, nothing to do"
    exit 0
    ;;
esac

# Backoff. After a restart, the healthcheck cannot report `unhealthy` again for at
# least start_period (60s) plus retries times interval (4 x 15s), so any cooldown
# under about two minutes would fire BLIND: it would restart a container that has not
# yet had the chance to say whether the first restart worked. That two-minute floor is
# the real reason for the cooldown. The default (300s) sits above it with margin while
# keeping the down time of a container that re-wedges to about five minutes. Docker's
# `restart: unless-stopped` cannot help here (it only fires on process EXIT, and a
# re-wedge never exits), so the watchdog is the only thing retrying: it keeps retrying
# on this cadence rather than giving up (a persistently wedging server still needs a
# human, but it recovers every cooldown meanwhile), and every restart is one loud log
# line, never a hot loop.
now="$(date -u +%s)"
last=0
if [ -f "$STATE_FILE" ]; then
  last="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
  case "$last" in
    '' | *[!0-9]*) last=0 ;;
  esac
fi
elapsed=$((now - last))
if [ "$last" -gt 0 ] && [ "$elapsed" -lt "$COOLDOWN" ]; then
  log "container ${CONTAINER} is unhealthy but the last watchdog restart was ${elapsed}s ago (cooldown ${COOLDOWN}s), skipping"
  exit 0
fi

# `docker restart <container>` on purpose, not `docker compose restart <service>`:
# compose re-reads the compose file and the host .env, so a half-edited file on disk
# would silently change the container's config at the worst possible moment.
# Restarting the container by name reuses the config it is already running with,
# including its stop grace period (no -t flag, so the container's own StopTimeout
# applies and the shutdown chain gets its full window before SIGKILL).
if [ "$DRY_RUN" = "1" ]; then
  log "DRY RUN: container ${CONTAINER} is unhealthy, would run: docker restart ${CONTAINER}"
  exit 0
fi

log "container ${CONTAINER} is unhealthy, restarting it: docker restart ${CONTAINER}"
mkdir -p "$(dirname "$STATE_FILE")"
# Stamp the cooldown BEFORE the restart: a restart that hangs must still hold it.
printf '%s\n' "$now" > "$STATE_FILE"
if bounded "$RESTART_TIMEOUT" docker restart "$CONTAINER" >/dev/null; then
  log "container ${CONTAINER} restarted"
else
  rc=$?
  if [ "$rc" -eq 124 ]; then
    log "docker restart ${CONTAINER} timed out after ${RESTART_TIMEOUT}s, leaving the container to docker's restart policy"
  else
    log "docker restart ${CONTAINER} FAILED, leaving the container to docker's restart policy"
  fi
  exit 1
fi
