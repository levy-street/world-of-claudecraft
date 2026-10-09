// The Knellwyrm's heroic Burning Knell (src/sim/encounters/hollow_crypt/
// knellwyrm_knell.ts): on heroic it takes flight over the Rite Ring (out of
// reach), marks HALF the ring, breathes its ghost fire over that half after
// the mark's bar, three halves a flight (each a different quarter from the
// last, drawn from ctx.rng in a fixed order), then lands and fights on. Normal
// keeps its kit untouched. Full Sim ticks in a real claimed Hollow Crypt.

import { describe, expect, it, vi } from 'vitest';
import {
  cryptDevTrigger,
  inKnellHalf,
  KNELL_HALF_FIRE_TEMPLATE,
  KNELL_HALF_MARK_TEMPLATE,
  KNELL_TUNING,
  KNELLWYRM_AIRBORNE,
  KNELLWYRM_ID,
  KNELLWYRM_KNELL_BREATH,
  KNELLWYRM_KNELL_LAND,
  KNELLWYRM_KNELL_MARK,
  KNELLWYRM_KNELL_RISE,
  KNELLWYRM_TUNING,
  knellHalfYaw,
  MORTHEN_ID,
  RITE_RING,
} from '../src/sim/encounters/hollow_crypt';
import { DT, type Entity } from '../src/sim/types';
import { aura, cryptFight, type Fight, put, run, took, until } from './helpers/crypt_boss_fight';

vi.setConfig({ testTimeout: 90_000 });

const K = KNELL_TUNING;

/** Slay Morthen and let the wyrm fly in, then hand it the fight. */
function wyrmFight(difficulty: 'normal' | 'heroic', seed = 23): { f: Fight; w: Entity } {
  const f = cryptFight(difficulty, 3, new Set([MORTHEN_ID]), seed);
  cryptDevTrigger(f.sim.ctx, f.inst, 'skip');
  const m = f.inst.mobIds
    .map((id) => f.sim.ctx.entities.get(id))
    .find((e) => e?.templateId === MORTHEN_ID) as Entity;
  for (const p of [f.tank, ...f.others]) put(f, p, 0, 196);
  run(f, DT);
  f.sim.ctx.handleDeath(m, f.tank);
  run(
    f,
    KNELLWYRM_TUNING.pyreSeconds +
      KNELLWYRM_TUNING.arriveSeconds +
      KNELLWYRM_TUNING.settleSeconds +
      0.5,
  );
  const w = f.inst.mobIds
    .map((id) => f.sim.ctx.entities.get(id))
    .find((e) => e?.templateId === KNELLWYRM_ID) as Entity;
  if (!w) throw new Error('no wyrm');
  w.maxHp = 1e7;
  w.hp = w.maxHp;
  f.sim.ctx.aggroMob(w, f.tank, false);
  run(f, DT);
  return { f, w };
}

function halfObjects(f: Fight): Entity[] {
  return f.inst.objectIds
    .map((id) => f.sim.ctx.entities.get(id))
    .filter(
      (e): e is Entity =>
        !!e &&
        (e.templateId === KNELL_HALF_MARK_TEMPLATE || e.templateId === KNELL_HALF_FIRE_TEMPLATE),
    );
}

describe('Burning Knell: the geometry', () => {
  it('a half is the side of the diameter its yaw faces, out to the fire reach', () => {
    const c = { x: RITE_RING.x, z: RITE_RING.z };
    // North (0): +z of the centre.
    expect(knellHalfYaw(0)).toBe(0);
    expect(inKnellHalf(0, c.x, c.z + 10)).toBe(true);
    expect(inKnellHalf(0, c.x, c.z - 10)).toBe(false);
    // East (1): +x.
    expect(inKnellHalf(1, c.x + 20, c.z)).toBe(true);
    expect(inKnellHalf(1, c.x - 20, c.z)).toBe(false);
    // Out past the reach nothing burns.
    expect(inKnellHalf(0, c.x, c.z + K.reach + 1)).toBe(false);
  });
});

