// Vael the Fogbinder as Death itself (src/sim/encounters/sunken_bastion/vael.ts):
// the Shadow Crossing, the pool behind his mark, its warning time, the scythe's
// arc, and the heroic Grave Shadow.

import { describe, expect, it, vi } from 'vitest';
import {
  GRAVE_SHADOW_TEMPLATE,
  inReapingSweep,
  REAPER_POOL_TEMPLATE,
  reaperPoolSpot,
  VAEL_ID,
  VAEL_REAP_MARK,
  VAEL_REAPING_SCYTHE,
  VAEL_SHADOWED,
  VAEL_SHADOWSTEP,
  VAEL_TUNING,
} from '../src/sim/encounters/sunken_bastion';
import { DT, type Entity } from '../src/sim/types';
import {
  aura,
  boss,
  engage,
  type Fight,
  fight,
  put,
  run,
  took,
  until,
} from './helpers/bastion_fight';

// Whole-fight scenarios over many sim ticks: room for a loaded worker.
vi.setConfig({ testTimeout: 60_000 });

// ---------------------------------------------------------------------------
describe('Vael, Death itself: the Shadowstep and the scythe from behind', () => {
  function roof(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; vael: Entity } {
    const f = fight(difficulty);
    const vael = boss(f, VAEL_ID);
    put(f, vael, -4, 226);
    put(f, f.tank, -4, 223);
    put(f, f.others[0], 8, 218);
    put(f, f.others[1], -16, 196);
    put(f, f.others[2], 10, 200);
    engage(f, vael);
    return { f, vael };
  }

  it('pure geometry: the pool opens behind the player and the arc sweeps through them', () => {
    const spot = reaperPoolSpot(10, 20, 0);
    expect(spot.x).toBeCloseTo(10, 6);
    expect(spot.z).toBeCloseTo(20 - VAEL_TUNING.behind, 6);
    expect(spot.yaw).toBeCloseTo(0, 6);
    expect(inReapingSweep(spot.x, spot.z, spot.yaw, 10, 20)).toBe(true);
    expect(inReapingSweep(spot.x, spot.z, spot.yaw, 10, 20 + 7)).toBe(false);
    expect(inReapingSweep(spot.x, spot.z, spot.yaw, 10 + 4, 20)).toBe(true);
    expect(inReapingSweep(spot.x, spot.z, spot.yaw, 10, 20 - 6)).toBe(false);
  });

  /** Run until Vael starts to sink (the Mist Surge may push the step back). */
  function sinking(f: Fight, vael: Entity): void {
    const ok = until(f, () => vael.castingAbility === VAEL_SHADOWSTEP, VAEL_TUNING.reapFirst + 6);
    if (!ok) throw new Error('no Shadowstep');
  }

  function poolOf(f: Fight): Entity | undefined {
    return [...f.sim.ctx.entities.values()].find(
      (e) => e.templateId === REAPER_POOL_TEMPLATE || e.templateId === GRAVE_SHADOW_TEMPLATE,
    );
  }

  it('sinks untouchable, opens the pool behind a non-tank, rises and sweeps on time', () => {
    const { f, vael } = roof();
    sinking(f, vael);
    expect(aura(vael, VAEL_SHADOWED)).toBeDefined();
    const hp = vael.hp;
    f.sim.dealDamage(f.tank, vael, 500, false, 'physical', 'Strike', 'hit', false);
    expect(vael.hp).toBe(hp);
    // Everyone stands still, facing north, so the pool opens where we expect.
    const hold: [Entity, number, number][] = f.others.map((p) => [
      p,
      p.pos.x - f.ox,
      p.pos.z - f.oz,
    ]);
    const still = () => {
      for (const [p, x, z] of hold) {
        put(f, p, x, z);
        p.facing = 0;
      }
    };
    const start = f.sim.ctx.time;
    expect(until(f, () => poolOf(f) !== undefined, 2, still)).toBe(true);
    const poolAt = f.sim.ctx.time;
    expect(poolAt - start).toBeGreaterThanOrEqual(VAEL_TUNING.vanishSeconds - DT * 1.5);
    const mark = f.others.find((p) => aura(p, VAEL_REAP_MARK)) as Entity;
    expect(mark).toBeDefined();
    expect(aura(f.tank, VAEL_REAP_MARK)).toBeUndefined();
    // The pool opens behind the mark (they face north: it is south of them).
    const pool = poolOf(f) as Entity;
    expect(Math.hypot(pool.pos.x - mark.pos.x, pool.pos.z - mark.pos.z)).toBeCloseTo(
      VAEL_TUNING.behind,
      1,
    );
    expect(pool.pos.z).toBeLessThan(mark.pos.z);
    const from = f.hits.length;
    expect(until(f, () => took(f, mark, 'Reaping Scythe', from) > 0, 4, still)).toBe(true);
    // The pool shows for the whole warning before the scythe lands.
    expect(f.sim.ctx.time - poolAt).toBeGreaterThanOrEqual(
      VAEL_TUNING.poolSeconds + VAEL_TUNING.riseSeconds - DT * 1.5,
    );
    expect(aura(vael, VAEL_SHADOWED)).toBeUndefined();
  });

  it('rises out of the pool behind his mark with the Reaping Scythe bar', () => {
    const { f, vael } = roof();
    sinking(f, vael);
    expect(until(f, () => vael.castingAbility === VAEL_REAPING_SCYTHE, 3)).toBe(true);
    const pool = poolOf(f) as Entity;
    expect(pool).toBeDefined();
    expect(Math.hypot(vael.pos.x - pool.pos.x, vael.pos.z - pool.pos.z)).toBeLessThan(0.2);
    expect(vael.castTotal).toBeCloseTo(VAEL_TUNING.riseSeconds, 5);
  });

  it('a mark who stepped out of the arc takes nothing', () => {
    const { f, vael } = roof();
    sinking(f, vael);
    expect(until(f, () => poolOf(f) !== undefined, 2)).toBe(true);
    const mark = f.others.find((p) => aura(p, VAEL_REAP_MARK)) as Entity;
    const pool = poolOf(f) as Entity;
    // Step well out ahead along the sweep's facing.
    const away = {
      x: pool.pos.x - f.ox + Math.sin(pool.facing) * (VAEL_TUNING.sweepRange + 4),
      z: pool.pos.z - f.oz + Math.cos(pool.facing) * (VAEL_TUNING.sweepRange + 4),
    };
    const from = f.hits.length;
    run(f, VAEL_TUNING.poolSeconds + VAEL_TUNING.riseSeconds + 0.3, () =>
      put(f, mark, away.x, away.z),
    );
    expect(took(f, mark, 'Reaping Scythe', from)).toBe(0);
  });

  it('heroic: the pool lingers as a Grave Shadow that burns, then dries', () => {
    const { f, vael } = roof('heroic');
    sinking(f, vael);
    expect(until(f, () => poolOf(f) !== undefined, 2)).toBe(true);
    const mark = f.others.find((p) => aura(p, VAEL_REAP_MARK)) as Entity;
    const pool = poolOf(f) as Entity;
    expect(until(f, () => pool.templateId === GRAVE_SHADOW_TEMPLATE, 3)).toBe(true);
    const at = { x: pool.pos.x - f.ox, z: pool.pos.z - f.oz };
    const from = f.hits.length;
    run(f, 2.1, () => put(f, mark, at.x, at.z));
    expect(took(f, mark, 'Grave Shadow', from)).toBeGreaterThan(0);
    run(f, VAEL_TUNING.graveSeconds);
    expect(f.sim.ctx.entities.has(pool.id)).toBe(false);
  });
});
