import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PRIEST_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import {
  SHADOW_BOMB_RESIDUAL_DURATION,
  SHADOW_BOMB_RESIDUAL_FRACTION,
  SHADOW_BOMB_RESIDUAL_INTERVAL,
  SHADOW_CHOIR_DURATION,
  SHADOW_CHOIR_HEAL_FRACTION,
  SHADOW_LIVING_COVENANT_MAX_EXTENSION,
} from '../src/sim/content/priest_shadow_tuning';
import { ensureLocaleLoaded, type SupportedLanguage, setLanguage } from '../src/ui/i18n';
import { tTalent } from '../src/ui/talent_i18n';
import { RETAINED_ROW_DESCRIPTION_OVERRIDES } from '../src/ui/talent_i18n.row_description_overrides';

const IDS = {
  stilled: 'pri_r11_inner_focus',
  living: 'pri_r14_pain_and_suffering',
  twin: 'pri_r20_twin_covenant',
  second: 'pri_r20_second_verse',
  incarnate: 'pri_r20_incarnate_spirit',
  choir: 'pri_r17_choir_of_deliverance',
} as const;

function description(id: string): string {
  const choice = PRIEST_CHOICE_ROWS.rows.flatMap((row) => row.options).find((row) => row.id === id);
  if (!choice) throw new Error(`Missing Priest choice ${id}`);
  return tTalent({ kind: 'talentChoice', choice, field: 'description' });
}

// These literal words distinguish the new sustained DoT payoff from the former
// secondary Effigy echo, and the lingering bomb from the former pet multiplier.
const CASES = [
  ['es', 'Sombra:', 'Toque vampírico', 'Bomba del diezmo', 'quinto', 'reinicia', 'subgrupo'],
  ['es_ES', 'Sombra:', 'Toque vampírico', 'Bomba del diezmo', 'quinto', 'reinicia', 'subgrupo'],
  [
    'ru_RU',
    'Тьма:',
    /Прикосновени[ея] вампира/,
    /Бомб[аы] подношения/,
    'пятое',
    'сбрасывает',
    'подгруппа',
  ],
  ['zh_CN', '暗影：', '吸血之触', '献纳灵魂炸弹', '5 次正常', '重置', '自己的小队'],
  ['zh_TW', '暗影：', '吸血之觸', '獻納靈魂炸彈', '5 次正常', '重設', '自己的小隊'],
  ['ja_JP', '影：', '吸血の接触', '献納の爆弾', '通常5回', 'リセット', '自分の小隊'],
  ['ko_KR', '암흑:', '흡혈의 손길', '헌납 폭탄', '5회', '초기화', '자신의 파티'],
] as const;

