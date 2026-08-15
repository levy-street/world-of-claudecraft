'use strict';

// Pacing for OS-level notifications.
//
// The renderer decides WHAT is worth notifying about, but it does not get to
// decide how often the operating system's notification surface is used: a bug,
// a reconnect loop, or a hostile page in the window could turn one event into a
// stream of toasts the player has to dismiss outside the game. So the floor
// lives here, on the trusted side of the bridge, and is applied per kind so a
// noisy source cannot starve a quiet one. A per-session TOTAL cap sits on top
// of the floor: the strings a toast carries are clamped but still
// attacker-influenced, so the floor alone would let a hostile page keep a slow
// social-engineering drip going for as long as the game stays open.
//
// Pure and dependency-injected (no electron import here): the clock arrives as a
// function, so tests/electron_notify_guard.test.ts drives every window boundary
// without an Electron runtime.

/** The floor between two shown notifications of the same kind. */
const NOTIFY_MIN_INTERVAL_MS = 10000;

/**
 * The per-session ceiling on notifications shown, across ALL kinds. The same
 * posture as diagnostics.cjs's MAX_MIRRORED_CONSOLE_LINES: the surface a page
 * can influence is bounded per session, and reaching the bound is terminal (a
 * reopening cap would just be a slower drip of the same spam). Generous on
 * purpose: the per-kind floor already paces legitimate use to a handful per
 * minute, so no real session gets anywhere near fifty toasts; only a source
 * grinding the floor for a whole session does, and that is the source this
 * exists to silence.
 */
const MAX_NOTIFICATIONS_PER_SESSION = 50;

/**
 * Validated at the boundary rather than trusted: a zero or negative floor would
 * silently disable the rate limit this module exists to be, and a non-finite one
 * would refuse every notification forever. Both are constructor-time mistakes,
 * so they fail loudly here instead of turning into a runtime the caller has to
 * diagnose.
 */
function requirePositiveInterval(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`createNotifyGuard: ${label} must be a finite number greater than zero`);
  }
}

/**
 * A count boundary, validated with the same posture as the interval: zero or
 * negative would silence the surface entirely, and a fractional cap is a wiring
 * mistake, so both fail loudly at construction.
 */
function requirePositiveCount(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`createNotifyGuard: ${label} must be a positive integer`);
  }
}

/**
 * Build the per-kind notification rate limit. Returns the one question the shell
 * asks it: may this kind be shown right now.
 */
function createNotifyGuard({
  now,
  minIntervalMs = NOTIFY_MIN_INTERVAL_MS,
  sessionMax = MAX_NOTIFICATIONS_PER_SESSION,
}) {
  requirePositiveInterval(minIntervalMs, 'minIntervalMs');
  requirePositiveCount(sessionMax, 'sessionMax');
  if (typeof now !== 'function') {
    throw new TypeError('createNotifyGuard: now must be a function');
  }

  // Keyed by kind, and the key space is the closed whitelist the handler
  // validates before asking, so this cannot grow with untrusted input.
  const lastShownAt = new Map();

  // How many notifications this session has actually shown, across all kinds:
  // the session cap is about the OS surface as a whole, so a per-kind count
  // would multiply the ceiling by the kind whitelist.
  let shownThisSession = 0;

  return {
    /**
     * Whether a notification of this kind may be shown, stamping the kind's
     * window when it may. A REFUSED call leaves the stamp alone: stamping on
     * refusal would let a caller inside the floor push the window out
     * indefinitely, so a source that keeps asking would never show anything.
     * The session cap spends only on notifications that really show (a refusal
     * never showed anything), and reaching it is a silent, terminal drop: this
     * is a best-effort surface, and the log-worthy story (a page grinding the
     * floor) is already visible in the refusal pattern upstream.
     */
    allow: (kind) => {
      // Fail closed on a non-string kind: the caller validates first, and a
      // junk key here would take a window of its own.
      if (typeof kind !== 'string') return false;
      if (shownThisSession >= sessionMax) return false;
      const at = now();
      const last = lastShownAt.get(kind);
      if (last !== undefined && at - last < minIntervalMs) return false;
      lastShownAt.set(kind, at);
      shownThisSession += 1;
      return true;
    },
  };
}

module.exports = {
  MAX_NOTIFICATIONS_PER_SESSION,
  NOTIFY_MIN_INTERVAL_MS,
  createNotifyGuard,
};
