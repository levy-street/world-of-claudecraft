// The Hammer Council's player text: every raid warning the council calls
// resolves through its catalog key to the very English the sim sends (so the
// banner and the log never read a raw key or drift from the fight), the
// personal alert's priorities, the marks' tooltips from the live tuning, and
// every cast and damage name re-localized.

import { describe, expect, it } from 'vitest';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_NAMES,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart/council_ids';
import type { SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { buildCouncilAlertView } from '../src/ui/hud/dungeon/council_alert_view';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { councilFight } from './helpers/council_fight';

type Chat = Extract<SimEvent, { type: 'chat' }>;

describe('Hammer Council raid warnings', () => {
  it('every warning resolves its key to the English the sim sent', () => {
    const f = councilFight(6);
    f.dev('/dev heart council pull');
    const events: SimEvent[] = [];
    events.push(...f.tick(20));
    for (const cmd of ['wrath', 'weight', 'wake', 'rock', 'song']) {
      f.dev(`/dev heart council ${cmd}`);
      events.push(...f.tick(20 * 9));
    }
    // A fallen member's line.
    const b = f.bodies();
    if (b.slabwright) f.sim.ctx.handleDeath(b.slabwright, f.players[0]);
    events.push(...f.tick(5));
    const warns = events.filter(
      (e): e is Chat => e.type === 'chat' && e.channel === 'raidWarning' && e.pid === f.pids[0],
    );
    const keys = new Set(warns.map((w) => w.textKey));
    for (const k of ['wrath', 'weight', 'wake', 'rock', 'song', 'resonance', 'fell_slabwright'])
      expect(keys, k).toContain(`hudChrome.council.warn.${k}`);
    for (const w of warns) {
      expect(w.textKey?.startsWith('hudChrome.council.warn.')).toBe(true);
      expect(t(w.textKey as never, w.textValues)).toBe(w.text);
    }
  });
});

describe('Hammer Council alert', () => {
  const a = (id: string, remaining = 3, duration = 5, value = 0) => ({
    id,
    remaining,
    duration,
    value,
  });

  it('the rock over the wake over the Weight over Resonance', () => {
    const all = [
      a(COUNCIL_AURAS.resonance, 10, 15),
      a(COUNCIL_AURAS.weight, 20, 25),
      a(COUNCIL_AURAS.wakeMark),
      a(COUNCIL_AURAS.rockMark),
    ];
    const kind = (auras: typeof all) => {
      const v = buildCouncilAlertView({ auras });
      return v.visible ? v.kind : null;
    };
    expect(kind(all)).toBe('rock');
    expect(kind(all.slice(0, 3))).toBe('wake');
    expect(kind(all.slice(0, 2))).toBe('weight');
    expect(kind(all.slice(0, 1))).toBe('resonance');
    expect(kind([a(COUNCIL_AURAS.resonance, 10, 15, 0.4)])).toBe('cracking');
    expect(kind([])).toBeNull();
    const v = buildCouncilAlertView({ auras: [a(COUNCIL_AURAS.rockMark, 2.5, 5)] });
    expect(v.visible && v.progress).toBeCloseTo(0.5);
    expect(v.visible && v.title).toBe(t('hudChrome.council.alert.rockTitle'));
  });
});

describe('Hammer Council tooltips and names', () => {
  it('each mark says its rule with the live numbers', () => {
    const rock = auraEffectDescriptor({
      id: COUNCIL_AURAS.rockMark,
      kind: 'vulnerability',
      value: 0,
    });
    expect(rock?.key).toBe('hudChrome.auraEffect.council.rockMark');
    expect(rock?.nums).toMatchObject({ total: T.rockTotal, radius: T.rockRadius, soakers: 3 });
    const text = t(rock?.key as never, rock?.nums as never);
    expect(text).toContain(String(T.rockTotal));
    expect(text).not.toMatch(/\{\w+\}/);
    const wake = auraEffectDescriptor({
      id: COUNCIL_AURAS.wakeMark,
      kind: 'vulnerability',
      value: 0,
    });
    expect(t(wake?.key as never, wake?.nums as never)).toContain(`${T.riseKnockRadius} yd`);
    const res = auraEffectDescriptor({
      id: COUNCIL_AURAS.resonance,
      kind: 'vulnerability',
      value: 0,
    });
    expect(t(res?.key as never, res?.nums as never)).toContain(`${T.resonanceCrackSeconds} sec`);
    const mem = auraEffectDescriptor({
      id: COUNCIL_AURAS.memory,
      kind: 'buff_dmg_done',
      value: 0.3,
      stacks: 2,
    });
    expect(t(mem?.key as never, mem?.nums as never)).toContain('30%');
    // Hammer's Weight keeps the generic physical line, which is exactly what it does.
    const weight = auraEffectDescriptor({ id: COUNCIL_AURAS.weight, kind: 'expose', value: 1 });
    expect(weight?.key).toBe('hudChrome.auraEffect.physVuln');
  });

  it('every cast bar and damage name has its localized form', () => {
    for (const id of Object.values(COUNCIL_CASTS))
      expect(t(`abilityUi.cast.${id}` as never)).not.toContain('abilityUi');
    for (const name of Object.values(COUNCIL_NAMES)) {
      expect(localizeSimAuraName(name), name).toBe(name);
    }
  });
});
