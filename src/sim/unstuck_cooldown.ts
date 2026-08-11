// Hidden system cooldown shared by recovery, competitive resets, and readouts.
// Kept as a pure leaf so those systems do not form a runtime import cycle.

import { SUMMON_FRIEND_COOLDOWN_ID } from './summon_friend_cooldown';

export const UNSTUCK_COOLDOWN_ID = 'system_unstuck';

/** Competitive resets clear ability state but must never clear the hidden
 *  SYSTEM timers: the unstuck anti-relog timer, and the refer-a-friend summon
 *  cooldown (an arena queue must not become a free summon reset). */
export function clearCooldownsPreservingUnstuck(cooldowns: Map<string, number>): void {
  const unstuck = cooldowns.get(UNSTUCK_COOLDOWN_ID);
  const summon = cooldowns.get(SUMMON_FRIEND_COOLDOWN_ID);
  cooldowns.clear();
  if (unstuck !== undefined && unstuck > 0) cooldowns.set(UNSTUCK_COOLDOWN_ID, unstuck);
  if (summon !== undefined && summon > 0) cooldowns.set(SUMMON_FRIEND_COOLDOWN_ID, summon);
}
