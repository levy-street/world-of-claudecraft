// The Highwatch manor's resident (sim/highwatch_layout.ts, the walk-in manor west of the
// Sanctum road): its steward, standing on the great hall's floor before the dais step (the
// model's x 0, z 8.4: clear of the hearth's ring and the tables), turned toward the door.
// Gossip only: no quests, no stock, never in combat.
//
// `dynamic`, so the world-init NPC loop skips him; ../highwatch_manor.ts spawns him under his
// reserved id in the singleton band (the harbormaster's idiom), outside the sequential
// allocator, so no other entity's id moves and no parity golden changes.

import type { NpcDef } from '../types';

export const HIGHWATCH_STEWARD_NPC_ID = 'steward_ansel_hale';

/** The steward's reserved entity id (types.ts STATIC_WORLD_SERVICE_ENTITY_ID_MIN's note). */
export const HIGHWATCH_STEWARD_ENTITY_ID = 1_000_000_007;

export const HIGHWATCH_MANOR_NPCS: Record<string, NpcDef> = {
  [HIGHWATCH_STEWARD_NPC_ID]: {
    id: HIGHWATCH_STEWARD_NPC_ID,
    name: 'Ansel Hale',
    title: 'Steward of the Manor',
    pos: { x: 31.5, z: 754.4 },
    facing: Math.PI,
    color: 0x6a5a8c,
    questIds: [],
    dynamic: true,
    greeting:
      'Welcome to the manor, $C. Warm yourself at the hearth, mind the rugs, and do not touch the high table. The lantern burns all night so the square can find its way home.',
  },
};
