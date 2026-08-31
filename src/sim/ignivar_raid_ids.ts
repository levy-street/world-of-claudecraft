// Stable raid-room identifiers shared by content, simulation, and rendering.
// Keep this leaf free of SimContext so declarative content never imports a
// stateful system module.

export const IGNIVAR_FORGE_APPROACH_ID = 'ignivar_forge_approach';
export const IGNIVAR_RAID_ARENA_ID = 'ignivar_raid_arena';
export const IGNIVAR_MOLTEN_ASSEMBLY_ID = 'ignivar_molten_assembly';
export const IGNIVAR_SECOND_WING_ID = 'ignivar_inner_crucible';
export const IGNIVAR_GATE_LOCKED_TEMPLATE = 'ignivar_raid_gate_locked';
// The forge-lift room's exit gate: sealed while the lift "rides down" (a
// fixed spell after the instance claim; the room never moves), then swapped
// into an ordinary room-crossing 'dungeon_door' portal to the Halls, the
// Sealed Herald Gate pattern exactly.
export const IGNIVAR_LIFT_GATE_LOCKED_TEMPLATE = 'ignivar_lift_gate_locked';
export const IGNIVAR_LIFT_ROOM_ID = 'ignivar_forge_lift';

export const IGNIVAR_EMBER_SENTINEL_ID = 'ignivar_ember_sentinel';
export const IGNIVAR_CRUCIBLE_WARDEN_ID = 'ignivar_crucible_warden';
export const IGNIVAR_CINDER_ARTIFICER_ID = 'ignivar_cinder_artificer';
export const VARKHUL_BOSS_ID = 'varkhul_forgefather_of_the_last_flame';

export const IGNIVAR_APPROACH_GUARDIAN_IDS = [
  IGNIVAR_EMBER_SENTINEL_ID,
  IGNIVAR_CRUCIBLE_WARDEN_ID,
] as const;

export const IGNIVAR_TRASH_AUTOMATON_IDS = IGNIVAR_APPROACH_GUARDIAN_IDS;

export const IGNIVAR_RAID_ROOM_IDS = [
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_SECOND_WING_ID,
] as const;

export function isIgnivarRaidRoom(dungeonId: string): boolean {
  return IGNIVAR_RAID_ROOM_IDS.some((candidate) => candidate === dungeonId);
}

export function ignivarPreviousRaidRoom(dungeonId: string): string | null {
  const index = (IGNIVAR_RAID_ROOM_IDS as readonly string[]).indexOf(dungeonId);
  return index > 0 ? IGNIVAR_RAID_ROOM_IDS[index - 1] : null;
}
