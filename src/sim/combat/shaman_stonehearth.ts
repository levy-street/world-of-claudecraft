// Stonehearth Bastion (the shaman Crucible tank tier set, canonical design:
// docs/prd/ignivar-set-bonus-final.md): the two Stonebound-scoped bespoke
// bends, kept in one leaf module so the casting lifecycle and the Warspirit
// cadence engine share ONE eligibility predicate.
//
// The 2pc ("While Stonebound, Stormcast Mending Waters costs no mana and
// heals 25 percent more") has three casting_lifecycle consumers of the same
// predicate: the affordability pre-gate (a wearer at any mana level may press
// the button), the Stormcast consume site (which zeroes the bill only AFTER
// the Stormcast cheap charge is consumed, the set doc's consume-order note:
// zeroing earlier short-circuits that consume on `res.cost > 0` and leaves
// the half-cost aura alive for a later cast), and the friendly-completion
// heal multiplier (threaded through runEffects' cast-scoped castHealMult so
// the printed 25 percent reaches the WHOLE resolved heal, authored roll plus
// Spell Power rider).
//
// The posture is a PARAMETER (callers pass warspiritPosture(p)) rather than
// an import from combat/shaman_warspirit.ts: the cadence engine itself calls
// the 4pc arm below, and importing the posture reader back from it would
// create an import cycle.
//
// Draws no rng anywhere; `src/sim`-pure (tests/architecture.test.ts).

import {
  STONEHEARTH_2PC_MENDING_HEAL_BONUS,
  STONEHEARTH_4PC_CADENCE_HEAL_PCT_MAX,
} from '../content/ignivar_set_bonuses';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { wearsSetBonus } from './set_bonus_wearer';

export const STONEHEARTH_SET_ID = 'stonehearth';

type WarspiritPosture = 'galeheart' | 'stonebound' | null;

/** True when this Mending Waters cast rides Stormcast while Stonebound for a
 *  Stonehearth 2pc wearer: the cast bills no mana and heals 25 percent more.
 *  `stormcastCommitted` is the caller's own knowledge of the Stormcast
 *  instant: armed-for-this-ability at the pre-gate, consumed at the consume
 *  site, and the non-null reservation at the completion site. */
export function stonehearthStormcastMendingActive(
  ctx: SimContext,
  p: Entity,
  abilityId: string,
  posture: WarspiritPosture,
  stormcastCommitted: boolean,
): boolean {
  if (abilityId !== 'healing_wave' || !stormcastCommitted) return false;
  if (posture !== 'stonebound') return false;
  return wearsSetBonus(ctx, p, STONEHEARTH_SET_ID, 2);
}

/** The cast-scoped outgoing-heal multiplier for the 2pc's empowered Mending
 *  Waters: 1 for every other cast, so non-wearer arithmetic never moves. */
export function stonehearthStormcastMendingHealMult(
  ctx: SimContext,
  p: Entity,
  abilityId: string,
  posture: WarspiritPosture,
  stormcastCommitted: boolean,
): number {
  return stonehearthStormcastMendingActive(ctx, p, abilityId, posture, stormcastCommitted)
    ? 1 + STONEHEARTH_2PC_MENDING_HEAL_BONUS
    : 1;
}

/** Stonehearth 4pc: completing a cadence while Stonebound heals the wearer
 *  for 3 percent of maximum health. A HEAL, never an absorb (Living Weapon's
 *  Stonebound absorb arms on the Stormcast CONSUME in onStormcastConsumed, a
 *  different site; no collision). canCrit false SKIPS the crit roll, so the
 *  heal draws NO rng and the shared stream order is untouched; the name and
 *  ability id reuse the localized Warspirit Cadence strings, so no new
 *  sim_i18n dictionary row is needed. */
export function stonehearthCadenceHeal(
  ctx: SimContext,
  p: Entity,
  posture: WarspiritPosture,
): void {
  if (posture !== 'stonebound') return;
  if (!wearsSetBonus(ctx, p, STONEHEARTH_SET_ID, 4)) return;
  const amount = Math.max(1, Math.round(p.maxHp * STONEHEARTH_4PC_CADENCE_HEAL_PCT_MAX));
  ctx.applyHeal(p, p, amount, 'Warspirit Cadence', 'warspirit_cadence', false, false);
}
