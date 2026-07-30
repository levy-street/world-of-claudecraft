// PURE (unit-tested, Three-free): placement for the Veiled Hollow's sea
// dressing, the low mist banks and leaning light rays realm_flora.ts hangs
// over the northern ocean. Registered in RENDER_PURE_CORES
// (tests/architecture.test.ts): no three/game/net/i18n imports, no DOM, no
// nondeterminism.
//
// THE RULE: sea dressing belongs on the ocean, never across land.
//
// Each bank is one wide, double-sided, transparent plane standing ON EDGE in
// the water with depthWrite off, so everything behind it is veiled and
// everything in front of it is not. That reads as mist only while the plane
// stands over open sea and is far enough away to be horizon. Where it crosses
// dry ground the plane pokes out of the hillside and its veil stops dead along
// the intersection, which renders as a hard, ruler-straight pale line across
// the terrain at the bank's exact z.
//
// Every bank used to straddle the Pale Causeway (the isthmus running north out
// of the Hollow, z 1250-1470), and the one at z=1350 sat centred ON it, ~20yd
// from a player walking north. Masking the planes where they crossed land was
// tried and rejected: it is a patch over a placement mistake, it still left a
// visible sliver on the near plane (a plane seen almost edge-on cuts the ground
// it stands over no matter how it is masked), and it thinned the northern banks
// exactly where they do their real job. The banks are placed offshore instead,
// and tests/sea_mist_core.test.ts holds them there.
//
// That job, in the author's words: "they gently veil what lies beyond the sea
// without walling it off." The Hollow's northern band is open ocean and the
// causeway runs to the band edge where a future realm will one day connect, so
// there is nothing built out there; the mist hazes the empty distance the same
// way the suppressed north rim and swim fatigue keep the world edge soft.

/** One mist bank: a wide gradient plane riding just over the water. */
export interface MistBankDef {
  x: number;
  z: number;
  width: number;
  height: number;
  opacity: number;
}

/** One light ray: a tall additive streak leaning sunward over the water. */
export interface LightRayDef {
  x: number;
  z: number;
  height: number;
  opacity: number;
  phase: number;
}

/** Peak x offset a bank drifts to either side of its anchor (see update()). */
export const MIST_DRIFT_AMPLITUDE = 22;

/**
 * Banks, west and east of the causeway at each depth so the sea still reads as
 * layered on both flanks. Every span below is the drift-inclusive footprint,
 * checked against the measured open-water runs at that z; the guard test
 * re-derives them from the terrain rather than trusting these comments.
 */
export const SEA_MIST_BANKS: readonly MistBankDef[] = [
  { x: -95, z: 1315, width: 140, height: 9, opacity: 0.32 }, // -187..-3, water -189..1
  { x: 140, z: 1315, width: 60, height: 9, opacity: 0.3 }, //     88..192, water 69..209
  { x: -85, z: 1350, width: 140, height: 11, opacity: 0.36 }, // -177..7, water -190..12
  { x: 140, z: 1350, width: 50, height: 11, opacity: 0.34 }, //    93..187, water 88..189
  { x: -42, z: 1408, width: 30, height: 14, opacity: 0.44 }, //   -79..-5, water -84..2
  { x: 133, z: 1420, width: 44, height: 12, opacity: 0.4 }, //     89..177, water 87..220
];

/** Rays do not drift, so each only has to clear the waterline where it stands. */
export const SEA_LIGHT_RAYS: readonly LightRayDef[] = [
  { x: -120, z: 1340, height: 42, opacity: 0.1, phase: 0 },
  { x: -45, z: 1385, height: 55, opacity: 0.13, phase: 1.7 },
  { x: 95, z: 1360, height: 48, opacity: 0.11, phase: 3.1 }, // was x=85, on the shore
  { x: 150, z: 1395, height: 50, opacity: 0.12, phase: 4.4 },
  { x: -20, z: 1300, height: 38, opacity: 0.09, phase: 5.6 }, // was x=10, on the causeway
];

/** Half-width of a ray's plane, so the guard checks its whole footprint. */
export const RAY_HALF_WIDTH = 6;

/**
 * The x range a bank's plane sweeps over its whole life, drift included. The
 * guard test walks this, not the resting footprint: a bank parked over water
 * that drifts onto the shore is the same bug on a timer.
 */
export function bankDriftSpan(
  bank: MistBankDef,
  drift: number = MIST_DRIFT_AMPLITUDE,
): { lo: number; hi: number } {
  return {
    lo: bank.x - bank.width / 2 - drift,
    hi: bank.x + bank.width / 2 + drift,
  };
}
