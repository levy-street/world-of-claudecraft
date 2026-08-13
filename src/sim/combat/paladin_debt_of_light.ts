// Debt of Light (Dawnreaver, ability id `faithforged_guard`): the paladin's offensive
// defensive. It is armed BEFORE the blow lands and answers exactly ONE incoming
// hit: that hit is soaked up to a cap, the soaked amount is returned to the
// attacker as Holy damage, and the paladin banks 1 Devotion.
//
// "Returns what it soaked" is the whole rule, so a light tap returns a light tap
// and only a real blow pays out: the button rewards reading the fight rather than
// mashing it on cooldown. The cap rides on the aura's value, which is what the
// ability authors and what a talent would scale.
//
// Kept as a leaf so a Vitest can pin the arithmetic and the one-hit-only rule
// without standing up a live Sim. The caller (combat/damage.ts) owns the damage
// application and the aura-removal event, because only it can re-enter dealDamage
// safely.
import type { Entity } from '../types';

export const DEBT_OF_LIGHT_KIND = 'paladin_debt_of_light' as const;
export const DEBT_OF_LIGHT_DEVOTION = 1;
export const DEBT_OF_LIGHT_ABILITY_ID = 'faithforged_guard';

export interface DebtOfLightAnswer {
  /** Damage removed from the incoming hit, and the Holy damage owed back. */
  soaked: number;
}

export function debtOfLightAura(entity: Entity): Entity['auras'][number] | null {
  for (const aura of entity.auras) {
    if (aura.kind === DEBT_OF_LIGHT_KIND) return aura;
  }
  return null;
}

/**
 * What an armed Debt of Light does to one incoming hit, or null when nothing happens
 * so the caller can skip every side effect in a single branch.
 *
 * Answered only when there IS an attacker other than the paladin: falling damage,
 * a DoT tail from a dead caster and self-damage never burn the charge with
 * nothing to answer. The soak is capped by the aura's value; the return equals
 * what was ACTUALLY soaked, never the cap.
 */
export function answerDebtOfLight(
  cap: number,
  incoming: number,
  hasAttacker: boolean,
): DebtOfLightAnswer | null {
  if (!hasAttacker || incoming <= 0 || cap <= 0) return null;
  return { soaked: Math.min(cap, incoming) };
}
