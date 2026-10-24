// The rig / frozen-far-mesh handoff, with hysteresis. Pure (no three, no DOM,
// no clock of its own: the caller passes seconds), in RENDER_PURE_CORES.
//
// `showsStaticFarMesh` (crowd_lod.ts) answers "which body at this distance, this
// frame" from inputs that move every frame: the band edge eases with the frame
// budget pressure (58 to 75 yd) and the crowd count, and the moving holdout
// drops whenever an online entity's interpolation clock saturates between
// snapshots. Fed straight to the view, a creature standing anywhere between
// the band edges swapped between its animated rig and its baked idle-pose mesh
// many times a second on a machine hovering at its budget: the reported
// "creatures flicker when a bit far away" (measured by
// scripts/dungeon_flicker_probe.mjs: hundreds of swaps in ten seconds).
//
// The latch keeps the same edges and adds three dampers, none of which touches
// actionable information (graphics-settings fairness):
//   - distance hysteresis: once frozen, the rig comes back only inside
//     FAR_LOD_RETURN of the edge, so a wobbling edge cannot re-cross it;
//   - a dwell: a cosmetic swap waits FAR_LOD_DWELL_SEC after the last one;
//   - a moving grace: an entity counts as moving for FAR_LOD_MOVING_GRACE_SEC
//     after it last moved, so snapshot gaps do not freeze a walker.
// The fairness carve-out is exempt from all three: an ACTIONABLE pose (a cast
// windup, the current target) inside its edge returns to the rig at once.

import type { CharacterLodBands } from './crowd_lod';

/** Linear share of the edge the rig must come back inside of. */
export const FAR_LOD_RETURN = 0.9;
/** Seconds between two cosmetic swaps of one view. */
export const FAR_LOD_DWELL_SEC = 0.75;
/** Seconds an entity still counts as moving after its last step. */
export const FAR_LOD_MOVING_GRACE_SEC = 1;

/** Per-view latch memory (sim-free, owned by the thin wrapper). */
export interface FarLodLatchState {
  /** Seconds (the caller's clock) of the last swap; -Infinity before any. */
  changedAt: number;
  /** Seconds the entity was last seen moving; -Infinity when never. */
  movedAt: number;
}

export function createFarLodLatchState(): FarLodLatchState {
  return { changedAt: Number.NEGATIVE_INFINITY, movedAt: Number.NEGATIVE_INFINITY };
}

/**
 * Whether the view draws the frozen far mesh this frame, given what it drew
 * last frame. Updates `state` (the swap and movement clocks) in place.
 */
export function latchStaticFarMesh(
  state: FarLodLatchState,
  prevFar: boolean,
  distSq: number,
  bands: CharacterLodBands,
  actionable: boolean,
  movingNow: boolean,
  nowSec: number,
): boolean {
  if (movingNow) state.movedAt = nowSec;
  const moving = movingNow || nowSec - state.movedAt < FAR_LOD_MOVING_GRACE_SEC;
  const edgeSq = actionable || moving ? bands.actionableStaticRangeSq : bands.staticRangeSq;
  const wantFar = distSq > edgeSq;
  if (wantFar === prevFar) return prevFar;
  const settled = nowSec - state.changedAt >= FAR_LOD_DWELL_SEC;
  let far = prevFar;
  if (prevFar) {
    // Back to the rig: an actionable pose at once; anything else only well
    // inside the edge and once the last swap has settled.
    if (actionable || (settled && distSq < edgeSq * FAR_LOD_RETURN * FAR_LOD_RETURN)) far = false;
  } else if (settled) {
    far = true;
  }
  if (far !== prevFar) state.changedAt = nowSec;
  return far;
}
