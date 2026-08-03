// Gathering proficiency bands (Professions 2.0): the shared
// 0/100/200 band ladder over a gathering profession's proficiency counter.
// Extracted from fishing.ts (FISHING_BAND_THRESHOLDS/fishingBandFor, which now
// delegate here) so gathering.ts can read a band for the gather-cast duration
// without a back-import: fishing.ts already imports queueGatheringGrant FROM
// gathering.ts, so importing fishing.ts from gathering.ts would cycle. Pure
// leaf: no SimContext, no rng, Vitest-importable directly.

// Band boundaries: the minimum proficiency for each band, lined up with the
// shipped 100-proficiency deed milestones: band 0 covers 0-99, band 1 covers
// 100-199, band 2 covers 200+. The shipped caps are 100 for the land
// professions and 200 for fishing (content/professions.ts maxSkill), so
// today band 1 is fishing-only headroom and band 2 is reachable by nobody:
// deliberate forward room for the V3 cap climb, not thirds of any live cap
// (an older comment here claimed a 300 gathering maxSkill that never
// shipped).
// Exported so tests can pin the boundaries.
export const PROFICIENCY_BAND_THRESHOLDS = [0, 100, 200] as const;

// Which band a given proficiency selects. Pure state (no rng), so it never
// perturbs any draw-order contract. A NaN proficiency falls through both
// comparisons to band 0, matching the proficiency-0 default.
export function proficiencyBandFor(proficiency: number): 0 | 1 | 2 {
  if (proficiency >= PROFICIENCY_BAND_THRESHOLDS[2]) return 2;
  if (proficiency >= PROFICIENCY_BAND_THRESHOLDS[1]) return 1;
  return 0;
}
