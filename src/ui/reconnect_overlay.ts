// Full-screen notice shown while the game socket is auto-retrying after an
// unexpected drop. The server holds the character in-world (linkdead) during
// the retry window, so this is a pause, not a logout: the overlay blocks
// input until the world resumes (hide) or the session ends for good (main.ts
// then swaps in its fatal disconnect overlay).
//
// Shows a live attempt count and retry countdown (ticked every second) rather
// than a static string: on a lossy/throttled connection a single retry cycle
// can run up to RECONNECT_MAX_DELAY_MS (src/net/online.ts), and a frozen
// message with no feedback is indistinguishable from a hung client.
//
// SHOW GRACE: the overlay mounts only once the drop has persisted for
// SHOW_GRACE_MS. A transient blip (a server restart mid-deploy, a wifi
// hiccup, a load-balancer idle close) reconnects on the first retry, and
// mounting instantly painted a full-screen near-black veil for well under a
// second (measured 0.8-0.9s from socket close to resume in an instrumented
// client): the intermittent "black flash" players reported in online modes.
// A quick resume now shows nothing at all; a real outage still surfaces the
// overlay, just SHOW_GRACE_MS later, which the frozen world already implies.
// hideReconnectOverlay cancels a pending mount, and repeat show calls while
// one is pending only refresh the attempt/retry payload it will mount with.

import { t } from './i18n';
import { secondsUntilRetry } from './reconnect_status_core';

const OVERLAY_ID = 'reconnect-overlay';
const TICK_MS = 1000;
// Sized to clear attempt 1's ENTIRE retry window, not just its typical draw:
// the first retry fires at computeBackoffDelay(1, RECONNECT_BASE_DELAY_MS,
// ...) = 500 to 1500ms (src/net/backoff.ts full-jitter band), and the socket
// reopen plus auth handshake lands on top of that. A grace inside the band
// (the first cut used 1500ms) still let a top-of-band draw resume around
// 1.8s, mounting the veil at 1.5s and tearing it down moments later: the same
// flash, shorter. 1500ms band ceiling + 1000ms handshake margin = 2500ms,
// pinned against the live constants in tests/reconnect_overlay.test.ts.
export const RECONNECT_OVERLAY_SHOW_GRACE_MS = 2500;

let tickTimer: number | null = null;
let graceTimer: number | null = null;
let pendingShow: { attempt: number; maxAttempts: number; nextRetryAtMs: number } | null = null;

export function showReconnectOverlay(
  attempt: number,
  maxAttempts: number,
  nextRetryAtMs: number,
): void {
  // Already mounted (the drop outlived the grace): update in place, no re-grace.
  if (document.getElementById(OVERLAY_ID)) {
    mountOrUpdateOverlay(attempt, maxAttempts, nextRetryAtMs);
    return;
  }
  pendingShow = { attempt, maxAttempts, nextRetryAtMs };
  if (graceTimer === null) {
    graceTimer = window.setTimeout(() => {
      graceTimer = null;
      const p = pendingShow;
      pendingShow = null;
      if (p) mountOrUpdateOverlay(p.attempt, p.maxAttempts, p.nextRetryAtMs);
    }, RECONNECT_OVERLAY_SHOW_GRACE_MS);
  }
}

function mountOrUpdateOverlay(attempt: number, maxAttempts: number, nextRetryAtMs: number): void {
  let el = document.getElementById(OVERLAY_ID);
  let messageEl: HTMLElement;
  if (el) {
    messageEl = el.firstElementChild as HTMLElement;
  } else {
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.className = 'fatal-overlay';
    messageEl = document.createElement('div');
    el.appendChild(messageEl);
    document.body.appendChild(el);
  }

  const render = () => {
    const seconds = secondsUntilRetry(nextRetryAtMs, Date.now());
    // Once the countdown hits 0 the real retry is imminent (it fires from a
    // setTimeout scheduled at the same delay this counts down), but the
    // interval keeps repainting "0s" with a stale attempt number until the
    // next drop calls showReconnectOverlay again. Swap to a distinct
    // "retrying now" message so a slow final second does not look hung.
    messageEl.textContent =
      seconds > 0
        ? t('loading.reconnectingAttempt', { attempt, maxAttempts, seconds })
        : t('loading.reconnectingNow', { attempt, maxAttempts });
  };
  render();

  if (tickTimer !== null) window.clearInterval(tickTimer);
  tickTimer = window.setInterval(render, TICK_MS);
}

export function hideReconnectOverlay(): void {
  if (graceTimer !== null) {
    window.clearTimeout(graceTimer);
    graceTimer = null;
  }
  pendingShow = null;
  document.getElementById(OVERLAY_ID)?.remove();
  if (tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
}
