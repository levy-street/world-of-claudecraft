// Jose's playtest of the Masterless Strength, 2026-11-20 (design doc 7.5), on
// a REAL Sim:
//   - Elemental Fusion fires on the real path: the raid WALKING the boss over
//     a ridge (its real move input), solo and in a group, through the ring and
//     after an intermission;
//   - `/dev heart final fusion <combo>` with Weight of the Anvil in flight: the
//     Anvil goes with its bar (it was left on the floor); `now` lets it land;
//   - `/dev heart final opposites` alone: the caller is marked and a practice
//     echo of the opposite element stands beside them (it did nothing solo);
//     play's rounds are unchanged.

import { describe, expect, it } from 'vitest';
import { HEART_ROOM, type SmithHeartVein } from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  heartQuarterSpot,
  heartRidgeBearingDeg,
} from '../src/sim/content/smith_heart_quarters';
import {
  ELEMENT_TUNING as E,
  ELEMENT_AURAS,
  ELEMENT_NAMES,
  ELEMENT_OBJECTS,
  echoOf,
} from '../src/sim/encounters/smith_heart/final_elements_ids';
import {
  FINAL_AURAS,
  FINAL_OBJECTS,
  FINAL_TUNING as T,
} from '../src/sim/encounters/smith_heart/final_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import { type FinalFight, finalFight } from './helpers/final_fight';

const sec = (s: number) => Math.round(s * 20);
const DEG = Math.PI / 180;
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);

/** A point `past` yards beyond ridge `k` at radius `r` (clockwise side). */
function pastRidge(k: number, r: number, past: number): { x: number; z: number } {
  const b = heartRidgeBearingDeg(k, r) * DEG + past / r;
  return { x: HEART_ROOM.x + Math.sin(b) * r, z: HEART_ROOM.z + Math.cos(b) * r };
}

/** The raid walks to `goal` for `seconds` (the tank on it, the rest round
 *  it), by their real move input. Returns the events. */
function walk(f: FinalFight, goal: { x: number; z: number }, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < sec(seconds); t++) {
    f.players.forEach((p, i) => {
      if (i === 0) return;
      const meta = f.sim.ctx.players.get(p.id);
      if (!meta) return;
      const a = (i / f.players.length) * Math.PI * 2;
      const here = f.local(p);
      const tx = goal.x + Math.sin(a) * 3;
      const tz = goal.z + Math.cos(a) * 3;
      const d = Math.hypot(tx - here.x, tz - here.z);
      meta.moveInput.forward = d > 1;
      if (d > 1) p.facing = Math.atan2(tx - here.x, tz - here.z);
    });
    const meta = f.sim.ctx.players.get(f.players[0].id);
    if (!meta) throw new Error('not a player');
    const here = f.local(f.players[0]);
    const d = Math.hypot(goal.x - here.x, goal.z - here.z);
    meta.moveInput.forward = d > 1.5;
    if (d > 1.5) f.players[0].facing = Math.atan2(goal.x - here.x, goal.z - here.z);
    out.push(...f.tick(1));
  }
  for (const p of f.players) {
    const meta = f.sim.ctx.players.get(p.id);
    if (meta) meta.moveInput.forward = false;
  }
  return out;
}

const fusionStarts = (ev: SimEvent[]) =>
  ev.filter((e) => e.type === 'spellfx' && e.ability === 'heart_final_fusion_start').length;

describe('Elemental Fusion on the real drag (Jose: "I never saw the combos")', () => {
  for (const n of [1, 5])
    it(`${n === 1 ? 'solo' : 'a group'}: walking the boss over a ridge fuses the two quarters`, () => {
      const f = finalFight(n, 41);
      f.pullIn('heat');
      walk(f, f.local(f.players[0]), 2);
      expect(f.state()?.elements.fusions).toBe(0);
      const k = HEART_QUARTER_ORDER.indexOf('heat');
      const to = HEART_QUARTER_ORDER[(k + 1) % 4];
      const ev = walk(f, pastRidge(k, 30, 8), 16);
      const st = f.state();
      expect(st?.zone).toBe(to);
      expect(fusionStarts(ev)).toBe(1);
      expect(st?.elements.fusions).toBe(1);
      expect(st?.elements.lastCombo).toBe('firestorm');
      expect(st?.elements.comboQuarter).toBe(to);
    });

  it('dragged through the ring into another quarter, and after an intermission', () => {
    const f = finalFight(5, 41);
    f.pullIn('heat');
    walk(f, f.local(f.players[0]), 2);
    // Through the ring into the Quench.
    let ev = walk(f, heartQuarterSpot('quench'), 25);
    expect(f.state()?.zone).toBe('quench');
    // (The walk may clip the quarter between on its way: each new one fuses.)
    expect(fusionStarts(ev)).toBeGreaterThanOrEqual(1);
    expect(f.state()?.elements.comboQuarter).toBe('quench');
    // An intermission, its Splinters down, the call over.
    f.dev('/dev heart final inter70');
    walk(f, f.local(f.players[0]), 8);
    f.dev('/dev heart final killadds');
    walk(f, f.local(f.players[0]), 6);
    expect(f.state()?.phase.stage).toBe('fight');
    const before = f.state()?.elements.fusions ?? 0;
    // A quarter it has not stood in last: the Hammer.
    ev = walk(f, heartQuarterSpot('hammer' as SmithHeartVein), 25);
    expect(f.state()?.zone).toBe('hammer');
    expect(f.state()?.elements.fusions).toBeGreaterThan(before);
  });
});

