// Dungeon door level minimums: the lowest character level the physical door
// (walk-in trigger or finder travel) admits. Enforced by
// src/sim/instances/dungeon_level_gate.ts, consumed by enterDungeon.
//
// Each value matches the Dungeon Finder's NORMAL band floor for the same
// dungeon (content/dungeon_finder.ts), so a walk-in group and a finder group
// answer to one number; tests/dungeon_level_gate.test.ts pins that agreement.
// The raid rooms all sit at the level cap. A dungeon absent here has no level
// floor: the zero-combat walk-in castles and the solo Nythraxis attunement
// crypt stay open to every level.
//
// Data-as-code: plain exported records, no engine logic (content CLAUDE.md).

import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
} from '../ignivar_raid_ids';

export const DUNGEON_ENTRY_MIN_LEVEL: Readonly<Record<string, number>> = {
  hollow_crypt: 7,
  sunken_bastion: 12,
  drowned_temple: 16,
  gravewyrm_sanctum: 19,
  wildheart_basin: 20,
  nythraxis_boss_arena: 20,
  [IGNIVAR_LIFT_ROOM_ID]: 20,
  [IGNIVAR_FORGE_APPROACH_ID]: 20,
  [IGNIVAR_RAID_ARENA_ID]: 20,
  [IGNIVAR_MOLTEN_ASSEMBLY_ID]: 20,
  [IGNIVAR_SECOND_WING_ID]: 20,
};
