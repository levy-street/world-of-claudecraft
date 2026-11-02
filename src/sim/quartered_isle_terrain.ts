// The Quartered Isle's authored landforms: Rivalmoot's hill, the Gyre's rise
// and the Challengers' Ring's level floor. Each is a pure function of (x, z)
// over the height the terrain chain has built so far, wired into world.ts
// terrainHeightUnpadded behind its own terrain_region_index.ts bounds (the
// thornpeak_walk_grades.ts pattern): no content table, no road, no camp, so
// none of them can move roadDistance calming or any rng-consuming system.
// Pure leaf: deterministic, no rng, no SimContext.

// Kept in step with QUARTERED_ISLE_ZONE (content/quartered_isle.ts): the hub
// sits on the hilltop and the hill arena on the floor below
// (tests/quartered_isle.test.ts pins both against drift).
export const RIVALMOOT_HILL = {
  x: 0,
  z: 2235,
  /** the hilltop plateau's radius: the full rise holds inside it */
  topR: 38,
  /** where the hill meets the surrounding ground */
  footR: 104,
  /** how far the plateau stands above the land around it */
  rise: 18,
} as const;

export const GYRE_RISE = {
  x: 0,
  z: 2330,
  topR: 8,
  footR: 52,
  rise: 12,
} as const;

/** The Challengers' Ring: a level floor ringed by a raised bank. */
export const CHALLENGERS_RING = {
  x: -44,
  z: 2098,
  /** the level floor: the King of the Hill circle (HILL_RADIUS 50) plus a
   *  margin, so every inch of a contest stands on even ground */
  floorR: 58,
  /** the floor eases into the surrounding ground by this radius */
  blendR: 74,
  /** the floor's height */
  floorY: 4.5,
  /** the spectators' bank just past the floor */
  bankInnerR: 60,
  bankPeakR: 64,
  bankOuterR: 70,
  bankRise: 2.2,
} as const;

/** Every region the appliers below can touch (terrain_region_index bounds). */
export const QUARTERED_SHAPING_BOUNDS = {
  minX: -RIVALMOOT_HILL.footR,
  maxX: RIVALMOOT_HILL.footR,
  minZ: RIVALMOOT_HILL.z - RIVALMOOT_HILL.footR,
  maxZ: GYRE_RISE.z + GYRE_RISE.footR,
} as const;
export const QUARTERED_ARENA_BOUNDS = {
  minX: CHALLENGERS_RING.x - CHALLENGERS_RING.bankOuterR,
  maxX: CHALLENGERS_RING.x + CHALLENGERS_RING.bankOuterR,
  minZ: CHALLENGERS_RING.z - CHALLENGERS_RING.bankOuterR,
  maxZ: CHALLENGERS_RING.z + CHALLENGERS_RING.bankOuterR,
} as const;

// Bit-identical to world.ts's own smoothstep.
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function riseOffset(
  r: { x: number; z: number; topR: number; footR: number; rise: number },
  x: number,
  z: number,
): number {
  const dx = x - r.x;
  const dz = z - r.z;
  const dSq = dx * dx + dz * dz;
  if (dSq >= r.footR * r.footR) return 0;
  return r.rise * (1 - smoothstep(r.topR, r.footR, Math.sqrt(dSq)));
}

/** Height added by the isle's raised landforms: Rivalmoot's hill (a broad,
 *  flat-topped rise the town plateau stands on, its flanks a gentle walk on
 *  every side) and the Gyre's rise at the north shore. Added with the other
 *  shaping offsets, before the coasts and the hub-calmed roughening. */
export function quarteredShapingOffset(x: number, z: number): number {
  return riseOffset(RIVALMOOT_HILL, x, z) + riseOffset(GYRE_RISE, x, z);
}

/** The Challengers' Ring's ground, applied late (after the rims and the
 *  altitude roughening, like the plateau flattens): the floor is pulled to one
 *  level height out to floorR and eased into the land by blendR, and a low
 *  grass bank rises just outside it for the spectators. The bank is a walk,
 *  never a wall: 2.2yd over 4yd each side. */
export function applyChallengersRing(x: number, z: number, h: number): number {
  const a = CHALLENGERS_RING;
  const dx = x - a.x;
  const dz = z - a.z;
  const dSq = dx * dx + dz * dz;
  if (dSq >= a.bankOuterR * a.bankOuterR && dSq >= a.blendR * a.blendR) return h;
  const d = Math.sqrt(dSq);
  const w = 1 - smoothstep(a.floorR, a.blendR, d);
  let out = h + (a.floorY - h) * w;
  if (d > a.bankInnerR && d < a.bankOuterR) {
    const up = smoothstep(a.bankInnerR, a.bankPeakR, d);
    const down = 1 - smoothstep(a.bankPeakR, a.bankOuterR, d);
    out += a.bankRise * Math.min(up, down);
  }
  return out;
}
