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
  // Wildfang Rally (v0.27.1): two hunters must not double the +45 AP / +5%
  // haste; both halves dedupe across sources like every other group buff.
  'aspect_of_the_wild',
  'aspect_of_the_wild_ap',
  'battle_shout',
  'blessing_of_might',
  'devotion_aura',
  'mark_of_the_wild',
  'power_word_fortitude',
  'rallying_cry_dr',
  'rallying_cry_hp',
  'rune_of_power',
  'sanguine_aura',
  'trueshot_aura_ap', // Sureflight Aura (hunter aoeAllyAttackPower)
  'temporal_hourglass',
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
