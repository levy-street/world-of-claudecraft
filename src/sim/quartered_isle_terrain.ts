// The Quartered Isle's authored landforms: Rivalmoot's rise at the foot of
// the Gyre's climb, and the great crater at the island's heart, where the
// council's four arts met in their war and where the King of the Hill is now
// fought (the Gyre and the scars: quartered_landmarks.ts; the shattered
// ground between: quartered_shatter.ts). Each is a pure function of (x, z)
// over the height the terrain chain has built so far, wired into world.ts
// terrainHeightUnpadded behind its own terrain_region_index.ts bounds (the
// thornpeak_walk_grades.ts pattern): no content table, no road, no camp, so
// none of them can move roadDistance calming or any rng-consuming system.
// Pure leaf: deterministic, no rng, no SimContext.

// Kept in step with QUARTERED_ISLE_ZONE (content/quartered_isle.ts): the hub
// sits on the rise and the hill arena on the crater's floor
// (tests/quartered_isle.test.ts pins both against drift).
export const RIVALMOOT_HILL = {
  x: 0,
  z: 2248,
  /** the town's level top: the full rise holds inside it */
  topR: 38,
  /** where the rise meets the ground (the crater's rim to the south, the
   *  Gyre's foot to the north) */
  footR: 54,
  /** how far the town stands above the land around it */
  rise: 7,
} as const;

/** The great crater: the war's heart, a level floor sunk below a broken,
 *  raised rim, its walls too steep to climb but for one ramp from each
 *  quarter, cut down through the rim so it walks straight out onto the land
 *  beyond. The floor holds the King of the Hill circle (HILL_RADIUS 50). */
export const CHALLENGERS_RING = {
  x: 0,
  z: 2122,
  /** the level floor: the contest circle plus a margin */
  floorR: 58,
  /** the floor's height */
  floorY: -1.5,
  /** the wall's top: from the floor's edge the wall climbs to the rim here */
  wallR: 64,
  /** the rim's crest, raised above the land round it */
  rimR: 72,
  rimRise: 8,
  /** the rim's outer slope meets the land here */
  outerR: 94,
  /** the four ramps: bearings (degrees, atan2(dz, dx)) toward each quarter,
   *  the Hoarshelf (south), the Cinderscar (east), the Wilds (west) and the
   *  Gyre (north) */
  ramps: [-90, 0, 180, 90],
  /** each ramp's half width, and the run it climbs over: from the contest
   *  circle's edge out through a notch cut in the rim to the land at the
   *  rim's outer foot (44yd, so even the north ramp up toward the town's
   *  rise stays a gentle walk) */
  rampHalfW: 7,
  rampFrom: 50,
  rampTo: 94,
  /** kept for the decoration clear radius and the bounds */
  blendR: 94,
  bankOuterR: 94,
} as const;

