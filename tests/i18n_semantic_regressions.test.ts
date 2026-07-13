import { describe, expect, it } from 'vitest';
import type { TranslationKey } from '../src/ui/i18n.catalog';
import { da_DK } from '../src/ui/i18n.locales/da_DK';
import { es } from '../src/ui/i18n.locales/es';
import { fr_FR } from '../src/ui/i18n.locales/fr_FR';
import { id_ID } from '../src/ui/i18n.locales/id_ID';
import { it_IT } from '../src/ui/i18n.locales/it_IT';
import { ja_JP } from '../src/ui/i18n.locales/ja_JP';
import { ko_KR } from '../src/ui/i18n.locales/ko_KR';
import { nl_NL } from '../src/ui/i18n.locales/nl_NL';
import { pl_PL } from '../src/ui/i18n.locales/pl_PL';
import { pt_BR } from '../src/ui/i18n.locales/pt_BR';
import { ru_RU } from '../src/ui/i18n.locales/ru_RU';
import { sv_SE } from '../src/ui/i18n.locales/sv_SE';
import { tr_TR } from '../src/ui/i18n.locales/tr_TR';
import { vi_VN } from '../src/ui/i18n.locales/vi_VN';
import { zh_CN } from '../src/ui/i18n.locales/zh_CN';
import { zh_TW } from '../src/ui/i18n.locales/zh_TW';

const locales: Record<string, Partial<Record<TranslationKey, string>>> = {
  da_DK,
  es,
  fr_FR,
  id_ID,
  it_IT,
  ja_JP,
  ko_KR,
  nl_NL,
  pl_PL,
  pt_BR,
  ru_RU,
  sv_SE,
  tr_TR,
  vi_VN,
  zh_CN,
  zh_TW,
};

function translation(locale: string, key: TranslationKey): string {
  const value = locales[locale]?.[key];
  if (typeof value !== 'string') throw new Error(`${locale} is missing ${key}`);
  return value;
}

describe('reviewed localization semantics', () => {
  const marketTerms: Record<string, string> = {
    id_ID: 'dunia',
    tr_TR: 'dünya',
    vi_VN: 'thế giới',
  };

  for (const [locale, expectedTerm] of Object.entries(marketTerms)) {
    it(`${locale} does not leak raw English into the market tip`, () => {
      const value = translation(locale, 'loading.tips.market');
      expect(value).not.toMatch(/\brealm\b/i);
      expect(value.toLocaleLowerCase(locale.replace('_', '-'))).toContain(expectedTerm);
    });
  }

  const eastbrookNames: Record<string, string> = {
    da_DK: 'Østbæk',
    nl_NL: 'Oostbeek',
    sv_SE: 'Östbäck',
  };

  for (const [locale, expectedName] of Object.entries(eastbrookNames)) {
    it(`${locale} uses its established Eastbrook place name`, () => {
      const value = translation(locale, 'entities.quests.q_prof_intro.text');
      expect(value).toContain(expectedName);
      expect(value).not.toContain('Eastbrook');
    });
  }

  const professionEndings: Record<string, string> = {
    da_DK: 'Der er et hæderligt levebrød i det alt sammen, hvis du ønsker det.',
    es: 'En esos oficios te espera una vida honrada, si la quieres.',
    fr_FR: 'Tout cela peut vous offrir un gagne-pain honorable, si le cœur vous en dit.',
    id_ID: 'Semua itu bisa menjadi mata pencaharian yang layak, jika kamu menginginkannya.',
    it_IT: 'C’è un mestiere onesto in tutto questo, se ti interessa.',
    ko_KR: '원한다면 이 모든 일로 떳떳하게 생계를 꾸릴 수 있다네.',
    pt_BR: 'Dá para ganhar a vida honestamente com tudo isso, se você quiser.',
    sv_SE: 'Det går att försörja sig hederligt på alltihop, om du vill.',
    zh_CN: '只要你愿意，靠这些都能正经谋生。',
    zh_TW: '只要你願意，靠這些都能正經謀生。',
  };

  for (const [locale, expectedEnding] of Object.entries(professionEndings)) {
    it(`${locale} translates honest trade as an occupation`, () => {
      expect(
        translation(locale, 'entities.quests.q_prof_intro.completion').endsWith(expectedEnding),
      ).toBe(true);
    });
  }

  it('pl_PL labels a heroic item rather than heroic mode', () => {
    expect(translation('pl_PL', 'hudChrome.itemHeroicTag')).toBe('[HEROICZNY]');
  });
});
