import { afterEach, describe, expect, it } from 'vitest';
import { getLanguage, setLanguage } from '../src/ui/i18n';
import { DICT, localizeSimAuraName } from '../src/ui/sim_i18n';

const AURAS = [
  ['aura.craftedMomentum', 'Crafted Momentum'],
  ['aura.craftedShelter', 'Crafted Shelter'],
  ['aura.craftedPreservation', 'Crafted Preservation'],
  ['aura.craftedCollection', 'Crafted Collection'],
  ['aura.lastflameZeal', "Last Flame's Zeal"],
] as const;
const originalLanguage = getLanguage();
afterEach(() => setLanguage(originalLanguage));

describe('Crucible profession aura names', () => {
  it('registers the exact runtime aura names for both gain logs and buff tooltips', () => {
    setLanguage('en');
    for (const [, name] of AURAS) expect(localizeSimAuraName(name), name).toBe(name);
  });

  it('fills all five non-Latin aura name dictionaries', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      const dict = DICT[language] as Record<string, string | undefined>;
      for (const [key, english] of AURAS) {
        expect(dict[key], `${language}: ${key}`).toBeTruthy();
        expect(dict[key], `${language}: ${key}`).not.toBe(english);
      }
    }
  });
});