/** Every region the appliers below can touch (terrain_region_index bounds). */
export const QUARTERED_SHAPING_BOUNDS = {
  minX: RIVALMOOT_HILL.x - RIVALMOOT_HILL.footR,
  maxX: RIVALMOOT_HILL.x + RIVALMOOT_HILL.footR,
  minZ: RIVALMOOT_HILL.z - RIVALMOOT_HILL.footR,
  maxZ: RIVALMOOT_HILL.z + RIVALMOOT_HILL.footR,
} as const;
export const QUARTERED_ARENA_BOUNDS = {
  minX: CHALLENGERS_RING.x - CHALLENGERS_RING.outerR,
  maxX: CHALLENGERS_RING.x + CHALLENGERS_RING.outerR,
  minZ: CHALLENGERS_RING.z - CHALLENGERS_RING.outerR,
  maxZ: CHALLENGERS_RING.z + CHALLENGERS_RING.outerR,
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

/** Height added by Rivalmoot's rise (a flat-topped rise the town stands on,
 *  its flanks a gentle walk). Added with the other shaping offsets, before
 *  the coasts and the hub-calmed roughening. */
export function quarteredShapingOffset(x: number, z: number): number {
  return riseOffset(RIVALMOOT_HILL, x, z);
}

/** How much of a ramp (0..1) covers (x, z): 1 inside a ramp's corridor from
 *  the floor up to the rim, easing out across its edges. */
function craterRampAt(dx: number, dz: number): { k: number; ramp: number } {
  const a = CHALLENGERS_RING;
  let best = 0;
  let ramp = -1;
  for (const [i, bearing] of a.ramps.entries()) {
    const b = (bearing * Math.PI) / 180;
    const along = dx * Math.cos(b) + dz * Math.sin(b);
    if (along < a.rampFrom - 4) continue;
    const across = Math.abs(-dx * Math.sin(b) + dz * Math.cos(b));
    const k = 1 - smoothstep(a.rampHalfW, a.rampHalfW + 4, across);
    if (k > best) {
      best = k;
      ramp = i;
    }
  }
  return { k: best, ramp };
}

/** Rivalmoot's rise where each ramp lands (rampTo along its bearing). A ramp
 *  climbs to the land with the rise under it taken out of every step and
 *  spread along its whole run instead, so the north ramp, which lands on the
 *  rise's flank, never carries that flank's pitch inside its own run. */
const RAMP_END_RISE: readonly number[] = CHALLENGERS_RING.ramps.map((bearing) => {
  const a = CHALLENGERS_RING;
  const b = (bearing * Math.PI) / 180;
  return quarteredShapingOffset(a.x + Math.cos(b) * a.rampTo, a.z + Math.sin(b) * a.rampTo);
});

/** A ramp's climb, 0 at rampFrom to 1 at rampTo: a straight grade eased in
 *  and out over its first and last quarter (a smoothstep would peak at 1.5x
 *  the mean grade; this peaks at 4/3 of it). */
export function craterRampRise(d: number): number {
  const a = CHALLENGERS_RING;
  const t = Math.max(0, Math.min(1, (d - a.rampFrom) / (a.rampTo - a.rampFrom)));
  const e = 0.25;
  // the core's slope, so the eased ends meet it with no kink
  const core = 1 / (1 - e);
  if (t < e) return (core * t * t) / (2 * e);
  if (t > 1 - e) return 1 - (core * (1 - t) * (1 - t)) / (2 * e);
  return core * (t - e / 2);
}

/** The great crater's ground, applied late (after the rims and the
 *  altitude roughening, like the plateau flattens): a level floor out to
 *  floorR, a wall climbing steeper than a player can to the rim, the rim's
 *  crest standing rimRise over the land, and its outer slope easing back down
 *  by outerR. Each ramp replaces the wall and the rim with one long walkable
 *  grade from rampFrom up to the land itself at rampTo: a notch cut through
 *  the rim, not a climb over it. */
export function applyChallengersRing(x: number, z: number, h: number): number {
  const a = CHALLENGERS_RING;
  const dx = x - a.x;
  const dz = z - a.z;
  const dSq = dx * dx + dz * dz;
  if (dSq >= a.outerR * a.outerR) return h;
  const d = Math.sqrt(dSq);
  const crest = h + a.rimRise;
  // the bowl: the wall climbs floor to crest over floorR..wallR (too steep to
  // climb), the crest's top runs out to rimR, and the rim's outer slope eases
  // back down to the land by outerR
  const bowl =
    d >= a.rimR
      ? h + a.rimRise * (1 - smoothstep(a.rimR, a.outerR, d))
      : a.floorY + (crest - a.floorY) * smoothstep(a.floorR, a.wallR, d);
  const { k, ramp } = craterRampAt(dx, dz);
  if (k <= 0) return bowl;
  // a ramp: floor to the land's own height over rampFrom..rampTo, a walk,
  // with the town's rise under it eased in along the whole run
  const land = h - quarteredShapingOffset(x, z) + RAMP_END_RISE[ramp];
  const grade = a.floorY + (land - a.floorY) * craterRampRise(d);
  return bowl + (grade - bowl) * k;
}

/** How far the isle's claim reaches past the strip into each column
 *  (QUARTERED_ISLE_ZONE x -250..250 against the strip's -180..180). */
export const ISLE_CLAIM_WIDTH = 70;

/** How much of the claim stands at z: 0 south of the isle, 1 inside it,
 *  eased across its south line on exactly the isle coast's own z seam
 *  (world.ts applyQuarteredCoast), so a column coast fading out of the claim
 *  hands over to the isle's coast fading in with no gap between them. */
export function isleClaimAt(z: number): number {
  return smoothstep(1952, 1968, z);
}

/** The weight the isle's claim holds over a column coast at (x, z): the
 *  claim's z ease inside the claimed flank (|x| up to 250), easing out over
 *  the claim's outer edge. A column coast multiplies its seam by
 *  (1 - this), the isle's coast reaches out to the same edge. */
export function isleClaimFade(x: number, z: number): number {
  const c = isleClaimAt(z);
  if (c <= 0) return 0;
  const edge = 180 + ISLE_CLAIM_WIDTH;
  return c * (1 - smoothstep(edge - 8, edge + 8, Math.abs(x)));
}

/** The strip-side seam x of the east (+1) or west (-1) column at z: the
 *  classic +-180 south of the isle, out at +-250 beside it. */
export function columnSeamX(side: 1 | -1, stripEdge: number, z: number): number {
  return stripEdge + side * ISLE_CLAIM_WIDTH * isleClaimAt(z);
}
