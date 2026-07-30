// Unit + integration coverage for the deferred-projectile leaf (src/sim/projectile_travel.ts)
// and the end-to-end behavior it produces: a ranged spell's damage now lands when the
// homing bolt arrives, not on the cast tick, tracks a target that moves during flight,
// and fizzles if the target dies mid-flight.

import { describe, expect, it } from 'vitest';
import {
  advancePendingProjectiles,
  PROJECTILE_REACH,
  PROJECTILE_SPEED,
  scheduleProjectile,
  stepProjectile,
} from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const STEP = PROJECTILE_SPEED * DT; // yards a bolt covers per 20 Hz tick

describe('stepProjectile (pure homing math)', () => {
  it('advances exactly one step toward the target when out of reach', () => {
    const r = stepProjectile(0, 0, 0, 10, STEP);
    expect(r.hit).toBe(false);
    expect(r.x).toBeCloseTo(0, 10);
    expect(r.z).toBeCloseTo(STEP, 10);
  });

  it('moves along the straight line to an off-axis target', () => {
    const r = stepProjectile(0, 0, 3, 4, STEP); // 3-4-5 triangle, dist 5
    expect(r.hit).toBe(false);
    expect(r.x).toBeCloseTo((3 / 5) * STEP, 10);
    expect(r.z).toBeCloseTo((4 / 5) * STEP, 10);
  });

  it('reports a hit and snaps to the target once within reach (or one step)', () => {
    expect(stepProjectile(0, 0, 0, PROJECTILE_REACH / 2, STEP).hit).toBe(true);
    const onStep = stepProjectile(0, 0, 0, STEP, STEP);
    expect(onStep.hit).toBe(true);
    expect(onStep.x).toBe(0);
    expect(onStep.z).toBe(STEP); // snaps onto the target
  });

  it('is deterministic: same inputs, same output', () => {
    expect(stepProjectile(1, 2, 9, 7, STEP)).toEqual(stepProjectile(1, 2, 9, 7, STEP));
  });
});

// Minimal fake SimContext for the scheduling/advance integration: only the members the
// two functions touch (entities, pendingProjectiles). time is unused by the homing model
// but kept so the shape matches the real ctx.
function fakeCtx() {
  const entities = new Map<number, any>();
  return { time: 0, entities, pendingProjectiles: [] as any[] };
}

function ent(id: number, x: number, z: number): any {
  return { id, dead: false, pos: { x, y: 0, z } };
}

function advanceUntilLanded(ctx: any, landedRef: { n: number }, maxTicks = 200): number {
  for (let i = 1; i <= maxTicks; i++) {
    advancePendingProjectiles(ctx);
    if (landedRef.n > 0) return i;
    if (ctx.pendingProjectiles.length === 0) return -1; // fizzled
  }
  return -1;
}

