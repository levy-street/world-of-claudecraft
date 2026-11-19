// The Hammer Council's player text: no raid warning banner and no on-screen
// marker at all (the mechanics read in the world; the yells stay), the floor
// telegraphs every mark keeps, the marks' tooltips from the live tuning, and
// every cast and damage name re-localized.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COUNCIL_MARK_SPECS, rushLane } from '../src/render/smith_heart_fx/council_fx_core';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_NAMES,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart/council_ids';
import type { SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { DUNGEON_PROMPT_ADVISORY } from '../src/ui/hud/dungeon/dungeon_prompt_policy_core';
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

describe('Hammer Council: no on-screen markers, the world tells it all', () => {
  // The team's feedback of 2026-11-17: "Too many abilities have on-screen
  // markers, remove the UI for all of these". The personal alert (the Rush big
  // and red in the screen's upper middle, the rock, the wake, the Weight,
  // Resonance) is gone; the floor and the bodies carry every mark.
  it('the personal alert is gone: no view, no CSS, no strings, no prompt id', () => {
    expect(existsSync('src/ui/hud/dungeon/council_alert_view.ts')).toBe(false);
    const css = readFileSync('src/styles/components.css', 'utf8');
    expect(css).not.toContain('heart-council-alert');
    expect(css).not.toContain('heart-rush-throb');
    const prompts = readFileSync('src/ui/hud/dungeon/dungeon_prompts.ts', 'utf8');
    expect(prompts).not.toMatch(/council_alert_view|COUNCIL_ALERT_KINDS|heart-council-alert/);
    expect(Object.keys(DUNGEON_PROMPT_ADVISORY)).not.toContain('council');
    const keys = readFileSync('src/ui/i18n.catalog/translation_keys.generated.ts', 'utf8');
    expect(keys).not.toContain("'hudChrome.council.alert.");
    expect(keys).toContain("'hudChrome.council.say.guardian_rush'");
  });

  it('every mark a player wears keeps its floor telegraph, in the sim radius', () => {
    // The floor rings (council_fx.ts seeMark), each at the mechanic's own reach.
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.rushMark].radius).toBe(T.rushHalfWidth);
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.wakeMark].radius).toBe(T.riseKnockRadius);
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.rockMark].radius).toBe(T.rockRadius);
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.resonance].radius).toBe(T.resonanceRadius);
    // The Rush's lane from the Guardian through its mark, at the hit's width.
    const lane = rushLane(0, 0, 10, 0, 0, { yaw: 0, length: 0, half: 0 });
    expect(lane?.half).toBe(T.rushHalfWidth + T.rushBody);
    expect(lane?.length).toBe(10);
    // The painters still read every mark off the mirrored auras: the floor ring
    // and the Weight's ring at the tank's feet (council_fx.ts), the red arrow
    // over the Rush's mark (council_rush_arrow.ts, a world billboard).
    const fx = readFileSync('src/render/smith_heart_fx/council_fx.ts', 'utf8');
    for (const id of ['rockMark', 'resonance', 'weight', 'rushMark', 'wakeMark'])
      expect(fx, id).toContain(`COUNCIL_AURAS.${id}`);
    expect(fx).toContain('smithHeartWeightRing');
    const arrow = readFileSync('src/render/smith_heart_fx/council_rush_arrow.ts', 'utf8');
    expect(arrow).toContain('COUNCIL_AURAS.rushMark');
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
    expect(resText).toContain(String(Math.round(T.resonanceMin * 1.15)));
    expect(resText).not.toMatch(/\{\w+\}/);
    const rush = auraEffectDescriptor({
      id: COUNCIL_AURAS.rushMark,
      kind: 'vulnerability',
      value: 0,
    });
    const rushText = t(rush?.key as never, rush?.nums as never);
    expect(rushText).toContain(`${T.rushStunSeconds} sec`);
    expect(rushText).toContain(`${Math.round(T.rushExposed * 100)}%`);
    expect(rushText).toContain(String(Math.round(T.rushMin * 1.15)));
    expect(rushText).not.toMatch(/\{\w+\}/);
    for (const id of [COUNCIL_AURAS.collapse, COUNCIL_AURAS.rushExposed]) {
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