describe('Burning Knell: heroic flight', () => {
  it('takes wing out of reach, marks a half, burns only that half, three times, then lands', () => {
    const { f, w } = wyrmFight('heroic');
    const st = w.knellwyrmFight;
    if (!st) throw new Error('no fight');
    expect(cryptDevTrigger(f.sim.ctx, f.inst, 'knell')).toMatch(/takes wing/);
    expect(w.castingAbility).toBe(KNELLWYRM_KNELL_RISE);
    run(f, K.riseSeconds * 0.5);
    expect(aura(w, KNELLWYRM_AIRBORNE)).toBeDefined();
    expect(w.hostile).toBe(false);
    expect(w.damageImmune).toBe(true);
    run(f, K.riseSeconds * 0.5 + DT);
    const floor = f.sim.ctx.groundPos(f.ox + RITE_RING.x, f.oz + RITE_RING.z).y;
    expect(w.pos.y - floor).toBeGreaterThan(K.height - 0.5);
    const halves: number[] = [];
    for (let b = 0; b < K.breaths; b++) {
      expect(w.castingAbility).toBe(KNELLWYRM_KNELL_MARK);
      const k = st.knell;
      if (!k) throw new Error('no knell');
      halves.push(k.half);
      const marks = halfObjects(f);
      expect(marks).toHaveLength(1);
      expect(marks[0].templateId).toBe(KNELL_HALF_MARK_TEMPLATE);
      expect(marks[0].facing).toBeCloseTo(knellHalfYaw(k.half), 5);
      expect(marks[0].scale).toBe(K.reach);
      // One player in the marked half, the rest on the other side.
      const yaw = knellHalfYaw(k.half);
      const inside = f.others[0];
      const safe = f.others[1];
      const hold = () => {
        put(f, inside, RITE_RING.x + Math.sin(yaw) * 14, RITE_RING.z + Math.cos(yaw) * 14);
        put(f, safe, RITE_RING.x - Math.sin(yaw) * 14, RITE_RING.z - Math.cos(yaw) * 14);
        put(f, f.tank, RITE_RING.x - Math.sin(yaw) * 10, RITE_RING.z - Math.cos(yaw) * 10);
        put(f, f.others[2], RITE_RING.x - Math.sin(yaw) * 6, RITE_RING.z - Math.cos(yaw) * 6);
      };
      const from = f.hits.length;
      // Nothing burns while the mark's bar fills.
      run(f, K.markSeconds - 0.2, hold);
      expect(f.hits.slice(from).some((h) => h.ability === 'Burning Knell')).toBe(false);
      run(f, 0.25, hold);
      expect(w.castingAbility).toBe(KNELLWYRM_KNELL_BREATH);
      expect(halfObjects(f)[0].templateId).toBe(KNELL_HALF_FIRE_TEMPLATE);
      const mult = w.mechanicDamageMult ?? 1;
      const burn = took(f, inside, 'Burning Knell', from);
      expect(burn).toBeGreaterThanOrEqual(Math.round(K.fireMin * mult));
      expect(burn).toBeLessThanOrEqual(Math.round(K.fireMax * mult));
      expect(took(f, safe, 'Burning Knell', from)).toBe(0);
      expect(took(f, f.tank, 'Burning Knell', from)).toBe(0);
      run(f, K.breathSeconds, hold);
    }
    // Every half differs from the one before it.
    for (let i = 1; i < halves.length; i++) expect(halves[i]).not.toBe(halves[i - 1]);
    expect(w.castingAbility).toBe(KNELLWYRM_KNELL_LAND);
    expect(halfObjects(f)).toHaveLength(0);
    run(f, K.landSeconds + 0.1);
    expect(st.knell).toBeNull();
    expect(aura(w, KNELLWYRM_AIRBORNE)).toBeUndefined();
    expect(w.damageImmune).toBe(false);
    expect(w.hostile).toBe(true);
    expect(w.inCombat).toBe(true);
    expect(w.pos.y - floor).toBeLessThan(1.5);
  });

  it('flies on its own clock on heroic, and the fight stays on through the flight', () => {
    const { f, w } = wyrmFight('heroic');
    expect(until(f, () => w.castingAbility === KNELLWYRM_KNELL_RISE, K.first + 6)).toBe(true);
    run(f, K.riseSeconds + K.breaths * (K.markSeconds + K.breathSeconds) + K.landSeconds + 0.3);
    expect(w.knellwyrmFight?.knell).toBeNull();
    expect(w.inCombat).toBe(true);
    expect(w.dead).toBe(false);
  });

  it('a wipe mid-flight grounds it and clears the marked half', () => {
    const { f, w } = wyrmFight('heroic');
    cryptDevTrigger(f.sim.ctx, f.inst, 'knell');
    run(f, K.riseSeconds + 1);
    expect(halfObjects(f)).toHaveLength(1);
    for (const p of [f.tank, ...f.others]) {
      p.hp = 0;
      p.dead = true;
    }
    run(f, 2);
    expect(halfObjects(f)).toHaveLength(0);
    expect(aura(w, KNELLWYRM_AIRBORNE)).toBeUndefined();
    expect(w.damageImmune).toBe(false);
  });

  it('is deterministic: the same seed draws the same halves', () => {
    const draw = (seed: number) => {
      const { f, w } = wyrmFight('heroic', seed);
      cryptDevTrigger(f.sim.ctx, f.inst, 'knell');
      const halves: number[] = [];
      run(f, K.riseSeconds + K.breaths * (K.markSeconds + K.breathSeconds), () => {
        const h = w.knellwyrmFight?.knell?.half;
        if (h !== undefined && h >= 0 && halves.at(-1) !== h) halves.push(h);
      });
      return halves;
    };
    const a = draw(57);
    expect(a.length).toBe(K.breaths);
    expect(draw(57)).toEqual(a);
  });
});

