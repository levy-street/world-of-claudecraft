import type { Aura } from '../types';

const SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS = new Set([
  'arcane_intellect',
  'battle_shout',
  'blessing_of_might',
  'devotion_aura',
  'mark_of_the_wild',
  'power_word_fortitude',
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
