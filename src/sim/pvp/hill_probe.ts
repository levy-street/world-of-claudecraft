// The King of the Hill spot probe bound to the real world: the water bodies
// and the water line, the terrain relief, the collider grid and the static
// zone rectangles. Imported by the Sim ONLY (never by the pvp barrel): the
// terrain and collider modules evaluate zone data as they load, and reaching
// them from the barrel (which entity.ts imports while the content tables are
// still initializing) is the import cycle that broke the i18n build. The
// module under test (hill.ts) takes the probe through `ctx.hillProbe`, so the
// tests bind fakes and never touch the terrain.

import { isBlocked } from '../colliders';
import { zoneContaining } from '../data';
import { groundHeight, isInWaterBody, terrainSteepnessAt, WATER_LEVEL } from '../world';
import type { HillSpotProbe } from './hill_rules';

export function hillProbeFor(seed: number): HillSpotProbe {
  return {
    wet: (x, z) => isInWaterBody(x, z) || groundHeight(x, z, seed) < WATER_LEVEL + 0.5,
    steep: (x, z) => terrainSteepnessAt(x, z, seed) > 0.9,
    blocked: (x, z, r) => isBlocked(seed, x, z, r),
    zoneIdAt: (x, z) => zoneContaining(x, z)?.id ?? null,
  };
}

export type { HillSpotProbe } from './hill_rules';
