'use strict';

// Display-sleep suppression for controller-only play.
//
// The problem this exists for: keyboard and mouse input resets the operating
// system's idle timer, but GAMEPAD input does not, on any platform we ship. A
// player who runs the game from a couch with a controller is, as far as the OS
// is concerned, idle, so the display sleeps mid-session.
//
// The shape of the answer is a lease, not a switch. The shell holds Electron's
// 'prevent-display-sleep' blocker only while gamepad activity keeps arriving,
// and drops it after a quiet stretch, so walking away from a controller session
// still lets the display sleep the way the player configured it. Two rules keep
// the lease cheap and honest:
//
//  - Pings are rate limited. The renderer reports gamepad activity from its own
//    input loop, which can fire many times a second; without the limit every one
//    of those would cross IPC into a timer re-arm for no change in state.
//  - A hidden window holds nothing. Minimized or hidden means the player is not
//    looking at the game, so keeping the display awake for it would be a bug,
//    not a service. Releasing is immediate rather than waiting out the idle
//    timer.
//
// Pure and dependency-injected (no electron import here): the blocker, the
// timers, and the clock all arrive as functions, so tests/electron_power_save.test.ts
// drives every transition without an Electron runtime.

/** How long after the last gamepad activity the blocker is dropped. */
const POWER_SAVE_IDLE_MS = 60000;

/** The floor between two pings that actually do work. */
const POWER_SAVE_MIN_PING_INTERVAL_MS = 10000;

/**
 * Intervals are validated at the boundary rather than trusted. A zero or
 * negative idleMs would arm a timer that fires immediately and re-arms on the
 * next ping forever, and a non-finite one would arm a timer that never fires at
 * all: both are constructor-time mistakes, so they fail loudly here instead of
 * turning into a runtime the caller has to diagnose.
 */
function requirePositiveInterval(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`createPowerSave: ${label} must be a finite number greater than zero`);
  }
}

/**
 * Build the display-sleep lease. Returns the three signals the shell drives it
 * with: renderer-reported gamepad activity, window hidden-ness, and app quit.
 */
function createPowerSave({
  start,
  stop,
  setTimer,
  clearTimer,
  now,
  idleMs = POWER_SAVE_IDLE_MS,
  minPingIntervalMs = POWER_SAVE_MIN_PING_INTERVAL_MS,
}) {
  requirePositiveInterval(idleMs, 'idleMs');
  requirePositiveInterval(minPingIntervalMs, 'minPingIntervalMs');

  // The live blocker id, or null when nothing is held. Holding the id (rather
  // than a boolean) is what makes the release exact: powerSaveBlocker.stop takes
  // the id of the claim being dropped, and stopping an id twice would release a
  // claim some later start() had been handed.
  let blockerId = null;
  let releaseTimer = null;
  let lastPingAt = null;
  let hidden = false;
  let stopped = false;

  const clearReleaseTimer = () => {
    if (releaseTimer === null) return;
    clearTimer(releaseTimer);
    releaseTimer = null;
  };

  // Drop the claim, if there is one. The held state is cleared BEFORE stop() so
  // there is no window in which a second release could see the same id: the
  // claim is either ours to drop or already gone, never both.
  const release = () => {
    clearReleaseTimer();
    // The rate limit guards redundant work on a LIVE claim, so it is reset with
    // the claim. Otherwise the first ping after an idle release (or after the
    // player un-hides) could be refused for up to minPingIntervalMs, leaving the
    // display unprotected during active play.
    lastPingAt = null;
    if (blockerId === null) return;
    const id = blockerId;
    blockerId = null;
    stop(id);
  };

  return {
    /** Renderer-reported gamepad activity. Cheap to call at input-loop rates. */
    notifyActivity: () => {
      if (stopped || hidden) return;
      const at = now();
      if (lastPingAt !== null && at - lastPingAt < minPingIntervalMs) return;
      lastPingAt = at;
      if (blockerId === null) {
        try {
          blockerId = start('prevent-display-sleep');
        } catch {
          // A platform that cannot block display sleep is not a failure the
          // player should feel: stay unheld, arm nothing, and let the next
          // accepted ping try again.
          return;
        }
      }
      clearReleaseTimer();
      releaseTimer = setTimer(release, idleMs);
    },

    /**
     * Window hidden-ness, from the shell's one presentation derivation. Hiding
     * releases at once; un-hiding claims nothing until real activity arrives,
     * so a background window that is merely revealed never holds the display
     * awake on its own.
     */
    setHidden: (nextHidden) => {
      if (stopped) return;
      hidden = nextHidden === true;
      if (hidden) release();
    },

    /**
     * App quit. Terminal by design: 'will-quit' can be followed by late window
     * events, and none of them may re-arm a timer or take a claim the process is
     * about to leave behind.
     */
    shutdown: () => {
      if (stopped) return;
      stopped = true;
      release();
    },
  };
}

module.exports = {
  POWER_SAVE_IDLE_MS,
  POWER_SAVE_MIN_PING_INTERVAL_MS,
  createPowerSave,
};