describe('the dev fusion with Weight of the Anvil in flight (the Anvil stayed on the floor)', () => {
  it('its bar takes the Anvil away with it: no mark, no object left behind', () => {
    const f = finalFight(5, 41);
    f.pullIn('hammer');
    f.dev('/dev heart final anvil');
    f.tick(sec(1));
    expect(f.objects(FINAL_OBJECTS.anvilPrefix).length).toBe(1);
    expect(f.dev('/dev heart final fusion avalanche')).toBe(true);
    f.tick(1);
    expect(f.state()?.anvil).toBeNull();
    expect(f.objects(FINAL_OBJECTS.anvilPrefix).length).toBe(0);
    for (const p of f.players) expect(aura(p, FINAL_AURAS.anvilMark)).toBeUndefined();
    // The fusion lands its Avalanche; nothing of the Anvil comes back.
    f.tick(sec(E.fusionCast + 0.2));
    expect(f.state()?.elements.lastCombo).toBe('avalanche');
    expect(f.objects(ELEMENT_OBJECTS.avalanchePrefix).length).toBeGreaterThan(0);
    f.tick(sec(T.anvilCast + E.avalancheWarn + E.avalancheRun + 1));
    expect(f.objects(FINAL_OBJECTS.anvilPrefix).length).toBe(0);
    expect(f.objects(ELEMENT_OBJECTS.avalanchePrefix).length).toBe(0);
  });

  it('`now` plants no bar: the Anvil falls on its own time', () => {
    const f = finalFight(5, 41);
    f.pullIn('hammer');
    f.dev('/dev heart final anvil');
    f.tick(sec(1));
    expect(f.dev('/dev heart final fusion avalanche now')).toBe(true);
    expect(f.objects(FINAL_OBJECTS.anvilPrefix).length).toBe(1);
    const ev = f.tick(sec(T.anvilCast));
    expect(ev.some((e) => e.type === 'damage' && e.ability === 'Weight of the Anvil')).toBe(true);
    expect(f.objects(FINAL_OBJECTS.anvilPrefix).length).toBe(0);
    expect(f.state()?.anvil).toBeNull();
  });

  it('a mark whose bar is gone never strands (the sim guard)', () => {
    const f = finalFight(5, 41);
    f.pullIn('hammer');
    f.dev('/dev heart final anvil');
    f.tick(sec(1));
    const st = f.state();
    if (!st) throw new Error('no fight');
    // Its bar taken without the dev path's cleanup.
    st.bar = null;
    f.boss().castingAbility = null;
    f.tick(1);
    expect(st.anvil).toBeNull();
    expect(f.objects(FINAL_OBJECTS.anvilPrefix).length).toBe(0);
  });
});

describe('`/dev heart final opposites` alone (it did nothing solo)', () => {
  it('marks the caller and stands a practice echo of the opposite beside them', () => {
    const f = finalFight(1, 41);
    f.pullIn('heat');
    const me = f.players[0];
    expect(f.dev('/dev heart final opposites')).toBe(true);
    const mark = aura(me, ELEMENT_AURAS.polarity);
    expect(mark).toBeDefined();
    const echoes = f.objects(ELEMENT_OBJECTS.echoPrefix);
    expect(echoes.length).toBe(1);
    expect(echoOf(echoes[0].templateId)).toBe('ice');
    expect(f.state()?.elements.marks.length).toBe(2);
    // Walking into it cancels both, harmlessly.
    const e = f.local(echoes[0]);
    walk(f, f.local(me), E.polarityGrace + 0.1);
    f.put(me, e.x + 1, e.z);
    const ev = f.tick(2);
    expect(f.state()?.elements.balanced).toBe(1);
    expect(aura(me, ELEMENT_AURAS.polarity)).toBeUndefined();
    expect(f.objects(ELEMENT_OBJECTS.echoPrefix).length).toBe(0);
    expect(ev.some((x) => x.type === 'damage' && x.ability === ELEMENT_NAMES.clash)).toBe(false);
  });

  it('left alone it runs out on the caller (never on the echo), and the echo goes', () => {
    const f = finalFight(1, 41);
    f.pullIn('heat');
    const me = f.players[0];
    f.dev('/dev heart final opposites');
    const ev = f.tick(sec(E.polaritySeconds + 0.2));
    const late = ev.filter((x) => x.type === 'damage' && x.ability === ELEMENT_NAMES.unbalanced);
    expect(late.length).toBe(1);
    expect(late[0].type === 'damage' && late[0].targetId).toBe(me.id);
    expect(f.objects(ELEMENT_OBJECTS.echoPrefix).length).toBe(0);
    expect(f.state()?.elements.marks.length).toBe(0);
  });

  it("with a group to pair, the dev round is play's own: no echo", () => {
    const f = finalFight(6, 41);
    f.pullIn('heat');
    f.dev('/dev heart final opposites');
    expect(f.objects(ELEMENT_OBJECTS.echoPrefix).length).toBe(0);
    expect(f.state()?.elements.marks.length).toBe(4);
  });

  it('a wipe clears the echo with the marks', () => {
    const f = finalFight(1, 41);
    f.pullIn('heat');
    f.dev('/dev heart final opposites');
    f.dev('/dev heart final reset');
    f.tick(1);
    expect(f.objects(ELEMENT_OBJECTS.echoPrefix).length).toBe(0);
    expect(aura(f.players[0], ELEMENT_AURAS.polarity)).toBeUndefined();
  });
});
