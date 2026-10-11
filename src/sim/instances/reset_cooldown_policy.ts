// Which claims pay the five-minute Reset All Instances cooldown.
//
// The cooldown (INSTANCE_EMPTY_TIMEOUT stamped as `resetAvailableAt` on the
// replacement claim plus a per-member `dungeonResetLocks` entry) is a
// five-man rule: a standard dungeon's Normal tier has no lockout, so without
// it a party could reset Normal to Heroic to Normal back-to-back and respawn
// the Normal bosses for free. The raid rooms are different: every one of
// them gates a FRESH claim on its own daily or weekly lockout at BOTH tiers
// (DAILY_LOCKOUT_RAID_ROOMS / WEEKLY_LOCKOUT_RAID_ROOMS at the door and in
// resetDungeonInstances), so a kill on either tier already bars re-claiming
// that tier until the boundary. Stacking the five-minute cooldown on top
// guarded nothing there and only stranded a raid that picked the wrong tier
// or bounced off Heroic: one Normal to Heroic switch left the whole group
// unable to switch again for five minutes.
//
// Kept as its own leaf so the reset loop stays a thin consumer: the predicate
// is pinned directly in tests/reset_cooldown_policy.test.ts and through
// resetDungeonInstances in tests/dungeons.test.ts ("raid lockout gate").
import { IGNIVAR_RAID_ROOM_IDS } from '../ignivar_raid_ids';

// The dungeons only a raid group may claim: the Nythraxis boss arena and the
// Ignivar linked rooms. dungeons.ts re-exports this same set as
// RAID_REQUIRED_DUNGEON_IDS (one source of truth, defined here so this leaf
// never imports the coordinator it serves).
export const RAID_REQUIRED_DUNGEON_IDS: ReadonlySet<string> = new Set([
  'nythraxis_boss_arena',
  ...IGNIVAR_RAID_ROOM_IDS,
]);

/** Does a Reset All Instances replacement claim for this dungeon carry the
 *  five-minute reset cooldown? True for every standard dungeon; false for
 *  the raid rooms, whose own lockouts are the rate limit. */
export function resetCooldownApplies(dungeonId: string): boolean {
  return !RAID_REQUIRED_DUNGEON_IDS.has(dungeonId);
}
