// The Guardian of the Quench's cold, read at a glance (playtest feedback
// 2026-11-25: the cold debuff was only an icon, and its level needed a hover).
// A display-only read of the sim's 0 to 100 cold bar (QUENCH_AURAS.cold): the
// debuff icon's badge is the bar's own value, 0 to 99, so the icon carries the
// number the tooltip used to hide (auras_view.ts). At 100 the player freezes,
// and the cold's icon gives way to the freeze's own debuff while it holds
// (quenchColdIconHidden). The sim is untouched: its cold still rises and
// falls smoothly.
//
// Pure: no DOM (UI_PURE_CORES).

import { QUENCH_AURAS, QUENCH_TUNING } from '../../../sim/encounters/smith_heart/quench_ids';

/** The badge's ceiling: one short of the freeze (a full bar IS the freeze,
 *  which wears its own debuff). */
export const QUENCH_COLD_BADGE_MAX = QUENCH_TUNING.coldMax - 1;

/** The badge an aura's icon wears for the cold (0 to 99), or null when `id`
 *  is not the cold aura (the caller's usual stack rule applies). 0 means no
 *  badge: an empty bar draws a bare icon. */
export function quenchColdBadge(id: string, value: number | undefined): number | null {
  if (id !== QUENCH_AURAS.cold) return null;
  const v = Math.round(Number.isFinite(value) ? (value as number) : 0);
  return Math.max(0, Math.min(QUENCH_COLD_BADGE_MAX, v));
}

/** True when the player is frozen solid: the cold's icon stands down for the
 *  freeze's own debuff while it holds. */
export function quenchFrozenSolid(auras: readonly { id: string }[]): boolean {
  for (const a of auras) if (a.id === QUENCH_AURAS.frozen) return true;
  return false;
}

/** Whether aura `id` draws no icon this frame (`frozen` from quenchFrozenSolid,
 *  read once per strip): the cold, while its player is frozen solid. */
export function quenchColdIconHidden(id: string, frozen: boolean): boolean {
  return frozen && id === QUENCH_AURAS.cold;
}
