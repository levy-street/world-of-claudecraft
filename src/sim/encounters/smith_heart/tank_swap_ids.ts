// The Smith's Heart's five tank swaps as data: which debuff on the boss's tank
// asks for the swap, and at how many stacks. The HUD's one tank swap alert
// (src/ui/hud/dungeon/tank_swap_alert_view.ts) and its tests read this table;
// the sim itself never does (each fight applies its own debuff).
//
//   Hammer Council           Hammer's Weight (council_wrath.ts): one stack is
//                            the swap (+100 percent physical damage taken).
//   Guardian of the Breath   Wind-Battered in the Wind, Thunder-Laden in the
//                            Storm (breath_blow.ts): the tier's count rides
//                            the aura's `value3` (BREATH_DIFFICULTY blowSwap,
//                            thunderSwap).
//   Guardian of the Heat     Cinder Grip (the template's stackPoison): the
//                            HEAT_TUNING `gripSwap` stacks, every tier; and
//                            Wellspring Brand (heat_brand.ts): one brand is
//                            the swap (HEAT_TUNING `brandSwap`).
//   Guardian of the Quench   Rime-Tempered (quench_temper.ts): the tier's
//                            count rides the aura's `value3`
//                            (QUENCH_DIFFICULTY temperSwap).
//   Masterless Strength      Elemental Strike (final_strike.ts), any of its
//                            four element debuffs (a strike re-forges the
//                            stacks, so they count as one): ELEMENT_TUNING
//                            `swapAt`, every tier.
//
// Pure data and one pure reader; no rng, no state.

import { BREATH_AURAS } from './breath_ids';
import { COUNCIL_AURAS, COUNCIL_TUNING } from './council_ids';
import { ELEMENT_TUNING, STRIKE_AURAS } from './final_elements_ids';
import { HEAT_AURAS, HEAT_TUNING } from './heat_ids';
import { QUENCH_AURAS } from './quench_ids';

export type HeartSwapBoss = 'council' | 'breath' | 'heat' | 'quench' | 'final';

export interface HeartTankSwap {
  boss: HeartSwapBoss;
  /** The debuff ids that count as one swap family (a body carries one). */
  auras: readonly string[];
  /** The fixed swap count, or null when the tier's count rides `value3`. */
  swapAt: number | null;
}

export const HEART_TANK_SWAPS: readonly HeartTankSwap[] = [
  { boss: 'council', auras: [COUNCIL_AURAS.weight], swapAt: COUNCIL_TUNING.weightSwap },
  { boss: 'breath', auras: [BREATH_AURAS.battered], swapAt: null },
  { boss: 'breath', auras: [BREATH_AURAS.thunderLaden], swapAt: null },
  { boss: 'heat', auras: [HEAT_AURAS.grip], swapAt: HEAT_TUNING.gripSwap },
  { boss: 'heat', auras: [HEAT_AURAS.brand], swapAt: HEAT_TUNING.brandSwap },
  { boss: 'quench', auras: [QUENCH_AURAS.tempered], swapAt: null },
  { boss: 'final', auras: Object.values(STRIKE_AURAS), swapAt: ELEMENT_TUNING.swapAt },
];

/** The swap family an aura id belongs to (null: not a tank swap debuff). */
export function heartTankSwapOf(auraId: string): HeartTankSwap | null {
  for (const s of HEART_TANK_SWAPS) if (s.auras.includes(auraId)) return s;
  return null;
}

/** The stack count at which `swap` is due for an aura carrying `value3`
 *  (the tier's own count where the fight writes it there). Never below 1;
 *  Infinity when a `value3` family's aura carries none (never due). */
export function heartTankSwapAt(swap: HeartTankSwap, value3: number | undefined): number {
  if (swap.swapAt !== null) return Math.max(1, swap.swapAt);
  return value3 !== undefined && value3 > 0 ? Math.max(1, value3) : Number.POSITIVE_INFINITY;
}
