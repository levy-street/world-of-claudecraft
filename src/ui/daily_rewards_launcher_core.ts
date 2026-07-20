// Pure decision core for the daily-rewards chest-launcher poll. While the
// window is closed the launcher needs only a slow status poll, because every
// window open, close, and spin delivers or forces a fresh status through the
// onStatus/onClose wiring in hud.ts; the predicate lives here, host-agnostic,
// so the throttle arithmetic and force bypass are unit-tested directly
// instead of buried in the Hud coordinator.
//
// The hud stamps BEFORE its fetch resolves, so a failed fetch also waits out
// the window before an unforced retry. Deliberate: resetting the stamp on
// failure would retry every slow tick for every client during a server
// outage, and the conservative face of a missed status is a missing glow,
// never a wrong one (open, close, and spin still force freshness).

/** Closed-window launcher poll floor; interactions bypass it via force. */
export const DAILY_REWARDS_LAUNCHER_THROTTLE_MS = 300_000;

/**
 * Whether a launcher refresh may fetch now: forced refreshes always may,
 * unforced ones at most once per throttle window since the last stamp.
 * The very first unforced tick after boot is inside the window (a zero
 * stamp), which is fine: boot wiring issues a forced refresh itself.
 */
export function shouldRefreshDailyRewardsLauncher(
  force: boolean,
  now: number,
  lastRefreshAt: number,
  throttleMs: number = DAILY_REWARDS_LAUNCHER_THROTTLE_MS,
): boolean {
  return force || now - lastRefreshAt >= throttleMs;
}
