import type { Entity } from '../types';

export function spellCritBonusFromAuras(p: Entity): number {
  let bonus = 0;
  for (const aura of p.auras) {
    if (aura.kind === 'buff_spellcrit') bonus += aura.value;
  }
  return bonus;
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
// (Arcane Power, Icy Veins, Power Infusion). This is the single source of truth casts and
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

export function noteSpellHit(..._args: unknown[]): void {
  // Hot Streak state is not present in this target branch.
}
