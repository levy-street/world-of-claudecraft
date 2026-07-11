#!/bin/bash
# Supervisor for the 6-hour Gravewyrm 5-man farm. Keeps the orchestrator alive across:
#  - ghost-session launch failures (`fatal: "X" is already in the world`) after a prior logout,
#  - any mid-run crash,
# by retrying the launch (with a wait for ghost sessions to clear) until the 6h window elapses.
# A node run that lasts a long time is the real farm; once it ends we're past the window and stop.
cd /Users/maxc/code/world-of-claudecraft || exit 1
LOG=logs/_gravewyrm_session.out
CFG=scripts/multibox.gravewyrm4.json
WINDOW=36000                 # 10 hours of farming
RETRY_WAIT=90                # ghosts are reclaimed via takeover now, so retries only need to outwait transient errors
DEADLINE=$(( $(date +%s) + WINDOW ))

echo "[supervisor] start $(date '+%F %T'), $((WINDOW / 3600))h window, deadline $(date -r $DEADLINE '+%T')" >> "$LOG"
# brief settle before the first attempt; ghosts are reclaimed via the takeover endpoint, no long wait needed
sleep 15

attempt=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  attempt=$((attempt + 1))
  echo "[supervisor] launch attempt $attempt at $(date '+%T')" >> "$LOG"
  start=$(date +%s)
  node scripts/multibox.mjs "$CFG" >> "$LOG" 2>&1
  dur=$(( $(date +%s) - start ))
  echo "[supervisor] attempt $attempt exited after ${dur}s" >> "$LOG"
  rem=$(( DEADLINE - $(date +%s) ))
  # Only stop when we've reached the 6h window (node ran to its runSeconds, so the deadline is here). Any
  # earlier exit is a crash/ghost/connect-timeout -> wait for ghosts to clear and relaunch to keep farming.
  if [ "$rem" -le 90 ]; then
    echo "[supervisor] reached 6h window, stopping" >> "$LOG"
    break
  fi
  echo "[supervisor] exit after ${dur}s is early (rem ${rem}s) -> waiting ${RETRY_WAIT}s for ghosts, then relaunch" >> "$LOG"
  sleep "$RETRY_WAIT"
done
echo "[supervisor] done $(date '+%T')" >> "$LOG"
