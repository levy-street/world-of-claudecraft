// The Smith's Heart aura tooltips name every tier's RESOLVED damage
// (docs/design/tooltip-writing.md), not "Heroic: N% more":
//   - tierValue rounds the way the encounters roll (Math.max(1, round(v * m)));
//   - each fight's tooltip shows Heroic's range at the tier's own damage
//     factor, the Quench's shatter at damage x shatter factor, the final boss's
//     Heroic and Mythic separately (their factors differ), the Council's
//     Mythic-only collapse at Mythic's;
//   - "Heroic and Mythic" stays true only while both rows share the factor;
//   - every reworded key keeps its five non-Latin fills (M16) with the new
//     placeholders.

import { describe, expect, it } from 'vitest';
import {
  BREATH_AURAS,
  BREATH_DIFFICULTY,
  BREATH_TUNING as BT,
} from '../src/sim/encounters/smith_heart/breath_ids';
import {
  COUNCIL_AURAS,
  COUNCIL_DIFFICULTY,
  COUNCIL_TUNING as CT,
} from '../src/sim/encounters/smith_heart/council_ids';
import {
  FINAL_AURAS,
  FINAL_DIFFICULTY,
  FINAL_TUNING as FT,
} from '../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS,
  FINAL_PHASE_DIFFICULTY,
  FINAL_PHASES as FP,
  MOUNTING_WEIGHT_AURA,
} from '../src/sim/encounters/smith_heart/final_phase_ids';
import { HEAT_AURAS, HEAT_DIFFICULTY } from '../src/sim/encounters/smith_heart/heat_ids';
import {
  QUENCH_TUNING as QT,
  QUENCH_AURAS,
  QUENCH_DIFFICULTY,
} from '../src/sim/encounters/smith_heart/quench_ids';
import type { Aura } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { tierRange, tierValue } from '../src/ui/heart_tier_damage';
import { setLanguage, t } from '../src/ui/i18n';
import { ja_JP } from '../src/ui/i18n.locales/ja_JP';
import { ko_KR } from '../src/ui/i18n.locales/ko_KR';
import { ru_RU } from '../src/ui/i18n.locales/ru_RU';
import { zh_CN } from '../src/ui/i18n.locales/zh_CN';
import { zh_TW } from '../src/ui/i18n.locales/zh_TW';

setLanguage('en');

const say = (a: Partial<Aura> & { id: string; kind: Aura['kind'] }) => {
  const d = auraEffectDescriptor({ value: 0, ...a });
  expect(d, a.id).not.toBeNull();
  const text = t(d?.key as never, d?.nums as never);
  expect(text, a.id).not.toMatch(/\{\w+\}/);
  return text;
};

