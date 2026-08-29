// The guild pledge rejection ladder: how long a rejected account waits before
// pledging to THAT guild again. Pure arithmetic over caller-supplied
// timestamps (the server owns the wall clock; the sim never reads one), so a
// Vitest drives it directly and both the server's refusal and the UI's copy
// derive the same answer.
//
// Per (guild, account), escalating: one day, then one week, then forever. Any
// guild invite from that guild wipes the ladder (the guild saying "we do want
// you"), which the SERVICE owns; this leaf only answers durations.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Cooldown applied by the Nth rejection (1-based); the third and every later
 *  rejection is permanent. */
export function pledgeRejectCooldownMs(rejectCount: number): number {
  if (rejectCount <= 0) return 0;
  if (rejectCount === 1) return DAY_MS;
  if (rejectCount === 2) return WEEK_MS;
  return Number.POSITIVE_INFINITY;
}

/** The epoch-ms instant a ladder standing thaws, or Infinity for the
 *  permanent tier. `rejectedAtMs` is the LATEST rejection's instant. */
export function pledgeCooldownUntilMs(rejectCount: number, rejectedAtMs: number): number {
  const cooldown = pledgeRejectCooldownMs(rejectCount);
  return Number.isFinite(cooldown) ? rejectedAtMs + cooldown : Number.POSITIVE_INFINITY;
}

/** Whether an account is still frozen out of a guild at `nowMs`. */
export function pledgeCooldownActive(
  rejectCount: number,
  rejectedAtMs: number,
  nowMs: number,
): boolean {
  return pledgeCooldownUntilMs(rejectCount, rejectedAtMs) > nowMs;
}
