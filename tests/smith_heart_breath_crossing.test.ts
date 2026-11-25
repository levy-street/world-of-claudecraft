// The Gale Crossing (encounters/smith_heart/breath_crossing.ts; the owner's
// playtest of 2026-11-25): the Storm Cornice stands a chasm forward of the
// climb's head, and the wind carries the raid over. The landing's pad is
// always up; the Cornice's home pad only while the guardian is not fighting.
// A ride is a FIXED arc, carried and stunned, never a fall; a spirit crosses
// too (a corpse run); deterministic; a fall off the open approach is the
// void's, its body laid back on the approach, not over the chasm.

import { describe, expect, it } from 'vitest';
import {
  BREATH,
  CORNICE_CROSSING,
  CORNICE_LANDING,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import { startCrossing } from '../src/sim/encounters/smith_heart/breath_crossing';
import {
  CROSSING_OBJECTS,
  CROSSING_TUNING,
} from '../src/sim/encounters/smith_heart/breath_crossing_ids';
import {
  inBreathArena,
  onCorniceApproach,
  THESSALY_POST,
  voidCorpseSpot,
} from '../src/sim/encounters/smith_heart/breath_geometry';
import { ISLE_AURAS } from '../src/sim/encounters/smith_heart/breath_isle_ids';
import { authoredFieldCliffRuns, authoredFieldHeight } from '../src/sim/instances/authored_field';
import { DT } from '../src/sim/types';
import { breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s / DT);
const C = CORNICE_CROSSING;

describe('the Gale Crossing: the layout', () => {
  it('the landing and its pad stand off the fight, a chasm short of the Cornice', () => {
    expect(onCorniceApproach(CORNICE_LANDING.x, CORNICE_LANDING.z)).toBe(true);
    expect(inBreathArena(CORNICE_LANDING.x, CORNICE_LANDING.z)).toBe(false);
    for (const at of [C.out, C.back, THESSALY_POST]) {
      expect(Math.hypot(at.x - CORNICE_LANDING.x, at.z - CORNICE_LANDING.z)).toBeLessThan(
        CORNICE_LANDING.r - 1,
      );
      expect(inBreathArena(at.x, at.z)).toBe(false);
    }
    // The Cornice's pad and its landing spot on its floor, well inside the rim.
    for (const at of [C.home, C.arrive]) expect(inBreathArena(at.x, at.z)).toBe(true);
    // A pad never takes a body set down by the other way's ride.
    expect(Math.hypot(C.arrive.x - C.home.x, C.arrive.z - C.home.z)).toBeGreaterThan(C.r + 4);
    expect(Math.hypot(C.back.x - C.out.x, C.back.z - C.out.z)).toBeGreaterThan(C.r + 4);
    // Between them only the void (no floor to walk or jump).
    let open = 0;
    for (let x = C.out.x + C.r + 2; x < C.arrive.x - 8; x += 0.5)
      if (authoredFieldHeight(SMITH_HEART_FIELD, x, C.out.z) <= SMITH_HEART_FIELD.voidHeight + 1)
        open++;
    expect(open * 0.5).toBeGreaterThanOrEqual(12);
  });
});

describe('the Gale Crossing: the ride', () => {
  it('out of the fight: the landing pad carries a raider over to the Cornice, home and back', () => {
    const f = breathFight(2);
    const p = f.players[1];
    // Everyone back on the landing: the guardian (pulled by the helper's
    // spots) lets them go and stands down.
    for (const q of f.players) f.put(q, C.back.x, C.back.z);
    f.tick(ticks(12));
    expect(f.boss().inCombat).toBe(false);
    expect(f.objects(CROSSING_OBJECTS.out)).toHaveLength(1);
    expect(f.objects(CROSSING_OBJECTS.home)).toHaveLength(1);
    f.put(p, C.out.x, C.out.z);
    f.tick(2);
    expect(p.carriedBy).toBeDefined();
    expect(p.auras.some((a) => a.id === ISLE_AURAS.riding)).toBe(true);
    // Carried on its arc, over the chasm and never below the floors' height.
    let minY = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ticks(CROSSING_TUNING.seconds) + 4; i++) {
      f.tick(1);
      if (p.carriedBy !== undefined) minY = Math.min(minY, p.pos.y);
    }
    expect(minY).toBeGreaterThan(BREATH.cornice.h - 1);
    expect(p.carriedBy).toBeUndefined();
    expect(p.dead).toBe(false);
    expect(p.auras.some((a) => a.id === ISLE_AURAS.riding)).toBe(false);
    const at = f.local(p);
    expect(Math.hypot(at.x - C.arrive.x, at.z - C.arrive.z)).toBeLessThan(0.5);
    expect(inBreathArena(at.x, at.z)).toBe(true);
    expect(f.objects(CROSSING_OBJECTS.ride)).toHaveLength(0);
    // Home again from the Cornice's pad.
    f.put(p, C.home.x, C.home.z);
    f.tick(ticks(CROSSING_TUNING.seconds) + 6);
    const back = f.local(p);
    expect(Math.hypot(back.x - C.back.x, back.z - C.back.z)).toBeLessThan(0.5);
    expect(p.dead).toBe(false);
  });

  it('in the fight the way home is gone; the way out still runs', () => {
    const f = breathFight(3);
    expect(f.dev('/dev heart breath pull')).toBe(true);
    f.dev('/dev heart breath calm');
    f.tick(3);
    expect(f.objects(CROSSING_OBJECTS.home)).toHaveLength(0);
    expect(f.objects(CROSSING_OBJECTS.out)).toHaveLength(1);
    const p = f.players[2];
    // Standing where the pad home stood takes nobody anywhere.
    f.put(p, C.home.x, C.home.z);
    f.tick(10);
    expect(p.carriedBy).toBeUndefined();
  });

  it('a spirit crosses on its corpse run; a body not yet released never rides', () => {
    const f = breathFight(2);
    const p = f.players[1];
    for (const q of f.players) f.put(q, C.back.x, C.back.z);
    f.tick(2);
    p.dead = true;
    p.ghost = false;
    expect(startCrossing(f.sim.ctx, f.inst, p, 'out')).toBe(false);
    p.ghost = true;
    f.put(p, C.out.x, C.out.z);
    f.tick(2);
    expect(p.carriedBy).toBeDefined();
    // No stun aura on a spirit (it is carried all the same).
    expect(p.auras.some((a) => a.id === ISLE_AURAS.riding)).toBe(false);
    f.tick(ticks(CROSSING_TUNING.seconds) + 4, false);
    expect(Math.hypot(f.local(p).x - C.arrive.x, f.local(p).z - C.arrive.z)).toBeLessThan(0.5);
  });

  it('runs the same twice (deterministic)', () => {
    const run = () => {
      const f = breathFight(3, 11);
      f.tick(2);
      f.put(f.players[1], C.out.x, C.out.z);
      f.put(f.players[2], C.out.x + 0.5, C.out.z);
      const path: number[] = [];
      for (let i = 0; i < ticks(CROSSING_TUNING.seconds) + 6; i++) {
        f.tick(1);
        path.push(f.players[1].pos.x, f.players[1].pos.y, f.players[2].pos.z);
      }
      return path;
    };
    expect(run()).toEqual(run());
  });
});