describe('scheduleProjectile + advancePendingProjectiles', () => {
  it('resolves a projectile only once its homing flight has elapsed', () => {
    const ctx = fakeCtx();
    const src = ent(1, 0, 0);
    const tgt = ent(2, 0, 26); // 26 yd at 26 yd/s => ~1s of flight (~20 ticks)
    ctx.entities.set(1, src);
    ctx.entities.set(2, tgt);
    const landed = { n: 0 };
    scheduleProjectile(ctx as any, src, tgt, () => {
      landed.n++;
    });
    // Not there yet after a single tick.
    advancePendingProjectiles(ctx as any);
    expect(landed.n).toBe(0);
    expect(ctx.pendingProjectiles.length).toBe(1);

    const ticks = advanceUntilLanded(ctx, landed);
    expect(landed.n).toBe(1);
    expect(ctx.pendingProjectiles.length).toBe(0);
    // ~26 yd / 1.3 yd per tick is ~20 ticks (plus the first), never an instant hit.
    expect(ticks).toBeGreaterThan(15);
  });

  it('lands LATER against a target running away during flight', () => {
    const ctx = fakeCtx();
    const src = ent(1, 0, 0);
    const tgt = ent(2, 0, 18);
    ctx.entities.set(1, src);
    ctx.entities.set(2, tgt);
    const landed = { n: 0 };
    scheduleProjectile(ctx as any, src, tgt, () => {
      landed.n++;
    });
    // Target flees directly away at RUN_SPEED (7 yd/s) each tick until impact.
    let ticks = 0;
    for (let i = 1; i <= 200 && landed.n === 0 && ctx.pendingProjectiles.length; i++) {
      tgt.pos.z += 7 * DT;
      advancePendingProjectiles(ctx as any);
      ticks = i;
    }
    expect(landed.n).toBe(1);
    // 18 yd closing at (26 - 7) yd/s is ~0.95s, ~19 ticks: slower than the ~14 ticks a
    // fixed launch-distance schedule (18 / 26 = 0.69s) would have used.
    expect(ticks).toBeGreaterThan(14);
  });

  it('lands EARLIER against a target running toward the caster during flight', () => {
    const ctx = fakeCtx();
    const src = ent(1, 0, 0);
    const tgt = ent(2, 0, 26);
    ctx.entities.set(1, src);
    ctx.entities.set(2, tgt);
    const landed = { n: 0 };
    scheduleProjectile(ctx as any, src, tgt, () => {
      landed.n++;
    });
    let ticks = 0;
    for (let i = 1; i <= 200 && landed.n === 0 && ctx.pendingProjectiles.length; i++) {
      tgt.pos.z -= 7 * DT; // closing on the caster
      advancePendingProjectiles(ctx as any);
      ticks = i;
    }
    expect(landed.n).toBe(1);
    // 26 yd closing at (26 + 7) yd/s is ~0.79s, ~16 ticks: faster than the ~20 ticks a
    // fixed 26 / 26 = 1s launch schedule would have used.
    expect(ticks).toBeLessThan(19);
  });

  it('fizzles a projectile whose target died mid-flight (no resolve)', () => {
    const ctx = fakeCtx();
    const src = ent(1, 0, 0);
    const tgt = ent(2, 0, 26);
    ctx.entities.set(1, src);
    ctx.entities.set(2, tgt);
    const landed = { n: 0 };
    scheduleProjectile(ctx as any, src, tgt, () => {
      landed.n++;
    });
    tgt.dead = true; // dies before impact
    advancePendingProjectiles(ctx as any);
    expect(landed.n).toBe(0);
    expect(ctx.pendingProjectiles.length).toBe(0);
  });

  it('fizzles when the target despawned before impact', () => {
    const ctx = fakeCtx();
    const src = ent(1, 0, 0);
    const tgt = ent(2, 0, 26);
    ctx.entities.set(1, src);
    ctx.entities.set(2, tgt);
    const landed = { n: 0 };
    scheduleProjectile(ctx as any, src, tgt, () => {
      landed.n++;
    });
    ctx.entities.delete(2); // gone
    advancePendingProjectiles(ctx as any);
    expect(landed.n).toBe(0);
  });

  it('lands on a target that outruns the bolt: a released projectile cannot be escaped', () => {
    const ctx = fakeCtx();
    const src = ent(1, 0, 0);
    const tgt = ent(2, 0, 10);
    ctx.entities.set(1, src);
    ctx.entities.set(2, tgt);
    const landed = { n: 0 };
    scheduleProjectile(ctx as any, src, tgt, () => {
      landed.n++;
    });
    // Target flees faster than the bolt: it can never be physically caught, but a
    // released projectile is guaranteed to land, so it resolves at the flight deadline
    // instead of fizzling. The only way to avoid it is to be out of cast range when it
    // fires (gated at the call sites), not to outrun it after launch.
    for (let i = 1; i <= 200 && ctx.pendingProjectiles.length; i++) {
      tgt.pos.z += (PROJECTILE_SPEED + 5) * DT;
      advancePendingProjectiles(ctx as any);
    }
    expect(landed.n).toBe(1);
    expect(ctx.pendingProjectiles.length).toBe(0);
  });
});

// End-to-end: drive a real Sim and assert a mage Ice Lance (an INSTANT projectile
// spell, so no cast-time pushback to muddy the timing) deals NO damage on the tick it
// is cast and SOME damage a few ticks later, when the bolt actually lands.
// (The mage rework made Fire Blast spec-gated AND `projectile: false`, biting the
// moment it is pressed, so Ice Lance is now the kit's instant projectile.)
function place(sim: Sim, e: any, x: number, z: number) {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

describe('deferred projectile damage end-to-end (mage Ice Lance)', () => {
  function castLanceAndTrack(seed: number) {
    const sim = new Sim({ seed, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    // Ice Lance is Frost-spec kit: commit the spec so the ability is known.
    expect(sim.setSpec('frost')).toBe(true);
    const p = sim.player;
    p.hp = p.maxHp;
    p.resource = p.maxResource;
    let target: any = null;
    for (const e of (sim as any).entities.values()) {
      if (e.kind === 'mob' && !e.dead) {
        target = e;
        break;
      }
    }
    expect(target).toBeTruthy();
    place(sim, p, p.pos.x, p.pos.z);
    place(sim, target, p.pos.x, p.pos.z + 18); // ~18 yd => ~14 ticks of homing flight
    target.hp = target.maxHp = 100000; // a fat dummy: one bolt can't kill it
    p.facing = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
    sim.player.targetId = target.id;

    const startHp = target.hp;
    (sim as any).castAbility('ice_lance'); // instant: schedules the bolt this tick

    let hpOneTickLater = startHp;
    let landedAtTick = -1;
    for (let i = 0; i < 20 * 3; i++) {
      sim.tick();
      if (i === 0) hpOneTickLater = target.hp; // still in flight one tick after the cast
      if (target.hp < startHp && landedAtTick < 0) landedAtTick = i;
    }
    return { startHp, hpOneTickLater, finalHp: target.hp, landedAtTick };
  }

  it('does not apply damage the instant it is cast, but lands it a few ticks later', () => {
    const r = castLanceAndTrack(7);
    // The bolt is still in flight one tick after the cast: no damage yet.
    expect(r.hpOneTickLater).toBe(r.startHp);
    // It lands within the flight window and deals real damage.
    expect(r.finalHp).toBeLessThan(r.startHp);
    // ~18 yd at 26 yd/s is ~14 ticks of flight, not an instant (tick 0) hit.
    expect(r.landedAtTick).toBeGreaterThan(2);
  });

  it('is deterministic: same seed, same landing and damage', () => {
    const a = castLanceAndTrack(7);
    const b = castLanceAndTrack(7);
    expect(a).toEqual(b);
  });
});
