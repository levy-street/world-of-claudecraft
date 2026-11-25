// The Guardian of the Quench's cold, read at a glance (playtest feedback
// 2026-11-25: the cold debuff was only an icon, and its level needed a hover).
// Two display-only reads of the sim's 0 to 100 cold bar (QUENCH_AURAS.cold):
//  - the debuff icon's badge: the bar's own value, so the icon carries the
//    number the tooltip used to hide (auras_view.ts);
//  - five frost marks round the character (the proc overlay's ritual bank,
//    proc_overlay_route.ts): one per fifth of the bar, the fifth lit only when
//    the player is frozen solid.
// The sim is untouched: its cold still rises and falls smoothly.
//
// Pure: no DOM (UI_PURE_CORES).

import { QUENCH_AURAS, QUENCH_TUNING } from '../../../sim/encounters/smith_heart/quench_ids';

/** Marks in the frost bank: the fifth is the freeze itself. */
export const QUENCH_COLD_MARKS = 5;

/** The badge an aura's icon wears for the cold, or null when `id` is not the
 *  cold aura (the caller's usual stack rule applies). 0 means no badge: an
 *  empty bar draws a bare icon. */
export function quenchColdBadge(id: string, value: number | undefined): number | null {
  if (id !== QUENCH_AURAS.cold) return null;
  const v = Math.round(Number.isFinite(value) ? (value as number) : 0);
  return Math.max(0, Math.min(QUENCH_TUNING.coldMax, v));
}

/** How many frost marks are lit for a player carrying `auras`, or null when
 *  the player carries neither the cold nor the freeze (the overlay shows its
 *  class art instead). Four marks fill with the bar, a fifth of it each; the
 *  fifth lights when the player freezes solid. */
export function quenchColdMarks(auras: readonly { id: string; value?: number }[]): number | null {
  let cold: number | null = null;
  for (const a of auras) {
    if (a.id === QUENCH_AURAS.frozen) return QUENCH_COLD_MARKS;
    if (a.id === QUENCH_AURAS.cold) cold = a.value ?? 0;
  }
  if (cold === null) return null;
  const step = QUENCH_TUNING.coldMax / QUENCH_COLD_MARKS;
  const lit = Math.floor(Math.max(0, cold) / step);
  return Math.min(QUENCH_COLD_MARKS - 1, lit);
}