describe("Smith's Heart tooltips: resolved damage per difficulty", () => {
  it('rounds a tier value the way the fights roll it', () => {
    expect(tierValue(120, 1.25)).toBe(150);
    expect(tierValue(150, 1.1)).toBe(165);
    expect(tierValue(0.2, 1.25)).toBe(1);
    expect(tierRange('heroic', 360, 400, 2.5)).toEqual({ heroicMin: 900, heroicMax: 1000 });
  });

  it('"Heroic and Mythic" names one range only while both rows share the factor', () => {
    expect(COUNCIL_DIFFICULTY.mythic.damageMult).toBe(COUNCIL_DIFFICULTY.heroic.damageMult);
    expect(BREATH_DIFFICULTY.mythic.damageMult).toBe(BREATH_DIFFICULTY.heroic.damageMult);
    expect(QUENCH_DIFFICULTY.mythic.damageMult).toBe(QUENCH_DIFFICULTY.heroic.damageMult);
    expect(HEAT_DIFFICULTY.mythic.damageMult).toBe(HEAT_DIFFICULTY.heroic.damageMult);
    // The final boss's differ, so its tooltips name each tier on its own.
    expect(FINAL_DIFFICULTY.mythic.damageMult).not.toBe(FINAL_DIFFICULTY.heroic.damageMult);
  });

  it("the Council's marks say Heroic's resolved range, not a percent", () => {
    const wake = say({ id: COUNCIL_AURAS.wakeMark, kind: 'internal_cd' });
    expect(wake).toContain(`${CT.riseMin} to ${CT.riseMax} damage`);
    // 120 to 150 at x1.25.
    expect(wake).toContain('Heroic and Mythic: 150 to 188 damage.');
    expect(wake).not.toMatch(/% more damage/);
    const rock = say({ id: COUNCIL_AURAS.rockMark, kind: 'internal_cd' });
    expect(rock).toContain(
      `Heroic and Mythic: ${tierValue(CT.rockTotal, 1.25)} damage shared, and ` +
        `${tierValue(CT.rockTremorMin, 1.25)} to ${tierValue(CT.rockTremorMax, 1.25)} to the raid.`,
    );
    const rush = say({ id: COUNCIL_AURAS.rushMark, kind: 'internal_cd' });
    expect(rush).toContain(
      `Heroic and Mythic: ${tierValue(CT.rushMin, 1.25)} to ${tierValue(CT.rushMax, 1.25)} damage.`,
    );
    // The collapse is Mythic-only: its one range is Mythic's.
    const collapse = say({ id: COUNCIL_AURAS.collapse, kind: 'internal_cd' });
    const m = COUNCIL_DIFFICULTY.mythic.damageMult;
    expect(collapse).toContain(
      `${tierValue(CT.collapseMin, m)} to ${tierValue(CT.collapseMax, m)} damage for each stack`,
    );
    // The Wrath: Heroic's x1.25 damage times its x2.8 Wrath factor kills an
    // unhidden cloth; Mythic keeps the plain x1.25.
    const limit = say({
      id: COUNCIL_AURAS.pillarLimit,
      kind: 'vulnerability',
      value2: COUNCIL_DIFFICULTY.heroic.pillarLimit ?? 0,
    });
    expect(limit).toContain(
      `${CT.wrathMin} to ${CT.wrathMax} damage on Normal, 1540 to 1820 on Heroic and ` +
        `${tierValue(CT.wrathMin, m)} to ${tierValue(CT.wrathMax, m)} on Mythic.`,
    );
  });

  it("the Breath's cradle resolves its Heroic discharge and backlash", () => {
    const cradled = say({ id: BREATH_AURAS.cradled, kind: 'stun' });
    const h = BREATH_DIFFICULTY.heroic;
    expect(cradled).toContain(`each discharge ${tierValue(h.cradleTotal, h.damageMult)} wanting`);
    expect(cradled).toContain(
      `the backlash deals ${tierValue(BT.backlashMin, h.damageMult)} to ` +
        `${tierValue(BT.backlashMax, h.damageMult)} damage.`,
    );
  });

  it("the Quench's shatter is damage times the tier's own shatter factor", () => {
    const frozen = say({ id: QUENCH_AURAS.frozen, kind: 'stun' });
    const h = QUENCH_DIFFICULTY.heroic.damageMult * QUENCH_DIFFICULTY.heroic.shatterMult;
    const my = QUENCH_DIFFICULTY.mythic.damageMult * QUENCH_DIFFICULTY.mythic.shatterMult;
    expect(h).toBe(2.5);
    expect(frozen).toContain(
      `Heroic: ${tierValue(QT.shatterMin, h)} to ${tierValue(QT.shatterMax, h)} damage. ` +
        `Mythic: ${tierValue(QT.shatterMin, my)} to ${tierValue(QT.shatterMax, my)} damage.`,
    );
  });

  it("the Heat's trail and the final boss name each tier's range", () => {
    const trail = say({ id: HEAT_AURAS.trail, kind: 'internal_cd' });
    expect(trail).toMatch(/Heroic and Mythic: \d+ to \d+ damage\.$/);
    const ember = say({ id: FINAL_AURAS.ember, kind: 'internal_cd' });
    const hm = FINAL_DIFFICULTY.heroic.damageMult;
    const mm = FINAL_DIFFICULTY.mythic.damageMult;
    expect(ember).toContain(
      `Heroic: ${tierValue(FT.emberMin, hm)} to ${tierValue(FT.emberMax, hm)} damage. ` +
        `Mythic: ${tierValue(FT.emberMin, mm)} to ${tierValue(FT.emberMax, mm)} damage.`,
    );
    const coal = say({ id: FINAL_PHASE_AURAS.coal, kind: 'internal_cd' });
    expect(coal).toContain(
      `Heroic: ${tierValue(FP.coalMin, hm)} to ${tierValue(FP.coalMax, hm)} and ` +
        `${tierValue(FP.coalSelfMin, hm)} to ${tierValue(FP.coalSelfMax, hm)} damage respectively.`,
    );
    const weight = say({ id: MOUNTING_WEIGHT_AURA, kind: 'internal_cd', stacks: 2 });
    expect(weight).toContain(
      `${Math.round(FINAL_PHASE_DIFFICULTY.heroic.weightStep * 100)}% harder on Heroic and ` +
        `${Math.round(FINAL_PHASE_DIFFICULTY.mythic.weightStep * 100)}% on Mythic.`,
    );
  });

  it('every reworded key keeps its five non-Latin fills with the new placeholders', () => {
    const keys: Record<string, string[]> = {
      'hudChrome.auraEffect.council.wakeMark': ['{heroicMin}', '{heroicMax}'],
      'hudChrome.auraEffect.council.rockMark': ['{heroicTotal}', '{heroicTremorMax}'],
      'hudChrome.auraEffect.council.pillarLimit': ['{heroicMin}', '{mythicMax}'],
      'hudChrome.auraEffect.breathGuardian.cradled': ['{heroicBMin}', '{heroicBMax}'],
      'hudChrome.auraEffect.quenchGuardian.frozen': ['{heroicMin}', '{mythicMax}'],
      'hudChrome.auraEffect.finalBoss.overloadHeat': ['{heroicPulseMin}', '{mythicPulseMax}'],
      'hudChrome.auraEffect.finalBoss.coal': ['{heroicSelfMin}', '{mythicSelfMax}'],
      'hudChrome.auraEffect.finalBoss.weight': ['{heroicStep}', '{mythicStep}'],
    };
    const locales = { zh_CN, zh_TW, ja_JP, ko_KR, ru_RU } as Record<
      string,
      Record<string, string | undefined>
    >;
    for (const [lang, table] of Object.entries(locales)) {
      for (const [key, tokens] of Object.entries(keys)) {
        const v = table[key];
        expect(v, `${lang} ${key}`).toBeTruthy();
        for (const token of tokens) expect(v, `${lang} ${key}`).toContain(token);
        expect(v, `${lang} ${key}`).not.toContain('{heroic}');
      }
    }
  });
});
