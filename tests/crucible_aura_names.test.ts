import { afterEach, describe, expect, it } from 'vitest';
import { tEntity } from '../src/ui/entity_i18n';
import {
  ensureLocaleLoaded,
  getLanguage,
  setLanguage,
  supportedLanguages,
  t,
} from '../src/ui/i18n';
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
  it('shows the replacement Dawnweave thresholds in every supported locale, including inherited dialects', async () => {
    for (const code of supportedLanguages) {
      await ensureLocaleLoaded(code);
      setLanguage(code);
      const twoPiece = t('entities.itemSets.benison_dawnweave.bonus2');
      const fourPiece = t('entities.itemSets.benison_dawnweave.bonus4');
      expect(twoPiece, code).toMatch(/10\s*%|%10/);
      expect(twoPiece, code).toContain('3');
      expect(fourPiece, code).toContain('3');
      expect(fourPiece, code).toContain('60');
      expect(fourPiece, code).toMatch(/100\s*%|%100/);
    }
  });

  it('localizes the Dawnweave Whispered Prayer proc through its spell name in every non-Latin locale', async () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      await ensureLocaleLoaded(language);
      setLanguage(language);
      const name = localizeSimAuraName('Whispered Prayer');
      expect(name).toBe(tEntity({ kind: 'ability', id: 'lesser_heal', field: 'name' }));
      expect(name).not.toBe('Whispered Prayer');
      expect(name).toBeTruthy();
    }
  });

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