describe('Shadow Priest localized talent behavior', () => {
  beforeAll(async () => {
    for (const [lang] of CASES) await ensureLocaleLoaded(lang);
  });
  afterEach(() => setLanguage('en'));

  it('explains independent Shadow critical reservation and active DoT refresh in English', () => {
    setLanguage('en');
    const stilled = description(IDS.stilled);
    expect(stilled).toContain('costs no Mana and cannot be interrupted');
    expect(stilled).toContain('next Mindfracture or Void Rupture within 60 sec, if it hits');
    expect(stilled).toContain('Other spells do not consume this bonus');
    expect(stilled).toContain('still consumes 3 Gloomtithe charges');
    expect(stilled).toContain('A resisted cast consumes the critical strike bonus');
    expect(stilled).toContain('90 sec cooldown');
    const second = description(IDS.second);
    expect(second).toContain(
      'Refreshing your Vampiric Touch before it expires preserves the count on that enemy',
    );
    expect(second).toContain('If it expires, the count resets');
    expect(second).not.toContain('Reapplying Vampiric Touch restarts');
  });

  it.each([
    ['es', 'conserva la cuenta', 'Si expira', 'crítico garantizado', 'Otros hechizos no consumen'],
    [
      'es_ES',
      'conserva la cuenta',
      'Si expira',
      'crítico garantizado',
      'Otros hechizos no consumen',
    ],
    [
      'ru_RU',
      'сохраняет счётчик',
      'Окончание действия',
      'критический удар',
      'Другие заклинания не расходуют',
    ],
    ['zh_CN', '保留该敌人上的计数', '效果到期', '必定暴击', '其他法术不会消耗'],
    ['zh_TW', '保留該敵人上的計數', '效果到期', '必定爆擊', '其他法術不會消耗'],
    [
      'ja_JP',
      'カウントを維持',
      '効果が切れると',
      '必ずクリティカル',
      '他の呪文はこの効果を消費しない',
    ],
    ['ko_KR', '횟수를 유지', '만료되면', '반드시 치명타', '다른 주문은 이 효과를 소모하지'],
  ] as const)(
    'distinguishes refresh from expiry and independent critical consumption in %s',
    (lang, carry, expiry, crit, independent) => {
      setLanguage(lang);
      expect(description(IDS.second)).toContain(carry);
      expect(description(IDS.second)).toContain(expiry);
      const stilled = description(IDS.stilled);
      expect(stilled).toContain(crit);
      expect(stilled).toContain(independent);
      expect(stilled).toContain('60');
      expect(stilled).toContain('3');
    },
  );

  it('retains complete special-case descriptions in every authored locale', () => {
    for (const [lang, descriptions] of Object.entries(RETAINED_ROW_DESCRIPTION_OVERRIDES)) {
      for (const id of Object.values(IDS)) {
        const localized = (descriptions as Readonly<Record<string, string>>)[id];
        expect(localized, `${lang}: ${id}`).toBeTruthy();
        expect(localized).not.toBe(
          PRIEST_CHOICE_ROWS.rows.flatMap((row) => row.options).find((choice) => choice.id === id)
            ?.description,
        );
      }
      const localized = descriptions as Readonly<Record<string, string>>;
      // No locale may continue promising a Shadow Tithefiend damage/duration buff.
      expect(localized[IDS.incarnate], lang).not.toMatch(/50\s*%|%\s*50/);
      expect(localized[IDS.incarnate], lang).toMatch(/20\s*%|%\s*20/);
      expect(localized[IDS.twin], lang).toMatch(/70\s*%|%\s*70/);
      expect(localized[IDS.second], lang).toMatch(/40\s*%|%\s*40/);
    }
  });

  it.each(CASES)(
    'renders the current Shadow branches through tTalent in %s',
    (lang, shadow, vt, bomb, fifth, reset, subgroup) => {
      setLanguage(lang as SupportedLanguage);
      const living = description(IDS.living);
      const livingShadow = living.slice(living.indexOf(shadow));
      expect(livingShadow).toMatch(vt);
      expect(livingShadow).toContain(String(SHADOW_LIVING_COVENANT_MAX_EXTENSION));
      expect(livingShadow).toContain('6');
      const second = description(IDS.second);
      const secondShadow = second.slice(second.indexOf(shadow));
      expect(secondShadow).toMatch(vt);
      expect(secondShadow).toContain(fifth);
      expect(secondShadow).toContain(reset);
      expect(secondShadow).not.toMatch(/40\s*%|%\s*40/);

      const incarnate = description(IDS.incarnate);
      const incarnateShadow = incarnate.slice(incarnate.indexOf(shadow));
      expect(incarnateShadow).toMatch(bomb);
      expect(incarnateShadow).toContain(String(SHADOW_BOMB_RESIDUAL_FRACTION * 100));
      expect(incarnateShadow).toContain(String(SHADOW_BOMB_RESIDUAL_DURATION));
      expect(incarnateShadow).toContain(String(SHADOW_BOMB_RESIDUAL_INTERVAL));
      expect(incarnateShadow).toContain('3');
      expect(incarnateShadow).toContain('5');
      expect(description(IDS.twin)).toMatch(bomb);

      const choir = description(IDS.choir);
      expect(choir).toContain(String(SHADOW_CHOIR_DURATION));
      expect(choir).toContain(String(SHADOW_CHOIR_HEAL_FRACTION * 100));
      expect(choir).toContain('30');
      expect(choir).toContain(subgroup);
      expect(choir).toContain('6');
      expect(choir).toContain('2');
      expect(choir).toContain('180');
    },
  );
});
