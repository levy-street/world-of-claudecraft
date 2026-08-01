// Unit tests for src/sim/mob/reachability.ts: the unreachable-target stall
// detector behind the classic evade trigger. Pure-module tests with a stub
// SimContext so each accumulate/reset condition is pinned in isolation; the
// full Sim path (rift wall pin, walk home, heal to full) lives in
// tests/mob_unreachable_evade.test.ts.
import { describe, expect, it } from 'vitest';
import {
  blockedTowardTarget,
  CHASE_STALL_TIMEOUT,
  chaseStalledUnreachable,
} from '../src/sim/mob/reachability';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity } from '../src/sim/types';

// Stub seam: `blocked` makes resolveMovePoint eat the whole step (the mob's own
// position comes back), `rooted` drives isRooted. mobCanSwim true keeps the
// water clause out of these unit tests.
function makeCtx({ blocked = false, rooted = false } = {}): SimContext {
  return {
    cfg: { seed: 1 },
    mobCanSwim: () => true,
    isRooted: () => rooted,
    resolveMovePoint: (nx: number, nz: number) => (blocked ? { x: 0, z: 0 } : { x: nx, z: nz }),
  } as unknown as SimContext;
}

function makeMob(): Entity {
  return {
    pos: { x: 0, y: 0, z: 0 },
    prevPos: { x: 0, y: 0, z: 0 },
    moveSpeed: 3.5,
    templateId: 'forest_wolf',
    chaseStall: 0,
  } as unknown as Entity;
}

// 20yd away with reach 5: engaged but far out of range.
function farTarget(): Entity {
  return { pos: { x: 20, y: 0, z: 0 } } as unknown as Entity;
}

const REACH = 5;

describe('chaseStalledUnreachable', () => {
  it('accumulates while pinned and triggers after CHASE_STALL_TIMEOUT seconds', () => {
    const ctx = makeCtx({ blocked: true });
    const mob = makeMob();
    const target = farTarget();
    const ticksToTimeout = Math.round(CHASE_STALL_TIMEOUT / DT);

    for (let i = 0; i < ticksToTimeout - 1; i++) {
      expect(chaseStalledUnreachable(ctx, mob, target, REACH)).toBe(false);
    }
    expect(mob.chaseStall).toBeGreaterThan(0);

    // float accumulation may land the threshold on this call or the next
    const fired =
      chaseStalledUnreachable(ctx, mob, target, REACH) ||
      chaseStalledUnreachable(ctx, mob, target, REACH);
    expect(fired).toBe(true);
  });

  it('re-arms after triggering: the accumulator restarts from zero', () => {
    const ctx = makeCtx({ blocked: true });
    const mob = makeMob();
    const target = farTarget();

    let fired = 0;
    for (let i = 0; i < Math.round(CHASE_STALL_TIMEOUT / DT) + 2; i++) {
      if (chaseStalledUnreachable(ctx, mob, target, REACH)) fired++;
    }
    expect(fired).toBe(1);
    expect(mob.chaseStall).toBeLessThan(CHASE_STALL_TIMEOUT / 2);
  });

  it('resets when the target is within reach', () => {
    const ctx = makeCtx({ blocked: true });
    const mob = makeMob();
    mob.chaseStall = 3;
    const near = { pos: { x: 4, y: 0, z: 0 } } as unknown as Entity;

    expect(chaseStalledUnreachable(ctx, mob, near, REACH)).toBe(false);
    expect(mob.chaseStall).toBe(0);
  });

  it('resets when the mob moved this tick', () => {
    const ctx = makeCtx({ blocked: true });
    const mob = makeMob();
    mob.chaseStall = 3;
    mob.prevPos = { x: -0.5, y: 0, z: 0 };

    expect(chaseStalledUnreachable(ctx, mob, farTarget(), REACH)).toBe(false);
    expect(mob.chaseStall).toBe(0);
  });

  it('resets when the ground ahead is open (a stationary tick is not a stall)', () => {
    const ctx = makeCtx({ blocked: false });
    const mob = makeMob();
    mob.chaseStall = 3;

    expect(chaseStalledUnreachable(ctx, mob, farTarget(), REACH)).toBe(false);
    expect(mob.chaseStall).toBe(0);
  });

  it('holds (neither grows nor resets) while rooted', () => {
    const ctx = makeCtx({ blocked: true, rooted: true });
    const mob = makeMob();
    mob.chaseStall = 3;

    for (let i = 0; i < 40; i++) {
      expect(chaseStalledUnreachable(ctx, mob, farTarget(), REACH)).toBe(false);
    }
    expect(mob.chaseStall).toBe(3);
  });
});

describe('blockedTowardTarget', () => {
  it('reports blocked when a collider eats most of the intended step', () => {
    const ctx = makeCtx({ blocked: true });
    expect(blockedTowardTarget(ctx, makeMob(), { x: 20, y: 0, z: 0 })).toBe(true);
  });

  it('reports clear when the step resolves unobstructed', () => {
    const ctx = makeCtx({ blocked: false });
    expect(blockedTowardTarget(ctx, makeMob(), { x: 20, y: 0, z: 0 })).toBe(false);
  });

  it('treats a zero-length step as clear (guard against on-top-of-target and zero speed)', () => {
    const ctx = makeCtx({ blocked: true });
    const mob = makeMob();
    expect(blockedTowardTarget(ctx, mob, { x: 0, y: 0, z: 0 })).toBe(false);

    mob.moveSpeed = 0;
    expect(blockedTowardTarget(ctx, mob, { x: 20, y: 0, z: 0 })).toBe(false);
  });
});
