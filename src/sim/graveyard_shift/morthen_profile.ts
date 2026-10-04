// Morthen's fighting numbers for the run owner, taken from the shipped `morthen`
// template through the same formula createMob uses (mobBaseStats). Applied by
// recalcPlayerStats AFTER its normal pass (run over no gear and no talents), so
// every derived field is reset first and only the template's numbers win.

import { MOBS } from '../data';
import { mobBaseStats } from '../mob_base_stats';
import type { Entity, ResourceType } from '../types';
import { carriedDread, DREAD_MAX } from './dread';

export const MORTHEN_TEMPLATE_ID = 'morthen';

// One player against a party: the template is tuned to lose to five players.
// Owner decision: scale the boss, not the party. Tuned on a headless probe over
// five seeds against the full party of five, the next-room opening and the
// corpse run (2026-10-04): walking up and hitting only the tank, or pressing
// buttons at random, lose; a sharp scripted player (Chain the healer, Pulse
// into the melee, raise the dead) wins with about a third of his health left.
export const MORTHEN_SOLO_HP_MULT = 2.2;
export const MORTHEN_SOLO_DAMAGE_MULT = 2;

// The level the owner is pinned to for the run (the template's own level).
export function morthenLevel(): number {
  return MOBS[MORTHEN_TEMPLATE_ID].maxLevel;
}

// `prevHp` / `prevMaxHp` are the pool before the recalc, so the health fraction
// is carried over Morthen's own maximum and rounded once. `prevResourceType` /
// `prevResource` carry the Dread bar the same way (the base pass reset it to
// the real class's resource).
export function applyMorthenProfile(
  e: Entity,
  prevHp: number,
  prevMaxHp: number,
  prevResourceType: ResourceType | null,
  prevResource: number,
): void {
  const base = mobBaseStats(MOBS[MORTHEN_TEMPLATE_ID], e.level);
  const hpFrac = prevMaxHp > 0 ? prevHp / prevMaxHp : 1;
  e.maxHp = Math.round(base.maxHp * MORTHEN_SOLO_HP_MULT);
  e.hp = e.dead ? 0 : Math.max(1, Math.round(e.maxHp * hpFrac));
  e.weapon = {
    min: base.weapon.min * MORTHEN_SOLO_DAMAGE_MULT,
    max: base.weapon.max * MORTHEN_SOLO_DAMAGE_MULT,
    speed: base.weapon.speed,
  };
  e.offhandWeapon = null;
  e.resourceType = 'dread';
  e.maxResource = DREAD_MAX;
  e.resource = carriedDread(prevResourceType, prevResource);
  e.dualWielding = false;
  // A mob carries no primary stats and the entity defaults for every derived
  // combat number: nothing of the real class's base stats reaches the kit.
  e.stats = { ...e.stats, str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: base.armor };
  e.attackPower = 0;
  e.rangedPower = 0;
  e.spellPower = 0;
  e.healPower = 0;
  e.meleeHaste = 0;
  e.rangedHaste = 0;
  e.spellHaste = 0;
  e.critChance = 0.05;
  e.sharedCritBonus = 0;
  e.critRating = 0;
  e.hasteRating = 0;
  e.hitRating = 0;
  e.hitBonus = 0;
  e.critDmgSpellBonus = 0;
  e.critDmgPhysBonus = 0;
  e.critDmgHealBonus = 0;
  e.dodgeChance = 0.05;
  e.blockChance = 0;
  e.blockValue = 0;
  // A boss's cast is never pushed back: with five adventurers landing hits, the
  // classic player pushback (uncapped per hit) kept Shadow Pulse from ever
  // finishing. Kicks still cut it.
  e.castPushbackReduction = 1;
}
