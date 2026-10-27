// The Guardian of the Heat's player text: every raid warning and every line
// the guardian speaks resolves through its catalog key to the very English
// the sim sends, the fight's auras' tooltips from the live tuning (and the
// heat's pulse range proven against the sim's own hits), every bar and
// damage name re-localized, the heat on the debuff bar, and the heat gauge
// over the action bar.

import { describe, expect, it } from 'vitest';
import { isDebuffDisplayAura } from '../src/sim/aura_classify';
import {
  burnAmp,
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_DIFFICULTY,
  HEAT_NAMES,
  HEAT_TUNING as T,
} from '../src/sim/encounters/smith_heart/heat_ids';
import { HEAT_LINES, heatLineKey } from '../src/sim/encounters/smith_heart/heat_voice';
import { DT, type SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { buildHeatAlertView, HEAT_BURNING_AT } from '../src/ui/hud/dungeon/heat_alert_view';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { hitsOf } from './helpers/council_fight';
import { heatFight } from './helpers/heat_fight';

type Chat = Extract<SimEvent, { type: 'chat' }>;

describe('Guardian of the Heat: what the raid reads', () => {
  it('every warning and every line resolves its key to the English the sim sent', () => {
    const f = heatFight(5);
    const events: SimEvent[] = [];
    f.dev('/dev heart heat pull');
    events.push(...f.tick(20 * 2));
    f.dev('/dev heart heat shed');
    events.push(...f.tick(20 * 4));
    f.dev('/dev heart heat channel');
    events.push(...f.tick(20 * 6));
    f.dev('/dev heart heat heat 91');
    events.push(...f.tick(20 * 12));
    const mine = events.filter((e): e is Chat => e.type === 'chat' && e.pid === f.pids[0]);
    const warns = mine.filter((c) => c.channel === 'raidWarning');
    const keys = new Set(warns.map((w) => w.textKey));
    for (const k of ['crystals', 'channel', 'windup', 'overheat'])
      expect(keys, k).toContain(`hudChrome.heatGuardian.warn.${k}`);
    for (const w of warns) {
      expect(w.textKey?.startsWith('hudChrome.heatGuardian.warn.')).toBe(true);
      expect(t(w.textKey as never, w.textValues)).toBe(w.text);
    }
    const yells = mine.filter((c) => c.channel === 'yell');
    expect(yells.length).toBeGreaterThanOrEqual(4);
    for (const y of yells) expect(t(y.textKey as never)).toBe(y.text);
  });

  it("every line in HEAT_LINES is its catalog row's English", () => {
    for (const [moment, text] of Object.entries(HEAT_LINES))
      expect(t(heatLineKey(moment as never) as never)).toBe(text);
  });
});

describe('Guardian of the Heat: tooltips and names', () => {
  const say = (d: ReturnType<typeof auraEffectDescriptor>) => {
    const text = t(d?.key as never, d?.nums as never);
    expect(text).not.toMatch(/\{\w+\}/);
    return text;
  };

  it('each aura says its rule with the live numbers', () => {
    const heat = say(auraEffectDescriptor({ id: HEAT_AURAS.heat, kind: 'internal_cd', value: 60 }));
    expect(heat).toContain(`60 of ${T.heatMax}`);
    expect(heat).toContain(`by ${T.heatRise} every second`);
    expect(heat).toContain(`lowers it by ${T.rayCool}`);
    expect(heat).toContain(`within ${T.rayRange} yd`);
    const burn = say(
      auraEffectDescriptor({
        id: HEAT_AURAS.burn,
        kind: 'spellvuln',
        value: burnAmp(4),
        stacks: 4,
      }),
    );
    expect(burn).toContain(`${Math.round(burnAmp(4) * 100)}% more Fire`);
    expect(burn).toContain(`${Math.round(T.burnPct * 100)}% for each of your 4 stacks`);
    expect(burn).toContain(`at most ${T.burnMax}`);
    expect(burn).toContain(`${HEAT_DIFFICULTY.normal.burnDecay} sec after`);
    expect(burn).toContain(`${HEAT_DIFFICULTY.heroic.burnDecay} sec on Heroic`);
    const stoked = say(
      auraEffectDescriptor({ id: HEAT_AURAS.stoked, kind: 'internal_cd', value: 0, stacks: 2 }),
    );
    expect(stoked).toContain(`${Math.round(T.stokeStep * 200)}% faster`);
    const over = say(
      auraEffectDescriptor({ id: HEAT_AURAS.overheating, kind: 'internal_cd', value: 0 }),
    );
    expect(over).toContain(
      `${HEAT_DIFFICULTY.normal.overheatMin} to ${HEAT_DIFFICULTY.normal.overheatMax}`,
    );
    expect(over).toContain(
      `${HEAT_DIFFICULTY.heroic.overheatMin} to ${HEAT_DIFFICULTY.heroic.overheatMax} on Heroic`,
    );
  });

  it("the heat's tooltip states the very pulse the sim deals at that heat", () => {
    const d = auraEffectDescriptor({ id: HEAT_AURAS.heat, kind: 'internal_cd', value: 60 });
    const nums = d?.nums as { min: number; most: number };
    const f = heatFight(3);
    f.dev('/dev heart heat pull');
    f.tick(2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.shedTimer = 999;
    st.channel.remaining = 999;
    st.stokeTimer = 999;
    const target = f.players[2];
    const hits: number[] = [];
    for (let i = 0; i < 6; i++) {
      st.heat = 60;
      hits.push(...hitsOf(f.tick(Math.round(T.pulseEvery / DT)), HEAT_NAMES.pulse, target.id));
    }
    expect(hits.length).toBeGreaterThan(3);
    for (const h of hits) {
      expect(h).toBeGreaterThanOrEqual(nums.min - 1);
      expect(h).toBeLessThanOrEqual(nums.most + 1);
    }
  });

  it("Crystal Burn's tooltip is the debuff the sim applies", () => {
    const f = heatFight(3);
    f.dev('/dev heart heat pull');
    f.tick(2);
    const p = f.players[2];
    f.dev('/dev heart heat burn 3', p.id);
    const a = p.auras.find((x) => x.id === HEAT_AURAS.burn);
    if (!a) throw new Error('no burn');
    const text = say(auraEffectDescriptor(a));
    expect(text).toContain(`${Math.round(a.value * 100)}% more Fire`);
  });

  it('the heat sits on the debuff bar', () => {
    expect(isDebuffDisplayAura('internal_cd', 0, HEAT_AURAS.heat)).toBe(true);
    expect(isDebuffDisplayAura('spellvuln', burnAmp(1), HEAT_AURAS.burn)).toBe(true);
  });

  it('every bar, damage and aura name has its localized form', () => {
    expect(t(`abilityUi.cast.${HEAT_CASTS.shed}` as never)).toBe('Shed Heat');
    // Shed Heat is a bar (its abilityUi.cast row), never a damage or aura name.
    for (const [k, name] of Object.entries(HEAT_NAMES)) {
      if (k === 'shed') continue;
      expect(localizeSimAuraName(name), name).toBe(name);
    }
  });
});

describe('Guardian of the Heat: the heat gauge over the action bar', () => {
  it('shows the heat, cools blue, urges a heavy burn to hand the ray on, and flashes the wind-up', () => {
    expect(buildHeatAlertView({ auras: [] }).visible).toBe(false);
    const rising = buildHeatAlertView({ auras: [{ id: HEAT_AURAS.heat, value: 40, value2: 1 }] });
    if (!rising.visible) throw new Error('hidden');
    expect(rising.kind).toBe('heat');
    expect(rising.progress).toBeCloseTo(0.4);
    expect(rising.barLabel).toBe(`Heat 40 / ${T.heatMax}`);
    expect(rising.line).toContain(`${T.rayRange} yd of a Kindled Crystal`);
    const cooling = buildHeatAlertView({
      auras: [{ id: HEAT_AURAS.heat, value: 40, value2: -1 }],
    });
    expect(cooling.visible && cooling.kind).toBe('cooling');
    const burning = buildHeatAlertView({
      auras: [
        { id: HEAT_AURAS.heat, value: 40, value2: -1 },
        { id: HEAT_AURAS.burn, stacks: HEAT_BURNING_AT },
      ],
    });
    if (!burning.visible) throw new Error('hidden');
    expect(burning.kind).toBe('burning');
    expect(burning.line).toContain(`${Math.round(burnAmp(HEAT_BURNING_AT) * 100)}% more`);
    // A light burn stays the heat's gauge.
    const light = buildHeatAlertView({
      auras: [
        { id: HEAT_AURAS.heat, value: 40, value2: 1 },
        { id: HEAT_AURAS.burn, stacks: HEAT_BURNING_AT - 1 },
      ],
    });
    expect(light.visible && light.kind).toBe('heat');
    // The wind-up outranks the burn.
    const over = buildHeatAlertView({
      auras: [
        { id: HEAT_AURAS.heat, value: T.windupAt, value2: 1 },
        { id: HEAT_AURAS.burn, stacks: 9 },
      ],
    });
    expect(over.visible && over.kind).toBe('overheat');
    expect(
      buildHeatAlertView({ auras: [{ id: HEAT_AURAS.heat, value: 9 }], dead: true }).visible,
    ).toBe(false);
  });
});
