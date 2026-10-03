// Morthen's fighting numbers for the run owner, taken from the shipped `morthen`
// template through the same formula createMob uses (mobBaseStats). Applied by
// recalcPlayerStats AFTER its normal pass (run over no gear and no talents), so
// every derived field is reset first and only the template's numbers win.

import { MOBS } from '../data';
import { mobBaseStats } from '../mob_base_stats';
import type { Entity } from '../types';

export const MORTHEN_TEMPLATE_ID = 'morthen';

// The level the owner is pinned to for the run (the template's own level).
export function morthenLevel(): number {
  return MOBS[MORTHEN_TEMPLATE_ID].maxLevel;
}

// `prevHp` / `prevMaxHp` are the pool before the recalc, so the health fraction
// is carried over Morthen's own maximum and rounded once.
export function applyMorthenProfile(e: Entity, prevHp: number, prevMaxHp: number): void {
  const base = mobBaseStats(MOBS[MORTHEN_TEMPLATE_ID], e.level);
  const hpFrac = prevMaxHp > 0 ? prevHp / prevMaxHp : 1;
  e.maxHp = base.maxHp;
  e.hp = e.dead ? 0 : Math.max(1, Math.round(base.maxHp * hpFrac));
  e.weapon = base.weapon;
  e.offhandWeapon = null;
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
}
