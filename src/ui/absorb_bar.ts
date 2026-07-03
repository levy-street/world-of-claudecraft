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

export interface AbsorbBarInput {
  hp: number;
  maxHp: number;
  auras: Aura[];
}

export interface AbsorbBarView {
  total: number; // summed remaining absorb across all active shields
  fillFrac: number; // 0..1 width of the shield overlay = (hp + absorb)/maxHp, clamped
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
  const max = Math.max(1, input.maxHp);
  const hp = Math.max(0, input.hp);
  const total = absorbTotal(input.auras);
  const fillFrac = clamp01((hp + total) / max);
  const overshield = total > 0 && hp + total >= max;
  return { total, fillFrac, overshield };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
