// Fire and Fly's private arena: an open-field interior with the cannon tower at
// its center (src/sim/fire_and_fly_field.ts), entered only through the turret
// session (src/sim/turret_arena_session.ts), which claims a solo slot and
// returns the player to where they stood. It spawns nothing and has no
// overworld door, so it allocates no entity id at world boot.
import { EASTBROOK_LAYOUT } from '../eastbrook_layout';
import type { DungeonDef } from '../types';

export const FIRE_AND_FLY_DUNGEON_ID = 'fire_and_fly_arena';

const PLAYER_START = EASTBROOK_LAYOUT.services.playerStart.position;

export const FIRE_AND_FLY_DUNGEON_DEFS: Record<string, DungeonDef> = {
  [FIRE_AND_FLY_DUNGEON_ID]: {
    id: FIRE_AND_FLY_DUNGEON_ID,
    name: 'Fire and Fly',
    index: 15,
    // Never a door (overworldDoor false): a save taken inside the arena
    // rejoins at doorPos minus the standard 4 yd drop, which is exactly the
    // Eastbrook arrival point.
    doorPos: { x: PLAYER_START.x, z: PLAYER_START.z + 4 },
    overworldDoor: false,
    guideVisible: false,
    // The generic dungeon path (dev teleports) arrives beside the tower.
    entry: { x: 0, z: -8 },
    exitOffset: { x: 0, z: -14 },
    spawns: [],
    interior: 'fire_and_fly',
    suggestedPlayers: 1,
    enterText: 'You climb the old cannon tower. Beyond the trees, the woods begin to stir.',
    leaveText: 'You climb down from the tower and leave the arena behind.',
  },
};
