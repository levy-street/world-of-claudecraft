import { describe, expect, it } from 'vitest';
import type { TranslationKey } from '../src/ui/i18n.catalog';
import { guideStrings } from '../src/ui/i18n.catalog/guide';
import { cs_CZ } from '../src/ui/i18n.locales/cs_CZ';
import { da_DK } from '../src/ui/i18n.locales/da_DK';
import { de_DE } from '../src/ui/i18n.locales/de_DE';
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
  cs_CZ,
  da_DK,
  de_DE,
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
  it('English Frost guide hooks describe the retained mechanics', () => {
    expect(guideStrings.abilityHook.brain_freeze).toContain('skip its cooldown');
    expect(guideStrings.abilityHook.brain_freeze).not.toContain('harder-hitting');
    expect(guideStrings.abilityHook.frozen_orb).toContain('Icicles');
    expect(guideStrings.abilityHook.frozen_orb).not.toContain('frost procs');
  });

  const frostTerms: Record<string, { cooldown: string; icicle: string }> = {
    ja_JP: { cooldown: 'クールダウン', icicle: '氷柱' },
    ko_KR: { cooldown: '재사용 대기시간', icicle: '고드름' },
    ru_RU: { cooldown: 'восстановления', icicle: 'Сосуль' },
    zh_CN: { cooldown: '冷却时间', icicle: '冰刺' },
    zh_TW: { cooldown: '冷卻時間', icicle: '冰柱' },
  };

  for (const [locale, terms] of Object.entries(frostTerms)) {
    it(`${locale} keeps Frost tooltips aligned with the reduced proc mechanics`, () => {
      const flurry = translation(locale, 'entities.abilities.flurry.description');
      const brainFreeze = translation(locale, 'entities.abilities.brain_freeze.description');
      const shatter = translation(locale, 'entities.abilities.shatter.description');
      const frozenOrb = translation(locale, 'entities.abilities.frozen_orb.description');
      const brainFreezeGuide = translation(locale, 'guide.abilityHook.brain_freeze');
      const frozenOrbGuide = translation(locale, 'guide.abilityHook.frozen_orb');

      expect(flurry).not.toContain('30%');
      expect(brainFreeze).not.toContain('30%');
      expect(shatter).not.toContain('20%');
      expect(frozenOrb).toContain(terms.icicle);
      expect(brainFreezeGuide).toContain(terms.cooldown);
      expect(frozenOrbGuide).toContain(terms.icicle);
    });
  }

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

  // Pinned on a stable ITEM name rather than quest prose: the q_prof_intro
  // rewrite (PR 2039) retired the old quest text these pins used to read, and
  // quest prose churns with content work while the item name does not.
  const eastbrookNames: Record<string, string> = {
    da_DK: 'Østbæk',
    nl_NL: 'Oostbeek',
    sv_SE: 'Östbäck',
  };

  for (const [locale, expectedName] of Object.entries(eastbrookNames)) {
    it(`${locale} uses its established Eastbrook place name`, () => {
      const value = translation(locale, 'entities.items.eastbrook_arming_sword.name');
      expect(value).toContain(expectedName);
      expect(value).not.toContain('Eastbrook');
    });
  }

  // The q_prof_intro rewrite (PR 2039) removed the stale Latin-script fills
  // for the reworded completion (they sit pending until the release-time
  // locale fill), so only the non-Latin locales, freshly filled in the same
  // change, carry a reviewed translation to pin today. Re-add the Latin rows
  // here when the i18n-locale-fill pass translates the new text.
  const professionEndings: Record<string, string> = {
    ja_JP: '望むなら、どの仕事にもまっとうな稼ぎが待っている。',
    ko_KR: '원한다면 이 모든 일에서 정당한 생계를 찾을 수 있다네.',
    ru_RU: 'эти занятия обеспечат честный заработок.',
    zh_CN: '只要你愿意，这些手艺都能换来公道的生计。',
    zh_TW: '只要你願意，這些手藝都能換來公道的生計。',
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

  const warriorTooltipTerms: Record<string, { group: string; damage: string }> = {
    cs_CZ: { group: 'všech členů družiny', damage: 'poškození' },
    da_DK: { group: 'alle gruppemedlemmer', damage: 'skaden' },
    de_DE: { group: 'aller gruppenmitglieder', damage: 'schaden' },
    es: { group: 'todos los miembros del grupo', damage: 'daño' },
    fr_FR: { group: 'tous les membres du groupe', damage: 'dégâts' },
    id_ID: { group: 'semua anggota kelompok', damage: 'kerusakan' },
    it_IT: { group: 'tutti i membri del gruppo', damage: 'danni' },
    ja_JP: { group: 'パーティメンバー全員', damage: 'ダメージ' },
    ko_KR: { group: '모든 파티원', damage: '피해' },
    nl_NL: { group: 'alle groepsleden', damage: 'schade' },
    pl_PL: { group: 'wszystkich członków drużyny', damage: 'obrażenia' },
    pt_BR: { group: 'todos os membros do grupo', damage: 'dano' },
    ru_RU: { group: 'всех членов группы', damage: 'урон' },
    sv_SE: { group: 'alla gruppmedlemmar', damage: 'skadan' },
    tr_TR: { group: 'tüm grup üyelerinin', damage: 'hasarı' },
    vi_VN: { group: 'tất cả thành viên tổ đội', damage: 'sát thương' },
    zh_CN: { group: '所有队伍成员', damage: '伤害' },
    zh_TW: { group: '所有隊伍成員', damage: '傷害' },
  };

  for (const [locale, terms] of Object.entries(warriorTooltipTerms)) {
    it(`${locale} keeps the changed Warrior tooltips aligned with current mechanics`, () => {
      const ironBellow = translation(
        locale,
        'entities.abilities.battle_shout.description',
      ).toLocaleLowerCase(locale.replace('_', '-'));
      expect(ironBellow).toContain(terms.group);
      expect(ironBellow).toContain('{buff}');
      expect(ironBellow).toContain('%');
      expect(ironBellow).toContain('30');
      expect(ironBellow).not.toMatch(/(^|\D)2(\D|$)/);

      const direhowl = translation(
        locale,
        'entities.abilities.demoralizing_shout.description',
      ).toLocaleLowerCase(locale.replace('_', '-'));
      expect(direhowl).toContain(terms.damage);
      expect(direhowl).toContain('{buff}');
      expect(direhowl).toContain('%');
      expect(direhowl).toContain('20');
      expect(direhowl).not.toContain('30');

      const bladestorm = translation(locale, 'entities.abilities.bladestorm.description');
      expect(bladestorm).toMatch(/(^|\D)6(\D|$)/);
      expect(bladestorm).not.toMatch(/(^|\D)8(\D|$)/);
    });
  }
});
