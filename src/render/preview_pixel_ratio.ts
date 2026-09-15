// The pixel ratio a secondary preview context draws at (the Armory inspect,
// src/render/armory_preview.ts, and the mount skin panel,
// src/render/mount_preview.ts). Both panels open OVER the live world, whose
// own rAF keeps running behind the scrim, so a preview must never
// out-resolve the world it covers: the world clamps its own ratio to the
// active tier's `GFX.pixelRatioCap` (1.48 low and medium, 1.75 high and up,
// 1.25 on the iOS memory profile, 1.0 on the tight-memory rung; see
// gfx_aa_policy_core.ts), and a flat cap of 2 would let a DPR 3 phone on the
// low tier draw the preview at 2.0, about 1.8x the world's pixels, on a
// second context. One shared clamp, so the two rigs cannot drift apart.
import { GFX } from './gfx';

/** The device's ratio, capped at the world's active tier cap (read live:
 *  a preview opened after a graphics change follows the new tier). */
export function previewPixelRatio(devicePixelRatio: number, cap = GFX.pixelRatioCap): number {
  return Math.min(devicePixelRatio, cap);
}