describe('the open approach', () => {
  it('a body fallen off the climb or the landing is laid back on the approach, never over the chasm', () => {
    // Off the landing's north edge, off the climb's south side.
    for (const fall of [
      { x: CORNICE_LANDING.x, z: CORNICE_LANDING.z + CORNICE_LANDING.r + 3 },
      { x: -85, z: 178 },
    ]) {
      const back = voidCorpseSpot(fall.x, fall.z);
      expect(onCorniceApproach(back.x, back.z)).toBe(true);
      expect(inBreathArena(back.x, back.z)).toBe(false);
    }
    // Off the Cornice itself: laid back on the Cornice.
    const rim = voidCorpseSpot(0, BREATH.cornice.z + BREATH.cornice.rz + 3);
    expect(inBreathArena(rim.x, rim.z)).toBe(true);
  });

  it('the climb and the landing stand open: no wall along the approach', () => {
    const runs = authoredFieldCliffRuns(SMITH_HEART_FIELD);
    const approach = runs.filter(
      (r) =>
        (r.surface === 'cornice_landing' || (r.surface === 'cornice_climb' && r.ax > -96)) &&
        r.low <= SMITH_HEART_FIELD.voidHeight + 1,
    );
    expect(approach.length).toBeGreaterThan(6);
    expect(approach.filter((r) => !r.open)).toEqual([]);
  });
});
