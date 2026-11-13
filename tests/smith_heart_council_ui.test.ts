// The Hammer Council's player text: no raid warning banner (the mechanics
// read in the world; the yells stay), the personal alert's priorities, the marks' tooltips from the live tuning, and
// every cast and damage name re-localized.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_NAMES,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart/council_ids';
import type { SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { buildCouncilAlertView, councilRushMarked } from '../src/ui/hud/dungeon/council_alert_view';
import { dungeonPromptEnabled } from '../src/ui/hud/dungeon/dungeon_prompt_policy_core';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { councilFight } from './helpers/council_fight';

type Chat = Extract<SimEvent, { type: 'chat' }>;

describe('Hammer Council raid warnings', () => {
  it('calls no raid warning banner: every mechanic reads in the world, the yells stay', () => {
    const f = councilFight(6);
    f.dev('/dev heart council pull');
    const events: SimEvent[] = [];
    events.push(...f.tick(20));
    for (const cmd of ['wrath', 'weight', 'wake', 'rock', 'song', 'rush']) {
      f.dev(`/dev heart council ${cmd}`);
      events.push(...f.tick(20 * 9));
    }
    // A fallen member.
    const b = f.bodies();
    if (b.singer) f.sim.ctx.handleDeath(b.singer, f.players[0]);
    events.push(...f.tick(5));
    const warns = events.filter((e): e is Chat => e.type === 'chat' && e.channel === 'raidWarning');
    expect(warns).toEqual([]);
    // The boss yells still carry the fight's voice.
    const yells = events.filter(
      (e): e is Chat => e.type === 'chat' && (e.textKey ?? '').startsWith('hudChrome.council.say.'),
    );
    expect(yells.length).toBeGreaterThan(0);
  });
});

describe('Hammer Council alert', () => {
  const a = (id: string, remaining = 3, duration = 5, value = 0) => ({
    id,
    remaining,
    duration,
    value,
  });

  it('the Rush over the rock over the wake over the Weight over Resonance', () => {
    const all = [
      a(COUNCIL_AURAS.resonance, 4, 6),
      a(COUNCIL_AURAS.weight, 20, 25),
      a(COUNCIL_AURAS.wakeMark),
      a(COUNCIL_AURAS.rockMark),
      a(COUNCIL_AURAS.rushMark, 2, 3),
    ];
    const kind = (auras: typeof all) => {
      const v = buildCouncilAlertView({ auras });
      return v.visible ? v.kind : null;
    };
    expect(kind(all)).toBe('rush');
    expect(kind(all.slice(0, 4))).toBe('rock');
    expect(kind(all.slice(0, 3))).toBe('wake');
    expect(kind(all.slice(0, 2))).toBe('weight');
    expect(kind(all.slice(0, 1))).toBe('resonance');
    expect(kind([])).toBeNull();
    const res = buildCouncilAlertView({ auras: [a(COUNCIL_AURAS.resonance, 4, 6)] });
    expect(res.visible && res.title).toBe(t('hudChrome.council.alert.resonanceTitle'));
    const v = buildCouncilAlertView({ auras: [a(COUNCIL_AURAS.rockMark, 2.5, 5)] });
    expect(v.visible && v.progress).toBeCloseTo(0.5);
    expect(v.visible && v.title).toBe(t('hudChrome.council.alert.rockTitle'));
    // A short title over the bar and its seconds, no sentence under it (the
    // owner's rule of 2026-11-03, kept on 2026-11-09): what a mark asks is
    // its tooltip's.
    for (const id of Object.values({
      rush: COUNCIL_AURAS.rushMark,
      rock: COUNCIL_AURAS.rockMark,
      wake: COUNCIL_AURAS.wakeMark,
      weight: COUNCIL_AURAS.weight,
      resonance: COUNCIL_AURAS.resonance,
    })) {
      const m = buildCouncilAlertView({ auras: [a(id, 2.5, 5)] });
      expect(m.visible && m.line, id).toBe('');
      expect(m.visible && m.barLabel, id).toBe('3s');
      if (m.visible) expect(m.title.split(' ').length, id).toBeLessThanOrEqual(4);
    }
  });
});

describe("Hammer Council alert: Mountain's Rush on you", () => {
  it('the Rush mark is the one council mark the hints setting never hides', () => {
    const mark = { id: COUNCIL_AURAS.rushMark, remaining: 4, duration: 5 };
    expect(councilRushMarked([mark])).toBe(true);
    for (const id of [
      COUNCIL_AURAS.rockMark,
      COUNCIL_AURAS.wakeMark,
      COUNCIL_AURAS.weight,
      COUNCIL_AURAS.resonance,
    ])
      expect(councilRushMarked([{ id, remaining: 4, duration: 5 }]), id).toBe(false);
    const v = buildCouncilAlertView({ auras: [mark] });
    expect(v.visible && v.kind).toBe('rush');
    expect(v.visible && v.title).toBe(t('hudChrome.council.alert.rushTitle'));
  });

  it('paints big and red in the upper middle, throbbing, on every tier', () => {
    const css = readFileSync('src/styles/components.css', 'utf8');
    const rule = css.slice(css.indexOf('#heart-council-alert.is-rush,'));
    expect(rule).toContain('top: 22%;');
    expect(rule).toContain('animation: heart-rush-throb');
    expect(css).toMatch(/#heart-council-alert\.is-rush \.fa-title \{\s*font-size: 44px;/);
    expect(css).toContain('@keyframes heart-rush-throb');
    // Reduced motion (the OS's and the game's own setting) holds the throb.
    const reduced = css.slice(
      css.indexOf('@media (prefers-reduced-motion: reduce) {', css.indexOf('heart-rush-throb')),
    );
    expect(reduced.slice(0, 600)).toMatch(
      /body\.mobile-touch #heart-council-alert\.is-rush \{\s*animation: none;/,
    );
    expect(css).toMatch(
      /body\.reduce-motion\.mobile-touch #heart-council-alert\.is-rush \{\s*animation: none;/,
    );
  });

  it('with the hints off the Rush mark still shows; the other council marks do not', () => {
    expect(dungeonPromptEnabled('council', false)).toBe(false);
    expect(
      dungeonPromptEnabled('council', false, councilRushMarked([{ id: COUNCIL_AURAS.rushMark }])),
    ).toBe(true);
    expect(
      dungeonPromptEnabled('council', false, councilRushMarked([{ id: COUNCIL_AURAS.rockMark }])),
    ).toBe(false);
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
    const resText = t(res?.key as never, res?.nums as never);
    expect(resText).toContain(`${T.resonanceRadius} yd`);
    expect(resText).toContain(String(T.resonanceMin));
    expect(resText).not.toMatch(/\{\w+\}/);
    const rush = auraEffectDescriptor({
      id: COUNCIL_AURAS.rushMark,
      kind: 'vulnerability',
      value: 0,
    });
    const rushText = t(rush?.key as never, rush?.nums as never);
    expect(rushText).toContain(`${T.rushStunSeconds} sec`);
    expect(rushText).toContain(`${Math.round(T.rushExposed * 100)}%`);
    expect(rushText).toContain(String(T.rushMin));
    expect(rushText).not.toMatch(/\{\w+\}/);
    for (const id of [COUNCIL_AURAS.bond, COUNCIL_AURAS.collapse, COUNCIL_AURAS.rushExposed]) {
      const d = auraEffectDescriptor({ id, kind: 'vulnerability', value: 0.5 });
      expect(d?.key, id).toBeDefined();
      expect(t(d?.key as never, d?.nums as never)).not.toMatch(/\{\w+\}/);
    }
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
