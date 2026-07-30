// Shared fixtures for the veiled_hollow test shards
// (veiled_hollow.test.ts, veiled_hollow_a.test.ts, veiled_hollow_b.test.ts).
//
// The Veiled Hollow: zone registration and the sealed southern border.
// The realm is reachable only through its portal, so the border ridge at the
// Thornpeak boundary must beat the climbable slope on a straight approach
// from EVERY x, in BOTH directions, with no road pass through it.

import { BUILTIN_WORLD } from '../src/sim/data';
import type { WorldContent } from '../src/sim/types';

export const SEED = 1337; // matches the fixed client seed in src/main.ts

// The Sim-driven shard assertions exercise the player's own movement (the
// sealed-border climb gate, portals, swim fatigue), never ambient spawns; the
// Hollow's camp/npc placements are asserted from the REALM_* data directly.
// Spawning every ambient realm mob only makes each tick scan unrelated
// overworld AI (the fiesta/arena subsystem-world precedent). Terrain-relevant
// fields (zones, props, roads) stay byte-identical to the built-in world.
export const VEILED_HOLLOW_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};
