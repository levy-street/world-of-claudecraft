// Per-frame foliage distance windows: the one place the renderer turns the
// governor level, the tier, and the zone's fog into the boundaries every
// foliage row is culled against. Two consumers read the SAME numbers:
//   - the per-bucket slab cull (foliage_lod.ts bucketVisible) via the
//     resolved swaps and caps below, and
//   - the per-instance vertex-shader windows (foliage_collapse.ts uniforms).
// Keeping them in one resolver is the invariant behind the lean-tier rock and
// dressing fix: a slab measured from its NEAR edge (maxNearEdge) is only safe
// when its shader collapses every instance past the very same cap, so the
// rock and dress collapse windows must equal the rock and dress bucket caps on
// the near-edge arm, never the fog wall (which would leave a half-slab of live
// boulders past the cap, the cost the center rule existed to prevent).
// Pure: no Three, no DOM, no GFX read (the caller passes the tier).
import type { CollapseWindowValues } from './foliage_collapse';
import { IMPOSTOR_SWAP_FADE, spriteSwapDistance } from './foliage_impostor_core';
import {
  foliageDistanceScale,
  foliageFogLimit,
  type LodDists,
  treeDetailDistance,
} from './foliage_lod';

export interface FoliageFrameInput {
  /** the adaptive budget's foliage lever, [0, 1] */
  modelQuality: number;
  /** GFX.leanFoliage: the low tier (and medium on a weak integrated GPU) */
  leanFoliage: boolean;
  /** sprite impostors live this frame (never on the lean arm) */
  spritesOn: boolean;
  /**
   * The far-field policy the rows were BUILT under (foliage.ts
   * impostorsActive()): true means the rock and dressing slabs registered
   * radius-aware against their swap expecting a sprite to take over; false
   * means they registered near-edge against the numeric cap with no sprite
   * side at all. It differs from spritesOn only when the sprite bake failed.
   */
  impostorsActive: boolean;
  /** live fog wall */
  fogFar: number;
  /** the atmosphere the handoff follows */
  atmosFogNear: number;
  atmosFogFar: number;
  dists: LodDists;
}

/** The resolved windows the bucket cull reads; reused across frames. */
export interface FoliageFrameWindows {
  distanceScale: number;
  fogLimit: number;
  detailFar: number;
  rockSwap: number;
  dressSwap: number;
  buildingSwap: number;
}

export function createFoliageFrameWindows(): FoliageFrameWindows {
  return {
    distanceScale: 1,
    fogLimit: 0,
    detailFar: 0,
    rockSwap: 0,
    dressSwap: 0,
    buildingSwap: 0,
  };
}

/**
 * Resolve this frame's windows into `out` and the shader uniform block
 * `collapse`. Buckets fully behind the fog wall are pure overdraw. The
 * handoff laws are decided in foliage_impostor_core.ts (sprite arm) and
 * foliage_lod.ts (lean arm) and unit-tested there. The cull tracks the LIVE
 * fog; the handoff tracks the ATMOSPHERE.
 */
export function resolveFoliageFrameWindows(
  input: FoliageFrameInput,
  out: FoliageFrameWindows,
  collapse: CollapseWindowValues,
): void {
  const { dists, spritesOn, fogFar, atmosFogNear, atmosFogFar } = input;
  const distanceScale = foliageDistanceScale(input.modelQuality, input.leanFoliage);
  const fogLimit = foliageFogLimit(fogFar, input.modelQuality);
  // Sprite arm: the handoff follows the budget (sprites are legible in
  // clear air); lean arm: the old fog-blend law, trees end in the murk.
  const detailFar = spritesOn
    ? spriteSwapDistance(dists.treeDetailFar, distanceScale, atmosFogNear, atmosFogFar, fogLimit)
    : treeDetailDistance(dists.treeDetailFar, atmosFogNear, atmosFogFar, distanceScale, fogLimit);
  // Real geometry never outlives the foliage cull (the model-quality trim
  // exists to shed triangles); only the SPRITES run past it to the wall.
  const rockSwap = Math.min(dists.rockFar * distanceScale, fogLimit);
  const dressSwap = Math.min(dists.dressFar * distanceScale, fogLimit);
  // Real buildings die with the detail horizon (props band culls), so
  // their sprites step in a little inside it: the overlap band hides
  // behind the real building it pictures.
  const buildingSwap = Math.max(0, fogFar - 40);
  out.distanceScale = distanceScale;
  out.fogLimit = fogLimit;
  out.detailFar = detailFar;
  out.rockSwap = rockSwap;
  out.dressSwap = dressSwap;
  out.buildingSwap = buildingSwap;
  // The vertex shaders enforce these same boundaries per INSTANCE, so a
  // surviving slab no longer drags its whole population along with it
  // (foliage_collapse.ts), and each sprite starts where its real twin
  // collapsed (foliage_impostor.ts binds the same uniforms). The rock and
  // dress windows are the bucket caps whenever the rows were built to end
  // there: on the sprite arm (a sprite takes over) and on the near-edge arm
  // (the cap IS the cull). The one exception is a sprite-arm build whose
  // bake failed: those rows still expect a sprite behind the swap, so they
  // keep drawing to the fog wall rather than vanish with nothing behind them.
  const capBound = spritesOn || !input.impostorsActive;
  collapse.treeMax = detailFar;
  collapse.rockMax = capBound ? rockSwap : fogLimit;
  collapse.dressMax = capBound ? dressSwap : fogLimit;
  collapse.buildingMax = spritesOn ? buildingSwap : fogLimit;
  collapse.fogCull = fogLimit;
  collapse.fade = spritesOn ? IMPOSTOR_SWAP_FADE : 0;
  // Sprites run to the view horizon: with outdoor fog gone the renderer
  // passes the whole-world envelope through atmosFogFar, so the far
  // field carries every tree to the world rim; under a live fog (an
  // interior, the lean arm) the wall still bounds them.
  collapse.spriteFar = Math.max(fogFar, atmosFogFar);
}
