import { afterEach, describe, expect, it } from 'vitest';
import { type SupportedLanguage, setLanguage } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

const NAMES = [
  'Emberforge Front',
  'Grask Widebreaker',
  'Grask Cleaver',
  'Grask Skullsplitter',
  'Whiteout Gust',
  'Crashing Tide',
  'Treacherous Ice',
  'Emberfall',
  'Howling Blizzard',
  'Voidfall',
  'Event Horizon',
  'Singularity Collapse',
  'Ring of Frost',
  'Tempest Judgment',
  'Lightning Strike',
  'Charged Ground',
  'Healing Tide',
  'Spore Cloud',
  'Bloated Cap',
  'Claw Rake',
  'Eruption',
  'Falling Rock',
  'Plunging Dive',
  'Deafening Screech',
  'Voracious Bite',
  'Crushing Leap',
  'Cursed Coins',
] as const;

afterEach(() => setLanguage('en'));

describe('Buried Hoard boss mechanic localization', () => {
  it('registers every authored combat, heal, and aura label', () => {
    setLanguage('en');
    for (const name of NAMES) expect(localizeSimAuraName(name)).toBe(name);
  });

  it('fills Spanish and every required non-Latin locale', () => {
    const languages: SupportedLanguage[] = ['es_ES', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'];
    for (const language of languages) {
      setLanguage(language);
      for (const name of NAMES) {
        const localized = localizeSimAuraName(name);
        expect(localized, `${language} did not resolve ${name}`).not.toBeNull();
        expect(localized, `${language} retained English ${name}`).not.toBe(name);
      }
    }
  });
});
