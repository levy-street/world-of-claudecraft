// Which scatter decorations survive the low-end triangle-count trim
// (GFX.leanFoliage, foliage.ts buildTrees). Pure and Three/DOM-free so a
// Vitest can pin it without a renderer: tests/foliage_decimation_core.test.ts.
//
// A rock big enough to carry a real collider (sim/decoration_dims.ts
// decorationHasCollider, backed by sim/colliders.ts) is exempt from the trim:
// a graphics preset may shed cosmetic dressing, but the root CLAUDE.md
// graphics-fairness invariant forbids hiding something a player can be
// blocked by while standing right in front of it. Tree/tree2 decimation is
// left exactly as tuned; every tree trunk also carries an unconditional
// collider (decorationHasCollider), so the identical gap exists for trees,
// tracked separately rather than folded into this fix's perf-neutral scope.

import { decorationHasCollider } from '../sim/decoration_dims';
import type { Decoration } from '../sim/world';

function leanKeepRate(kind: Decoration['kind'], standardMaterials: boolean): number {
  if (kind === 'rock') return standardMaterials ? 0.74 : 0.55;
  return standardMaterials ? 0.68 : 0.46;
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
  if (d.kind === 'rock' && decorationHasCollider(d)) return true;
  return hashDraw < leanKeepRate(d.kind, standardMaterials);
}
