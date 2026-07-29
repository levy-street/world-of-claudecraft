// The "is this actually a shore?" gate both terrain tiers multiply their
// beach blend by.
//
// The shoreline paint (sand, or wet rock / marsh mud in the biomes that swap
// it) has always been a pure HEIGHT band: any ground within
// SHORE_BAND_HEIGHT of the waterline was painted as coast. Height alone
// cannot tell a beach from a dry inland dip that happens to bottom out near
// the same elevation, and the world has those: the Eastbrook -> Mirefen road
// pass floors out about a yard above the waterline with no water within a
// hundred yards, and used to read as a pale sand-green patch stamped across
// the gorge. Measured over the whole world on a 2yd grid, gating the band
// this way repaints 0.7 percent of it, and 98 percent of what moves is ground
// more than 8yd from any water: real coasts keep the shipped look exactly.
//
// PURE and deterministic (no Three, no DOM): the near splat/Lambert terrain
// (terrain_chunk_build.ts) and the far-vista mesh (far_terrain_core.ts) both
// probe with their OWN height sampler, so the two tiers can never disagree
// about where a coast is, the same reason the palette lives in
// terrain_palette.ts.

/** Yards above the waterline the beach band reaches. Both tiers' ramps span
 *  waterLevel .. waterLevel + this. */
export const SHORE_BAND_HEIGHT = 1.6;

/** Ring radii (yards) the probe samples for genuinely sub-waterline ground.
 *  The outer radius is what "a beach may sit this far from water" means: it
 *  clears the 20yd tail of real gentle strands and stops short of the 24yd
 *  floor where the world's dry dips begin. The inner rings catch narrow water
 *  (a creek, a cove mouth) that a single ring can straddle between rays. */
export const SHORE_PROBE_RADII: readonly number[] = [7, 14, 21];

/** Rays per ring. 12 keeps the arc gap at the outer radius (about 11yd)
 *  under the width of the narrowest water the world draws. */
export const SHORE_PROBE_RAYS = 12;

/** Feather, in yards of height, over which the gate closes as the probed
 *  neighbourhood's floor lifts off the waterline. Ground whose whole
 *  neighbourhood stays this far above the waterline is dry land, never a
 *  coast. */
export const SHORE_GATE_FEATHER = 0.9;

/** Probe points snap to this lattice (yards) before sampling. Terrain
 *  vertices sit 1.2yd apart at the finest tier, so without the snap two
 *  neighbouring vertices share no probe point at all and every one of them
 *  pays for a full ring set. Snapped, a chunk's probes collapse onto its own
 *  1yd lattice and the memo below turns an O(vertices * rays) sweep into
 *  O(area), which is what keeps a whole-world build inside its budget. The
 *  gate only asks whether the neighbourhood floor clears the waterline, so a
 *  yard of slack in WHERE it looks cannot change that answer meaningfully. */
export const SHORE_PROBE_SNAP = 1;

/** Memo ceiling, in probe points. A whole-world sweep touches far fewer than
 *  this; the bound just stops a pathological caller from growing it without
 *  end. */
const PROBE_MEMO_LIMIT = 400_000;

const RAY_COS: number[] = [];
const RAY_SIN: number[] = [];
for (let i = 0; i < SHORE_PROBE_RAYS; i++) {
  const a = (i / SHORE_PROBE_RAYS) * Math.PI * 2;
  RAY_COS.push(Math.cos(a));
  RAY_SIN.push(Math.sin(a));
}

const smoothstep01 = (t: number): number => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/**
 * A height sampler plus its memo. One per (sampler, seed): the memo is keyed
 * on position alone, so a caller MUST mint a fresh probe when its seed or its
 * heightfield changes rather than reusing one across worlds.
 */
export interface ShoreProbe {
  readonly sample: (x: number, z: number) => number;
  readonly memo: Map<number, number>;
}

export function makeShoreProbe(sample: (x: number, z: number) => number): ShoreProbe {
  return { sample, memo: new Map() };
}

function probeHeight(probe: ShoreProbe, x: number, z: number): number {
  const qx = Math.round(x / SHORE_PROBE_SNAP);
  const qz = Math.round(z / SHORE_PROBE_SNAP);
  const key = (qx + 8192) * 65536 + (qz + 8192);
  const hit = probe.memo.get(key);
  if (hit !== undefined) return hit;
  if (probe.memo.size >= PROBE_MEMO_LIMIT) probe.memo.clear();
  const h = probe.sample(qx * SHORE_PROBE_SNAP, qz * SHORE_PROBE_SNAP);
  probe.memo.set(key, h);
  return h;
}

/**
 * How much of the beach blend the point (x, z) at height `h` has earned: 1
 * where the surrounding ground actually reaches the waterline (a real coast,
 * today's look exactly), easing to 0 where the whole neighbourhood stands
 * clear of it (a dry dip that only the height test mistook for a beach).
 *
 * Callers MUST only reach for this when their own height band already put
 * them on a candidate shore; ground at or under the waterline answers 1
 * without probing at all, which is what keeps the seabed free.
 */
export function shoreWaterGate(
  x: number,
  z: number,
  h: number,
  waterLevel: number,
  probe: ShoreProbe,
): number {
  // At or under the waterline there is nothing to decide: this IS water.
  if (h <= waterLevel) return 1;
  let floor = Number.POSITIVE_INFINITY;
  for (const r of SHORE_PROBE_RADII) {
    for (let i = 0; i < SHORE_PROBE_RAYS; i++) {
      const sampled = probeHeight(probe, x + RAY_COS[i] * r, z + RAY_SIN[i] * r);
      if (sampled < floor) {
        floor = sampled;
        // Anything already under the waterline settles it: this is a coast.
        if (floor <= waterLevel) return 1;
      }
    }
  }
  return 1 - smoothstep01((floor - waterLevel) / SHORE_GATE_FEATHER);
}
