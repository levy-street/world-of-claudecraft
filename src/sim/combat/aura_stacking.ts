import type { Aura } from '../types';

// Persistent group buffs that are ONE per target regardless of caster: a second
// same-class caster REPLACES the existing aura instead of stacking a duplicate (no
// double Arcane Intellect, no two Sureflight Auras, etc.). Every party group buff
// belongs here. The buffTarget party buffs use the ability id as the aura id, while
// the aoeAllyAttackPower buffs apply as `${abilityId}_ap`. Exported so
// tests/group_buff_self_stacking.test.ts can enforce the rule: every aoeAlly
// group buff is either Bloodlust-style exhaustion-gated (the 'sated' debuff)
// or listed here; a new group buff with neither guard fails that test loudly.
export const SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS: ReadonlySet<string> = new Set([
  'arcane_intellect',
  // Pack Rally uses three fixed aura ids. A later Hunter refreshes the group
  // effect instead of multiplying it across sources.
  'hunter_pack_rally_speed',
  'hunter_pack_rally_haste',
  'hunter_pack_rally_spellhaste',
  // Wildfang Rally (v0.27.1): two hunters must not double the +45 AP / +5%
  // haste; both halves dedupe across sources like every other group buff.
  'aspect_of_the_wild',
  'aspect_of_the_wild_ap',
  'battle_shout',
  'blessing_of_might',
  'devotion_aura',
  // The overhauled Paladin aura kit. Every one is a persistent party buff, so a
  // second Paladin running the SAME aura refreshes it instead of granting the
  // effect twice: no double 5% damage reduction, no double thorns, no two copies
  // of one Devotion. Distinct auras still coexist (Bastion plus Requital, or one
  // Paladin's Dawn next to another's Grace), which is what the tooltips mean by
  // Devotions from different Paladins working together.
  'devotion_ward',
  'retribution_aura',
  'radiant_devotion',
  'dawn_devotion',
  'grace_devotion',
  // Emboldening Roar (Fury aoeAllySureCrit): two Fury warriors must not stack
  // two separate 3-charge guaranteed-crit auras on a shared ally.
  'emboldening_roar_crit',
  'mark_of_the_wild',
  // Mass Barrier (mage aoeAllyAbsorb): two mages must not stack two separate
  // 130-absorb shields on a shared ally; the later cast replaces the first.
  'mass_barrier',
  // Nature's Fury (druid buff_spellcrit pulse): two druids in the same party
  // pulsing onto a shared ally must not double the 3% spell-crit bonus.
  'natures_fury',
  'power_word_fortitude',
  'rallying_cry_dr',
  'rallying_cry_hp',
  'rune_of_power',
  'sanguine_aura',
  'soulwell',
  'trueshot_aura_ap', // Sureflight Aura (hunter aoeAllyAttackPower)
  'temporal_hourglass',
  'aura_mastery',
]);

export function auraReplacementConflicts(auras: readonly Aura[], aura: Aura): number[] {
  const replaceAcrossSources = SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS.has(aura.id);
  const out: number[] = [];
  for (let i = auras.length - 1; i >= 0; i--) {
    const existing = auras[i];
    if (existing.id !== aura.id) continue;
    if (replaceAcrossSources || existing.sourceId === aura.sourceId) out.push(i);
  }
  return out;
}
