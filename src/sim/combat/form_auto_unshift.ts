// Auto-unshift: a druid who presses a healing or damaging spell while wearing an
// action-locking form leaves the form and casts the spell, instead of being
// refused with "You can't do that while shapeshifted."
//
// This is the classic-era `autoUnshift` behavior, and it is deliberately narrow:
//
//   scope      Only the three DRUID forms that lock the caster kit (Bruin, Wolf,
//              Fleet: the isResourceShiftFormAuraKind set). The mage Ember Form
//              (form_fireball) is authored as a hard "cannot attack or cast"
//              transform and keeps its refusal.
//   trigger    Only a HEALING or DAMAGING ability. A buff, a debuff, a taunt, a
//              crowd-control spell, a profession action, and everything else
//              still refuses, so a druid never loses a form to a stray keypress.
//   cost       Free. Leaving a form has always been free in this sim
//              (spendAbilityCost's 'off' branch), and the shift out consumes no
//              global cooldown either: an instant spell such as Lunar Tempest
//              goes off the moment it is pressed. Shifting back IN is a normal
//              ability and still bills its cost and its GCD.
//
// The classification reads the ability DEFINITION, not the rank-resolved effect
// list. Whether a button is "a heal" or "a nuke" is the button's identity and
// must not change with the rank the caster happens to have trained: Entangling
// Roots grows a damage-over-time component at rank 3, and a druid whose root
// silently started dropping their form at level 14 would read as a bug. The
// def the caller passes is already the ACTION-REPLACED def when a transform is
// live (Swiftmend to Overbloom), so a replaced button is classified as what it
// actually casts.
import { recalcPlayerStats } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { AbilityDef, AbilityEffect, Aura, Entity } from '../types';
import { isFormAuraKind } from '../types';
import { isResourceShiftFormAuraKind } from './forms';

type EffectType = AbilityEffect['type'];

/** Effects that put damage on a target. */
export const DAMAGING_EFFECT_TYPES: ReadonlySet<EffectType> = new Set<EffectType>([
  'aoeDamage',
  'chainDamage',
  'directDamage',
  'dot',
  'finisherDamage',
  'groundAoE',
  'weaponDamage',
  'weaponStrike',
]);

/** Effects that put health back on a friendly target (or on the caster). */
export const HEALING_EFFECT_TYPES: ReadonlySet<EffectType> = new Set<EffectType>([
  'aoeHeal',
  'chainHeal',
  'druidOverbloom',
  'heal',
  'hot',
  'selfHealPctMax',
  'selfHotPctMax',
]);

/** Does this ability deal damage or restore health? `consumeAura` is the one
 *  effect that is neither on its own: Swiftmend spends a heal-over-time to heal
 *  and the warlock nukes spend a damage-over-time to deal, so it qualifies only
 *  through the payload it actually carries. */
export function isHealingOrDamagingAbility(def: AbilityDef): boolean {
  return def.effects.some((effect) => {
    if (effect.type === 'consumeAura')
      return effect.heal !== undefined || effect.deal !== undefined;
    return DAMAGING_EFFECT_TYPES.has(effect.type) || HEALING_EFFECT_TYPES.has(effect.type);
  });
}

/** Is this ability a shapeshift toggle (its own form button)? One source of
 *  truth for the cast gate and for this module: a form button pressed in form
 *  is a deliberate shift, never an auto-unshift. */
export function isFormToggleAbility(def: AbilityDef): boolean {
  return def.effects.some((e) => e.type === 'selfBuff' && isFormAuraKind(e.kind));
}

/** Would pressing `def` while wearing `auras` auto-unshift? Pure: the same
 *  question the cast gate asks and the action bar asks when it decides which
 *  pool a slot is affordable against. Mirrors the cast gate's refusal exactly,
 *  so the two can never disagree about which presses are allowed. */
export function willAutoUnshift(auras: readonly Pick<Aura, 'kind'>[], def: AbilityDef): boolean {
  if (def.requiresForm !== undefined || def.usableInForm || isFormToggleAbility(def)) return false;
  if (!auras.some((a) => isResourceShiftFormAuraKind(a.kind))) return false;
  return isHealingOrDamagingAbility(def);
}

/** The parked pool as the SELF snapshot should carry it (server/game.ts, the
 *  sparse `sm` key), so the action bar can price an auto-unshifting cast
 *  against the mana that will actually pay for it.
 *
 *  Floors, and the floor is the contract, not a formatting choice. The bar
 *  refuses a slot when its pool is under the cost, and every payable cost is a
 *  whole number, so flooring makes the client's "floor(pool) < cost" exactly
 *  equivalent to the server's own "pool < cost". Rounding is off by one in the
 *  player's disfavour at a fractional pool (24.6 parked against a 25 cost
 *  rounds up to 25, lighting a slot the server then refuses), which is the one
 *  thing this field exists to prevent. */
export function wireParkedMana(savedMana: number): number {
  return Math.floor(savedMana);
}

/** Drop every druid form the caster wears so the pending cast can proceed.
 *  Mirrors the toggle-off path in effect_dispatch (splice, fade event, stat
 *  recalc), which is what returns the parked mana pool to the live bar.
 *  Returns false and touches nothing when this cast does not auto-unshift. */
export function applyAutoUnshift(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  def: AbilityDef,
): boolean {
  if (!willAutoUnshift(p.auras, def)) return false;
  for (let i = p.auras.length - 1; i >= 0; i--) {
    const aura = p.auras[i];
    if (!isResourceShiftFormAuraKind(aura.kind)) continue;
    p.auras.splice(i, 1);
    ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
  }
  // Stalk is Wolf Form's stealth (requiresForm: 'cat'), so it goes out with the
  // form. Pressing the form button by hand already ends it, though only as a
  // side effect: casting an ability breaks stealth when its effects resolve.
  // An auto-unshift casts no form button, so without this the druid would keep
  // Stalk through the whole spell and only lose it at the cast's own commit,
  // which on a 2.5s Wildmend is 2.5 seconds of hidden casting the manual route
  // never grants. Routed through the single breakStealth funnel so the fade
  // event and the rogue Duskveil bookkeeping behave as they do everywhere else.
  ctx.breakStealth(p);
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  return true;
}
