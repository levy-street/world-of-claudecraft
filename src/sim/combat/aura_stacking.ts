import type { Aura } from '../types';

// Persistent group buffs that are ONE per target regardless of caster: a second
// same-class caster REPLACES the existing aura instead of stacking a duplicate (no
// double Arcane Intellect, no two Sureflight Auras, etc.). Every party group buff
// belongs here. The buffTarget party buffs use the ability id as the aura id, while
// the hunter aura (aoeAllyAttackPower) applies as `${abilityId}_ap`.
const SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS = new Set([
  'arcane_intellect',
  'battle_shout',
  'blessing_of_might',
  'devotion_aura',
  'mark_of_the_wild',
  'power_word_fortitude',
  'trueshot_aura_ap', // Sureflight Aura (hunter aoeAllyAttackPower)
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
