// The Guardian of the Quench's player text: every raid warning and every line
// the guardian speaks resolves through its catalog key to the very English
// the sim sends, the fight's auras' tooltips from the live tuning (the cold's
// value off the aura itself), every bar and damage name re-localized, and the
// cold bar on the debuff bar.

import { describe, expect, it } from 'vitest';
import { isDebuffDisplayAura } from '../src/sim/aura_classify';
import {
  QUENCH_AURAS,
  QUENCH_CASTS,
  QUENCH_DIFFICULTY,
  QUENCH_NAMES,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart/quench_ids';
import { QUENCH_LINES, quenchLineKey } from '../src/sim/encounters/smith_heart/quench_voice';
import type { SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { buildQuenchAlertView, QUENCH_FREEZING_AT } from '../src/ui/hud/dungeon/quench_alert_view';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { quenchFight } from './helpers/quench_fight';

type Chat = Extract<SimEvent, { type: 'chat' }>;

describe('Guardian of the Quench: what the raid reads', () => {
  it('every warning and every line resolves its key to the English the sim sent', () => {
    const f = quenchFight(6);
    const events: SimEvent[] = [];
    f.dev('/dev heart quench pull');
    events.push(...f.tick(20 * 4));
    // A huddle that cracks the ice, a freeze, the blades, a crossing.
    f.put(f.players[2], 184, 14);
    f.put(f.players[3], 186, 14);
    f.put(f.players[4], 185, 16);
    events.push(...f.tick(20 * 12));
    f.dev('/dev heart quench burst', f.players[5].id);
    events.push(...f.tick(20 * 5));
    f.dev('/dev heart quench heroic');
    f.dev('/dev heart quench phase2');
    events.push(...f.tick(20 * 6));
    f.dev('/dev heart quench breath');
    events.push(...f.tick(20 * 6));
    f.dev('/dev heart quench dance');
    events.push(...f.tick(20 * 6));
    const mine = events.filter((e): e is Chat => e.type === 'chat' && e.pid === f.pids[0]);
    const warns = mine.filter((c) => c.channel === 'raidWarning');
    const keys = new Set(warns.map((w) => w.textKey));
    for (const k of ['rim', 'crack', 'frozen', 'wake', 'cross'])
      expect(keys, k).toContain(`hudChrome.quenchGuardian.warn.${k}`);
    for (const w of warns) {
      expect(w.textKey?.startsWith('hudChrome.quenchGuardian.warn.')).toBe(true);
      expect(t(w.textKey as never, w.textValues)).toBe(w.text);
    }
    const yells = mine.filter((c) => c.channel === 'yell');
    expect(yells.length).toBeGreaterThan(4);
    for (const y of yells) expect(t(y.textKey as never)).toBe(y.text);
  });

  it("every line in QUENCH_LINES is its catalog row's English", () => {
    for (const [moment, text] of Object.entries(QUENCH_LINES))
      expect(t(quenchLineKey(moment as never) as never)).toBe(text);
  });
});

describe('Guardian of the Quench: tooltips and names', () => {
  const say = (d: ReturnType<typeof auraEffectDescriptor>) => {
    const text = t(d?.key as never, d?.nums as never);
    expect(text).not.toMatch(/\{\w+\}/);
    return text;
  };

  it('each aura says its rule with the live numbers', () => {
    const cold = auraEffectDescriptor({ id: QUENCH_AURAS.cold, kind: 'internal_cd', value: 63 });
    expect(cold?.key).toBe('hudChrome.auraEffect.quenchGuardian.cold');
    const c = say(cold);
    expect(c).toContain(`63 of ${T.coldMax}`);
    expect(c).toContain(`about ${Math.round(T.coldMax / T.coldRise)} sec`);
    expect(c).toContain(`within ${T.warmR} yd of ${T.warmNeed} or more`);
    expect(c).toContain(`by ${T.coldFall} every second`);
    const frozen = say(auraEffectDescriptor({ id: QUENCH_AURAS.frozen, kind: 'stun', value: 0 }));
    expect(frozen).toContain(`${T.shatterMin} to ${T.shatterMax}`);
    expect(frozen).toContain(`within ${QUENCH_DIFFICULTY.normal.splashR} yd`);
    expect(frozen).toContain(`${QUENCH_DIFFICULTY.heroic.splashR} yd`);
    const brittle = say(
      auraEffectDescriptor({
        id: QUENCH_AURAS.brittle,
        kind: 'vulnerability',
        value: T.brittlePct,
      }),
    );
    expect(brittle).toContain(`${Math.round(T.brittlePct * 100)}% more damage`);
    const trapped = say(auraEffectDescriptor({ id: QUENCH_AURAS.trapped, kind: 'root', value: 0 }));
    expect(trapped).toContain(`${T.trapMin} to ${T.trapMax}`);
    expect(trapped).toContain('never kills');
    const awake = say(
      auraEffectDescriptor({ id: QUENCH_AURAS.awake, kind: 'internal_cd', value: 0 }),
    );
    expect(awake).toContain(`${T.echoDelay} sec after`);
    expect(awake).toContain('always safe');
    const deep = say(
      auraEffectDescriptor({
        id: QUENCH_AURAS.deepening,
        kind: 'internal_cd',
        value: 0,
        stacks: 3,
      }),
    );
    expect(deep).toContain(`${Math.round(T.deepenStep * 300)}% faster`);
    say(auraEffectDescriptor({ id: QUENCH_AURAS.warmth, kind: 'internal_cd', value: 0 }));
  });

  it('the cold bar sits on the debuff bar, the warmth among the buffs', () => {
    expect(isDebuffDisplayAura('internal_cd', 0, QUENCH_AURAS.cold)).toBe(true);
    expect(isDebuffDisplayAura('internal_cd', 0, QUENCH_AURAS.warmth)).toBe(false);
  });

  it('every bar, damage and aura name has its localized form', () => {
    for (const id of Object.values(QUENCH_CASTS))
      expect(t(`abilityUi.cast.${id}` as never), id).not.toContain('abilityUi');
    // The names the combat log and the aura strips print (the objects' names
    // and the awakening's bar are no aura's).
    const skip = new Set(['wake', 'crack', 'hole', 'blade', 'rim']);
    for (const [k, name] of Object.entries(QUENCH_NAMES)) {
      if (skip.has(k)) continue;
      expect(localizeSimAuraName(name), name).toBe(name);
    }
  });
});

describe('Guardian of the Quench: the cold bar over the action bar', () => {
  it('shows the bar, warns past three quarters, glows warm in a huddle, and counts the freeze and the water', () => {
    expect(buildQuenchAlertView({ auras: [] }).visible).toBe(false);
    const rising = buildQuenchAlertView({
      auras: [{ id: QUENCH_AURAS.cold, value: 40, value2: 1 }],
    });
    if (!rising.visible) throw new Error('hidden');
    expect(rising.kind).toBe('cold');
    expect(rising.progress).toBeCloseTo(0.4);
    expect(rising.barLabel).toBe(`Cold 40 / ${T.coldMax}`);
    expect(rising.line).toContain(`${T.warmR} yd of ${T.warmNeed} or more`);
    const freezing = buildQuenchAlertView({
      auras: [{ id: QUENCH_AURAS.cold, value: QUENCH_FREEZING_AT, value2: 1 }],
    });
    expect(freezing.visible && freezing.kind).toBe('freezing');
    const warm = buildQuenchAlertView({
      auras: [{ id: QUENCH_AURAS.cold, value: 90, value2: -1 }],
    });
    expect(warm.visible && warm.kind).toBe('warm');
    const frozen = buildQuenchAlertView({
      auras: [
        { id: QUENCH_AURAS.cold, value: 0, value2: 0 },
        { id: QUENCH_AURAS.frozen, remaining: 2.2, duration: T.freezeSeconds },
      ],
    });
    if (!frozen.visible) throw new Error('hidden');
    expect(frozen.kind).toBe('frozen');
    expect(frozen.line).toContain('3 sec');
    expect(frozen.progress).toBeCloseTo(2.2 / T.freezeSeconds);
    const water = buildQuenchAlertView({
      auras: [
        { id: QUENCH_AURAS.cold, value: 50, value2: 1 },
        { id: QUENCH_AURAS.trapped, remaining: 3, duration: T.trapSeconds + 1 },
      ],
    });
    if (!water.visible) throw new Error('hidden');
    expect(water.kind).toBe('water');
    expect(water.line).toContain('2 sec');
    expect(
      buildQuenchAlertView({ auras: [{ id: QUENCH_AURAS.cold, value: 9 }], dead: true }).visible,
    ).toBe(false);
  });
});
