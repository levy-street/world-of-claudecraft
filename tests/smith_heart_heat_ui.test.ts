// The Guardian of the Heat's player text: every raid warning and every line
// the guardian speaks resolves through its catalog key to the very English
// the sim sends, the fight's auras' tooltips from the live tuning (Cinder
// Grip's proven against the debuff the sim lays), the marks on the debuff
// bar, and every bar and damage name re-localized.

import { describe, expect, it } from 'vitest';
import { isDebuffDisplayAura } from '../src/sim/aura_classify';
import {
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_DIFFICULTY,
  HEAT_NAMES,
  HEAT_STAGES,
  HEAT_TUNING as T,
} from '../src/sim/encounters/smith_heart/heat_ids';
import { HEAT_LINES, heatLineKey } from '../src/sim/encounters/smith_heart/heat_voice';
import type { SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { heatFight } from './helpers/heat_fight';

type Chat = Extract<SimEvent, { type: 'chat' }>;

describe('Guardian of the Heat: what the raid reads', () => {
  it('every warning and every line resolves its key to the English the sim sent', () => {
    const f = heatFight(5);
    const events: SimEvent[] = [];
    f.dev('/dev heart heat heroic');
    f.dev('/dev heart heat pull');
    events.push(...f.tick(20 * 2));
    // Heroic's first overflow (the Wellspawn), then its second (the
    // Wellkeepers), then phase 2's and 3's warnings.
    f.dev('/dev heart heat intermission');
    events.push(...f.tick(20 * 4));
    f.dev('/dev heart heat phase 2');
    f.dev('/dev heart heat intermission');
    events.push(...f.tick(20 * 4));
    f.dev('/dev heart heat phase 2');
    f.dev('/dev heart heat seeds');
    f.dev('/dev heart heat zones');
    events.push(...f.tick(20 * 2));
    f.dev('/dev heart heat phase 3');
    f.dev('/dev heart heat cinder');
    events.push(...f.tick(20 * 3));
    const mine = events.filter((e): e is Chat => e.type === 'chat' && e.pid === f.pids[0]);
    const warns = mine.filter((c) => c.channel === 'raidWarning');
    const keys = new Set(warns.map((w) => w.textKey));
    for (const k of ['overflow', 'wellspawn', 'keepers', 'seeds', 'zones', 'cinder'])
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
    expect(d).not.toBeNull();
    const text = t(d?.key as never, d?.nums as never);
    expect(text).not.toMatch(/\{\w+\}/);
    return text;
  };
  const heroicPct = Math.round((HEAT_DIFFICULTY.heroic.damageMult - 1) * 100);

  it("the guardian's state says its phase, never a fourth, and its sinking", () => {
    const state = (value: number, value2: number) =>
      say(auraEffectDescriptor({ id: HEAT_AURAS.state, kind: 'internal_cd', value, value2 }));
    const p1 = state(1, HEAT_STAGES.fight);
    expect(p1).toContain(`farther than ${T.flareReach} yd`);
    expect(p1).toContain('70%');
    expect(p1).toContain(`${heroicPct}% more damage`);
    expect(state(2, HEAT_STAGES.fight)).toContain('40%');
    const p3 = state(3, HEAT_STAGES.fight);
    expect(p3).toContain('Rolling Cinders');
    // A phase past the third reads as the third: there is no fourth.
    expect(state(4, HEAT_STAGES.fight)).toBe(p3);
    for (const stage of [HEAT_STAGES.sinking, HEAT_STAGES.under, HEAT_STAGES.rising])
      expect(state(1, stage)).toContain('cannot be attacked');
  });

  it('each mark says its rule with the live numbers', () => {
    const scorched = say(
      auraEffectDescriptor({ id: HEAT_AURAS.scorched, kind: 'spellvuln', value: T.scorchedPct }),
    );
    expect(scorched).toContain(`${Math.round(T.scorchedPct * 100)}% more Fire`);
    expect(scorched).toContain(`Every ${T.flareEvery} sec`);
    expect(scorched).toContain(`farther than ${T.flareReach} yd`);
    const kindling = say(
      auraEffectDescriptor({ id: HEAT_AURAS.kindling, kind: 'internal_cd', value: 0 }),
    );
    expect(kindling).toContain(`In ${T.markSeconds} sec`);
    expect(kindling).toContain(`for ${T.trailSeconds} sec`);
    expect(kindling).toContain(`${T.trailMin} to ${T.trailMax} Fire`);
    expect(kindling).toContain(`${Math.round(T.trailHealPct * 100)}% of its health`);
    const trail = say(
      auraEffectDescriptor({ id: HEAT_AURAS.trail, kind: 'internal_cd', value: 0 }),
    );
    expect(trail).toContain(`${T.trailR} yd wide`);
    expect(trail).toContain(`burn for ${T.trailLife} sec`);
    const hunted = say(
      auraEffectDescriptor({ id: HEAT_AURAS.hunted, kind: 'internal_cd', value: 0 }),
    );
    expect(hunted).toContain(`within ${T.cinderSplashR} yd`);
    expect(hunted).toContain(`${T.cinderKnock} yd back`);
    expect(hunted).toContain(`${T.crustSeconds} sec`);
    expect(
      say(auraEffectDescriptor({ id: HEAT_AURAS.crust, kind: 'internal_cd', value: 0 })),
    ).toContain('cannot knock it back');
  });

  it("Cinder Grip's tooltip is the stacking burn the guardian's swings lay", () => {
    const f = heatFight(3);
    f.dev('/dev heart heat pull');
    const tank = f.players[0];
    f.boss().threat.set(tank.id, 1e6);
    f.tick(2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.fistTimer = 999;
    st.flareTimer = 999;
    let a = tank.auras.find((x) => x.id === HEAT_AURAS.grip);
    for (let i = 0; i < 20 * 30 && !(a && (a.stacks ?? 0) >= 2); i++) {
      f.tick(1);
      a = tank.auras.find((x) => x.id === HEAT_AURAS.grip);
    }
    if (!a) throw new Error('no grip');
    const text = say(auraEffectDescriptor(a));
    expect(text).toContain(`each of your ${a.stacks} stacks`);
    expect(text).toContain(`${T.gripPerTick} for each`);
    expect(text).toContain(`up to ${T.gripMaxStacks}`);
    expect(text).toContain(`lasts ${T.gripSeconds} sec`);
  });

  it('the marks sit on the debuff bar', () => {
    for (const id of [HEAT_AURAS.kindling, HEAT_AURAS.trail, HEAT_AURAS.hunted, HEAT_AURAS.crust])
      expect(isDebuffDisplayAura('internal_cd', 0, id), id).toBe(true);
    expect(isDebuffDisplayAura('spellvuln', T.scorchedPct, HEAT_AURAS.scorched)).toBe(true);
  });

  it('every bar, damage and aura name has its localized form', () => {
    expect(t(`abilityUi.cast.${HEAT_CASTS.fist}` as never)).toBe(HEAT_NAMES.fist);
    for (const name of Object.values(HEAT_NAMES))
      expect(localizeSimAuraName(name), name).toBe(name);
  });
});
