// Which scatter decorations survive the low-end triangle-count trim
// (GFX.leanFoliage, foliage.ts buildTrees). Pure and Three/DOM-free so a
// Vitest can pin it without a renderer: tests/foliage_decimation_core.test.ts.
//
// Any decoration with a real collider (sim/decoration_dims.ts
// decorationHasCollider, backed by sim/colliders.ts) is exempt from the trim:
// a graphics preset may shed cosmetic dressing, but the root CLAUDE.md
// graphics-fairness invariant forbids hiding something a player can be
// blocked by while standing right in front of it. Every tree/tree2 trunk
// carries an unconditional collider, so this exemption keeps every tree; the
// hash-based keep rate below now only ever runs for a rock under the
// collider floor (see docs/design/graphics-settings-fairness.md, "Low-tier
// trees with a real collider stayed invisible too").

import { decorationHasCollider } from '../sim/decoration_dims';
import type { Decoration } from '../sim/world';

// The exemption above routes every collider-bearing decoration away from
// this rate before it is ever called; only a dressing rock (below
// ROCK_COLLIDER_MIN_SCALE, the one decoration kind that can lack a collider)
// can still reach it, so there is only a rock rate left to tune.
function leanRockKeepRate(standardMaterials: boolean): number {
  return standardMaterials ? 0.74 : 0.55;
}

/**
 * Whether `d` survives the lean-foliage decimation, given the caller's own
 * deterministic hash draw (0..1, keyed on `d.x`/`d.z`) so this stays pure.
 * Callers only invoke this when GFX.leanFoliage is active; the full-detail
 * arm keeps every decoration and never calls in here.
 */
export function survivesLeanDecimation(
  d: Decoration,
  hashDraw: number,
  standardMaterials: boolean,
): boolean {
  if (decorationHasCollider(d)) return true;
  return hashDraw < leanRockKeepRate(standardMaterials);
}