describe('Burning Knell: only the crag top burns', () => {
  it('a player far under the ring in the marked half is never burned', () => {
    const { f, w } = wyrmFight('heroic');
    const st = w.knellwyrmFight;
    if (!st) throw new Error('no fight');
    cryptDevTrigger(f.sim.ctx, f.inst, 'knell');
    run(f, K.riseSeconds + DT);
    const k = st.knell;
    if (!k) throw new Error('no knell');
    // The south half: past the south rim the Choir Loft lies about 19 yd under
    // the ring, still inside the fire's reach on the map.
    k.half = 2;
    const below = f.others[0];
    const hold = () => put(f, below, RITE_RING.x, RITE_RING.z - (RITE_RING.r + 3));
    hold();
    const ring = f.sim.ctx.groundPos(f.ox + RITE_RING.x, f.oz + RITE_RING.z).y;
    expect(below.pos.y).toBeLessThan(ring - 10);
    expect(inKnellHalf(2, RITE_RING.x, RITE_RING.z - (RITE_RING.r + 3))).toBe(true);
    const from = f.hits.length;
    run(f, K.markSeconds + 0.3, hold);
    expect(took(f, below, 'Burning Knell', from)).toBe(0);
  });
});

describe('Burning Knell: normal keeps the kit as is', () => {
  it('a flight forced by hand on normal still finishes and lands', () => {
    const { f, w } = wyrmFight('normal');
    expect(cryptDevTrigger(f.sim.ctx, f.inst, 'knell')).toMatch(/takes wing/);
    run(f, K.riseSeconds + K.breaths * (K.markSeconds + K.breathSeconds) + K.landSeconds + 0.3);
    expect(w.knellwyrmFight?.knell).toBeNull();
    expect(aura(w, KNELLWYRM_AIRBORNE)).toBeUndefined();
    expect(w.damageImmune).toBe(false);
  });

  it('never takes the knell flight on normal', () => {
    const { f, w } = wyrmFight('normal');
    let flew = false;
    run(f, K.first + K.every * 0.3, () => {
      if (
        w.castingAbility === KNELLWYRM_KNELL_RISE ||
        w.castingAbility === KNELLWYRM_KNELL_MARK ||
        aura(w, KNELLWYRM_AIRBORNE)
      )
        flew = true;
    });
    expect(flew).toBe(false);
    expect(halfObjects(f)).toHaveLength(0);
  });
});
