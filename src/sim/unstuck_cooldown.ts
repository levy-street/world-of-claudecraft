// Hidden system cooldowns shared by recovery, competitive resets, and readouts.
// Kept as a pure leaf so those systems do not form a runtime import cycle.
//
// Two entries ride Entity.cooldowns under system ids that no ability owns:
//  - UNSTUCK_COOLDOWN_ID: the anti-relog retry / success cooldown on the command itself.
//  - UNSTUCK_RECENT_ID: the Unstuck Sickness window. Set to UNSTUCK_SICKNESS_WINDOW_SECONDS
//    by every completed /unstuck; while it is still running, the NEXT completion is a
//    repeat and charges Unstuck Sickness. A completion that lands after it has run out is
//    the first in its hour and is free. The window is measured in played time, exactly like
//    every other persisted cooldown (see cooldown_persist.ts: remaining seconds freeze on
//    logout and resume on load), so relogging can never shorten it. Both ids persist
//    through save/load, survive competitive resets, and stay out of the /cooldowns readout.

export const UNSTUCK_COOLDOWN_ID = 'system_unstuck';
export const UNSTUCK_RECENT_ID = 'system_unstuck_recent';
/** How long after a completed /unstuck the next one counts as a repeat (one hour). */
export const UNSTUCK_SICKNESS_WINDOW_SECONDS = 60 * 60;

const UNSTUCK_SYSTEM_COOLDOWN_IDS: ReadonlySet<string> = new Set([
  UNSTUCK_COOLDOWN_ID,
  UNSTUCK_RECENT_ID,
]);

/** Whether a cooldown id is one of the hidden /unstuck system timers (never an ability). */
export function isUnstuckSystemCooldown(id: string): boolean {
  return UNSTUCK_SYSTEM_COOLDOWN_IDS.has(id);
}

/**
 * Whether a /unstuck completing NOW owes Unstuck Sickness: true only while the window
 * opened by the previous completion is still running (a repeat inside the hour).
 */
export function unstuckOwesSickness(cooldowns: ReadonlyMap<string, number>): boolean {
  return (cooldowns.get(UNSTUCK_RECENT_ID) ?? 0) > 0;
}

/**
 * Record a completed /unstuck: (re)open the sickness window in full. Called on EVERY
 * completion, free or charged, so the window slides from the latest use rather than the
 * first; chaining the command keeps it charged until a whole quiet hour has passed.
 */
export function markUnstuckCompleted(cooldowns: Map<string, number>): void {
  cooldowns.set(UNSTUCK_RECENT_ID, UNSTUCK_SICKNESS_WINDOW_SECONDS);
}

/** Competitive resets clear ability state but must never clear these anti-relog timers. */
export function clearCooldownsPreservingUnstuck(cooldowns: Map<string, number>): void {
  const preserved = [...cooldowns].filter(
    ([id, remaining]) => isUnstuckSystemCooldown(id) && remaining > 0,
  );
  cooldowns.clear();
  for (const [id, remaining] of preserved) cooldowns.set(id, remaining);
}

/**
 * Hand a fighter's pre-match cooldowns back on the way out of an arena, battleground, or
 * Vale Cup match (a match is a parenthesis, not a rest stop) WITHOUT losing either system
 * timer that ran or opened during the match: for those two ids the larger of the live and
 * the carried-in value wins, so a /unstuck completed inside a battleground still opens the
 * sickness window once the fighter is home. Every ability cooldown is restored exactly as
 * carried in. Returns the map to install; neither input is modified.
 */
export function restoreCooldownsPreservingUnstuck(
  live: ReadonlyMap<string, number>,
  carriedIn: ReadonlyMap<string, number>,
): Map<string, number> {
  const restored = new Map(carriedIn);
  for (const [id, remaining] of live) {
    if (!isUnstuckSystemCooldown(id) || remaining <= 0) continue;
    restored.set(id, Math.max(remaining, restored.get(id) ?? 0));
  }
  return restored;
}
