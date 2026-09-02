// The lean-tier thinning for zone-feature DRESSING: which instances of a
// purely decorative biome family a low-end session still draws.
//
// WHY THIS EXISTS. The bespoke per-zone feature groups instance shipped Tripo
// biome models, and those models are expensive per copy: a single fen reed or
// lily raft is 6,000 triangles and a hollow willow 11,394. Instanced in the
// dozens each, they add up to the largest triangle bucket a town frame draws,
// and they carried NO tier ladder at all: an Intel UHD session at the
// Thornpeak hub paid the same 4.7 M triangles as an ultra one (live census,
// 2026-09-01, identical on both tiers).
//
// The thin is COSMETIC ONLY, and the rule that keeps it fair is the caller's,
// not this module's: a family whose placements are the sim's own collider
// list (the fen willows, the Palmreach palms, the Veiled Hollow willows) is
// never routed in here, because a graphics preset may shed dressing but must
// never hide something a player can walk into or act on. See
// docs/design/graphics-settings-fairness.md and the sibling rule in
// foliage_decimation_core.ts.
//
// The selection is an even STRIDE over the source order, not a hash draw: the
// placements are already scattered, and the loops that produce them walk a
// lake ring or a grid, so a per-instance hash leaves visible bald patches
// while a stride thins the whole band evenly.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/zone_dressing_lod_core.test.ts.

/** Share of a dressing family a lean session keeps. */
export const LEAN_DRESSING_KEEP_RATE = 0.5;

/**
 * Instances a dressing family keeps whatever the rate. A band thinned to one
 * or two copies reads as a missing feature rather than a lighter one, and a
 * family that is already this small costs nothing worth shedding.
 */
export const LEAN_DRESSING_MIN_INSTANCES = 6;

/** How many of `total` instances a lean session draws. */
export function leanDressingKeepCount(total: number, leanFoliage: boolean): number {
  if (!leanFoliage || total <= LEAN_DRESSING_MIN_INSTANCES) return total;
  return Math.max(LEAN_DRESSING_MIN_INSTANCES, Math.round(total * LEAN_DRESSING_KEEP_RATE));
}

/**
 * Whether the instance at `index` survives, given the family's size and the
 * count `leanDressingKeepCount` answered. An even stride: exactly `keepCount`
 * of `total` indices answer true, spread across the whole range.
 */
export function leanDressingKeeps(index: number, total: number, keepCount: number): boolean {
  if (keepCount <= 0 || total <= 0) return false;
  if (keepCount >= total) return true;
  return Math.floor(((index + 1) * keepCount) / total) > Math.floor((index * keepCount) / total);
}

/**
 * The whole decision over one dressing family: the placements a lean session
 * draws, in source order. Callers pass their own placement type through.
 */
export function thinLeanDressing<T>(placements: readonly T[], leanFoliage: boolean): readonly T[] {
  const keepCount = leanDressingKeepCount(placements.length, leanFoliage);
  if (keepCount >= placements.length) return placements;
  const kept: T[] = [];
  for (let i = 0; i < placements.length; i++) {
    if (leanDressingKeeps(i, placements.length, keepCount)) kept.push(placements[i]);
  }
  return kept;
}
