// The raid boss rooms, as a dependency-free leaf so a lockout id can be
// classified (raid, dungeon, world boss) without pulling in the instance
// machinery: src/sim/instances/dungeons.ts re-exports both sets and reads
// them for the lock boundaries, and character select reads them through
// raid_lockout_state.ts to group a roster row's lockouts.

// The rooms whose lockouts run on the WEEKLY reset boundary, one lock per
// difficulty (normal locks under the plain dungeon id, heroic under
// heroicLockoutId): the Ignivar raid's two encounter rooms. Explicit by
// maintainer ruling rather than derived from suggestedPlayers, so the older
// Nythraxis arena deliberately keeps its shipped daily boundary.
export const WEEKLY_LOCKOUT_RAID_ROOMS: ReadonlySet<string> = new Set([
  'ignivar_raid_arena',
  'ignivar_inner_crucible',
]);

// The raid boss rooms that keep the realm-DAILY boundary, by the same explicit
// maintainer ruling. Every raid-tier room with a final boss must appear in
// exactly one of these two sets: the at-the-door lock check reads their
// union, and the guard in tests/ignivar_weekly_lockout.test.ts fails any new
// raid boss room that names neither, so a future room cannot silently ship on
// an undeclared boundary.
export const DAILY_LOCKOUT_RAID_ROOMS: ReadonlySet<string> = new Set(['nythraxis_boss_arena']);

/** True for a raid boss room (either boundary); false for an ordinary dungeon. */
export function isRaidRoom(dungeonId: string): boolean {
  return WEEKLY_LOCKOUT_RAID_ROOMS.has(dungeonId) || DAILY_LOCKOUT_RAID_ROOMS.has(dungeonId);
}
