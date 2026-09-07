// Pure derivation of the absorb-shield overlay for unit-frame health bars.
//
// Classic-era clients render active damage-absorb shields — priest wards,
// Ice Barrier, the paladin holy shield, etc. — as a lighter segment laid over
// the health bar that extends past current health toward the bar's right edge.
// The sim already models these as `kind: 'absorb'` auras whose `value` is the
// remaining damage they will soak (decremented in `dealDamage`). This module
// turns that state into the fractions the HUD applies; kept DOM-free so the
// math can be snapshot tested directly (mirrors xp_bar.ts).

import type { Aura } from '../sim/types';
import { clamp01 } from './clamp';

export interface AbsorbBarInput {
  hp: number;
  maxHp: number;
  auras?: Aura[];
  /** Compact pre-summed value used by party snapshots, which do not carry full auras. */
  total?: number;
}

export interface AbsorbBarView {
  total: number; // summed remaining absorb across all active shields
  fillFrac: number; // 0..1 right edge of the shield overlay, kept for callers/tests
  startFrac: number; // 0..1 left edge of the visible shield segment
  sizeFrac: number; // 0..1 width of the visible shield segment
  overshield: boolean; // absorb reaches/passes the bar's right edge (fully shielded)
}

// Total remaining absorb across every shield aura on the entity. Negative or
// spent shields contribute nothing.
export function absorbTotal(auras: Aura[]): number {
  let n = 0;
  for (const a of auras) if (a.kind === 'absorb') n += Math.max(0, a.value);
  return n;
}

export function absorbBarView(input: AbsorbBarInput): AbsorbBarView {
  return absorbBarViewInto(
    {
      total: 0,
      fillFrac: 0,
      startFrac: 0,
      sizeFrac: 0,
      overshield: false,
    },
    input,
  );
}

/**
 * Fill a caller-owned view. HUD unit frames use this path so resolving shields
 * does not allocate a short-lived object every animation frame.
 */
export function absorbBarViewInto(out: AbsorbBarView, input: AbsorbBarInput): AbsorbBarView {
  const max = Math.max(1, input.maxHp);
  const hp = Math.max(0, input.hp);
  const hpFrac = clamp01(hp / max);
  const total = Math.max(0, input.total ?? absorbTotal(input.auras ?? []));
  const fillFrac = clamp01((hp + total) / max);
  const sizeFrac = total > 0 ? clamp01(total / max) : 0;
  const overshield = total > 0 && hp + total >= max;
  const startFrac = overshield ? clamp01(1 - sizeFrac) : hpFrac;
  out.total = total;
  out.fillFrac = fillFrac;
  out.startFrac = startFrac;
  out.sizeFrac = sizeFrac;
  out.overshield = overshield;
  return out;
}

/**
 * The CSS transform that places the shield overlay as a SEGMENT: it starts at
 * the current-health edge (or is right-aligned when overshielded) and spans only
 * the shield's own width, so a bar with no shield carries no hatch at all and a
 * 10% shield hatches 10% of the bar, never the whole health fill. Percent
 * translate is relative to the overlay's own width (100% of the bar); the scale
 * is applied about the left edge after the translate (CSS lists transforms in
 * application order), so the segment occupies [start, start + size]. The scale
 * writer is injectable so a party row keeps its quantized `scaleX(0.250)` form.
 */
export function absorbSegmentTransform(
  startFrac: number,
  sizeFrac: number,
  scaleX: (frac: number) => string = defaultScaleX,
): string {
  // Constant two-function shape even when empty: `.bar-absorb` transitions its
  // transform, and a list-shape flip (one function vs two) would force matrix
  // interpolation through a singular scaleX(0) endpoint (a visible sweep).
  const size = sizeFrac > 0 ? sizeFrac : 0;
  return `translateX(${absorbTranslatePercent(startFrac)}%) ${scaleX(size)}`;
}

// The translate is quantized to three decimals so the elided setTransform cache
// key stays stable frame to frame (a raw float such as 41.666666666666664 would
// miss the write-elision seam on every frame a shield is up).
function absorbTranslatePercent(startFrac: number): number {
  return Number((startFrac * 100).toFixed(3));
}

// The byte-faithful player / target scale writer; a party row supplies its own
// quantizing formatter (fixed decimals) through the painter's formatScaleX option.
function defaultScaleX(frac: number): string {
  return `scaleX(${frac})`;
}
