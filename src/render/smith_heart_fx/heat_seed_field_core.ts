// The Hearthseeds' footprints as ONE field (the painter is
// heat_seed_field.ts): every live seed's burst reach and hot core read
// together, so a cluster of seeds under a stacked raid draws as one shape
// with a single outer edge, never a carpet of overlapping circles.
//
// What the field keeps, exactly as the sim resolves it (heat_seeds.ts,
// heat_ids.ts seedFalloff), on every tier:
//  - the REACH: a point is struck by a seed when it stands under that seed's
//    reach (`T.seedReach`, the object's scale). The union of the reaches is
//    the area some burst strikes; its outer edge is drawn, and the edges of
//    one reach lying inside another (where you are struck either way) are
//    not, since they tell a player nothing to act on;
//  - the HOT CORE: `SEED_CORE_R` round each seed (where a burst nearly
//    kills), the union of the cores with its own hard edge;
//  - the HEAT: the bursts add up, each falling off with the square of the
//    distance (`seedFalloff`), so the field's heat at a point is the sum of
//    every seed's `(1 - d / reach)^2`: hottest on each seed, hotter still
//    where reaches overlap (struck twice), cold at the outer edge;
//  - the TIMING: each seed's own fill (its life spent) sweeps its core out
//    to the burst, and its reach to half way (the kit's old split), the
//    union of the swept parts with one front.
// The shader (heat_seed_field.ts) runs the same arithmetic; these functions
// are its testable twin and the mesh's layout.
//
// Three-free, DOM-free, deterministic.

/** A live seed: its spot (yards, any frame), its reach (yards) and its fill
 *  (0..1 of its life spent). */
export interface SeedMark {
  x: number;
  z: number;
  reach: number;
  fill: number;
}

/** The field's mesh: a grid this many cells a side, laid over the seeds'
 *  reaches plus `pad` yards, lifted `lift` yards over the floor it drapes. */
export const SEED_FIELD = { grid: 72, pad: 1, lift: 0.07 } as const;

/** What the field reads at a point. */
export interface SeedFieldSample {
  /** Signed yards to the union of the reaches' edge (< 0 inside it). */
  reachEdge: number;
  /** Signed yards to the union of the hot cores' edge (< 0 inside one). */
  coreEdge: number;
  /** The summed burst falloff (0 outside every reach, 1 on a lone seed). */
  heat: number;
  /** Signed yards to the swept part's front, reach and core (< 0 swept). */
  reachFront: number;
  coreFront: number;
}

/** The field at (`px`, `pz`) over the first `n` seeds, `coreR` the hot
 *  core's radius (mirrors the shader). */
export function seedFieldAt(
  px: number,
  pz: number,
  seeds: readonly SeedMark[],
  n: number,
  coreR: number,
  out: SeedFieldSample = { reachEdge: 0, coreEdge: 0, heat: 0, reachFront: 0, coreFront: 0 },
): SeedFieldSample {
  let re = Number.POSITIVE_INFINITY;
  let ce = Number.POSITIVE_INFINITY;
  let rf = Number.POSITIVE_INFINITY;
  let cf = Number.POSITIVE_INFINITY;
  let heat = 0;
  for (let i = 0; i < n; i++) {
    const s = seeds[i];
    const d = Math.hypot(px - s.x, pz - s.z);
    re = Math.min(re, d - s.reach);
    ce = Math.min(ce, d - coreR);
    rf = Math.min(rf, d - 0.5 * s.fill * s.reach);
    cf = Math.min(cf, d - s.fill * coreR);
    const k = Math.max(0, 1 - d / Math.max(s.reach, 1e-3));
    heat += k * k;
  }
  out.reachEdge = re;
  out.coreEdge = ce;
  out.heat = heat;
  out.reachFront = rf;
  out.coreFront = cf;
  return out;
}

/** The square the field's mesh covers: centred on the seeds' reaches, half
 *  `half` yards a side (their reaches plus `pad`). */
export function seedFieldBounds(
  seeds: readonly SeedMark[],
  n: number,
  pad: number,
  out: { x: number; z: number; half: number } = { x: 0, z: 0, half: 0 },
): { x: number; z: number; half: number } {
  if (n <= 0) {
    out.x = 0;
    out.z = 0;
    out.half = 0;
    return out;
  }
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const s = seeds[i];
    x0 = Math.min(x0, s.x - s.reach);
    x1 = Math.max(x1, s.x + s.reach);
    z0 = Math.min(z0, s.z - s.reach);
    z1 = Math.max(z1, s.z + s.reach);
  }
  out.x = (x0 + x1) / 2;
  out.z = (z0 + z1) / 2;
  out.half = Math.max(x1 - x0, z1 - z0) / 2 + pad;
  return out;
}

/** How hot the field paints at summed heat `heat` (the cracks, the char,
 *  the wash): a quarter at the outer edge, full on a lone seed's middle,
 *  brighter where bursts stack (mirrors the shader). */
export function seedFieldHeatWeight(heat: number): number {
  const h = Math.max(0, heat);
  return 0.25 + 0.75 * Math.min(1, h) + 0.3 * Math.min(1, Math.max(0, h - 1));
}
