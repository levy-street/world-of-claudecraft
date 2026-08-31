// Ignivar raid exit rules: where a room's exit portal leads (the floor-chain
// routing that keeps raiders out of the open world until they are back at the
// front of the raid), and the boss-fight seal that holds every portal shut
// while a room's boss is engaged (the nythraxisInstanceSealed rule applied to
// the Ignivar boss rooms). These helpers only read their inputs;
// instances/dungeons.ts owns the mutations and emits the player-facing denial.

import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
  ignivarPreviousRaidRoom,
  isIgnivarRaidRoom,
  VARKHUL_BOSS_ID,
} from '../ignivar_raid_ids';
import { type Entity, IGNIVAR_BOSS_ID } from '../types';

/**
 * The room this raid room's exit portal leads to: the PREVIOUS floor for every
 * room past the Halls (arena to approach, assembly to arena, crucible to
 * assembly), and null for the lift and the Halls, whose exits lead OUTSIDE to
 * the keep entrance. Null for any non-raid dungeon too, so callers can gate on
 * the answer alone.
 */
export function ignivarExitRoom(dungeonId: string): string | null {
  if (dungeonId === IGNIVAR_LIFT_ROOM_ID || dungeonId === IGNIVAR_FORGE_APPROACH_ID) return null;
  if (!isIgnivarRaidRoom(dungeonId)) return null;
  return ignivarPreviousRaidRoom(dungeonId);
}

/** The boss whose live fight seals this room's exit portals, or null when the
 *  room has no boss seal (the lift, the Halls, the Molten Assembly). */
export function ignivarExitSealBossId(dungeonId: string): string | null {
  if (dungeonId === IGNIVAR_RAID_ARENA_ID) return IGNIVAR_BOSS_ID;
  if (dungeonId === IGNIVAR_SECOND_WING_ID) return VARKHUL_BOSS_ID;
  return null;
}

/**
 * True while this room's boss fight is live: the boss is alive (!dead) AND
 * engaged (inCombat), the window in which no portal leads out of the room.
 * A dead boss still flagged inCombat (a fresh corpse) never seals, and a
 * trash-only fight never seals: only the room's own boss holds the doors.
 */
export function ignivarExitSealed(
  dungeonId: string,
  mobIds: readonly number[],
  entities: ReadonlyMap<number, Entity>,
): boolean {
  const bossId = ignivarExitSealBossId(dungeonId);
  if (bossId === null) return false;
  for (const id of mobIds) {
    const mob = entities.get(id);
    if (mob && mob.templateId === bossId && !mob.dead && mob.inCombat) return true;
  }
  return false;
}
