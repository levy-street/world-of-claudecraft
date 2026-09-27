import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { fireMageOnSpellHit } from './fire_mage';
import { frostMageOnSpellHit } from './frost_mage';

export function spellCritBonusFromAuras(p: Entity): number {
  let bonus = 0;
  for (const aura of p.auras) {
    if (aura.kind === 'buff_spellcrit') bonus += aura.value;
    else if (aura.kind === 'sacred_form') bonus += aura.value2 ?? 0.05;
  }
  return bonus;
}

// Spell crit is its own pool, separate from the melee/ranged Entity.critChance:
// the same 5% base, Intellect in place of Agility, then the class-agnostic crit
// core both hit tables share (crit rating, talent/set crit, flat crit auras;
// recalcPlayerStats) and the spell-only crit auras above. Every spell and heal
// crit roll reads this through Sim.spellCrit, and the character sheet's Spell
// Crit cell calls it on both hosts (the online self mirror carries the shared
// core as the `scb` self scalar), so the sheet can never drift from the roll.
export const SPELL_CRIT_BASE = 0.05;
export const SPELL_CRIT_PER_INT = 0.0008;

export function spellCritChance(p: Entity): number {
  return (
    SPELL_CRIT_BASE +
    p.stats.int * SPELL_CRIT_PER_INT +
    (p.sharedCritBonus ?? 0) +
    spellCritBonusFromAuras(p)
  );
}

export function spellDamageMultFromAuras(p: Entity): number {
  let bonus = 0;
  for (const aura of p.auras) {
    if (aura.kind === 'buff_spelldmg') bonus += aura.value;
    // Moonkin Form carries its +20% spell damage on the form aura itself (a toggle, so no
    // companion buff aura to strand when the druid shifts out).
    else if (aura.kind === 'form_moonkin') bonus += 0.2;
  }
  return 1 + bonus;
}

// The total spell-haste multiplier for a caster: the resolved Entity.spellHaste stat
// (item-set bonuses + spec-mastery passive haste) PLUS any live buff_spellhaste auras
// (e.g. Aether Surge, Coldsurge, Lich Form, Anointing's target buff). This is the
// single source of truth casts and
// the cast-time tooltips both read, so a shown cast time never disagrees with reality.
export function spellHasteMult(p: Entity): number {
  let bonus = p.spellHaste;
  for (const aura of p.auras) {
    if (aura.kind === 'buff_spellhaste') bonus += aura.value;
  }
  return 1 + Math.max(0, bonus);
}

export function hasCastShield(p: Entity): boolean {
  return p.auras.some((aura) => aura.kind === 'cast_shield');
}

export function noteSpellHit(ctx: SimContext, p: Entity, crit: boolean, abilityId?: string): void {
  // The Hot Streak feed (combat/fire_mage.ts): every resolved spell hit flows
  // through here, so the fire mage's streak counter READS crits already rolled
  // and never draws dice of its own.
  fireMageOnSpellHit(ctx, p, abilityId, crit);
  // The Frostquench 2pc crit-Icicle feed (combat/frost_mage.ts): same
  // contract, reads the rolled crit and draws no dice of its own.
  frostMageOnSpellHit(ctx, p, abilityId, crit);
}
