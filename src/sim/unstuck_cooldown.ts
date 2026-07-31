// Hidden system cooldown shared by recovery, competitive resets, and readouts.
// Kept as a pure leaf so those systems do not form a runtime import cycle.

export const UNSTUCK_COOLDOWN_ID = 'system_unstuck';

/** Competitive resets clear ability state but must never clear this anti-relog timer. */
export function clearCooldownsPreservingUnstuck(cooldowns: Map<string, number>): void {
  const unstuck = cooldowns.get(UNSTUCK_COOLDOWN_ID);
  cooldowns.clear();
  if (unstuck !== undefined && unstuck > 0) cooldowns.set(UNSTUCK_COOLDOWN_ID, unstuck);
}
