// Unit tests for src/sim/mob/reachability.ts: the unreachable-target stall
// detector behind the classic evade trigger. Pure-module tests with a stub
// SimContext so each accumulate/reset condition is pinned in isolation; the
// full Sim path (rift wall pin, walk home, heal to full) lives in
// tests/mob_unreachable_evade.test.ts.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import {
  blockedTowardTarget,
  CHASE_STALL_TIMEOUT,
  chaseStalledUnreachable,
} from '../src/sim/mob/reachability';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity } from '../src/sim/types';

// Stub seam: `blocked` makes resolveMovePoint eat the whole step (the mob's own
// position comes back at the blocked origin), `rooted` drives isRooted,
// `canSwim` drives the deep-water arm, `seed` feeds the terrain functions (the
// world-arm tests pin live-world coordinates).
function makeCtx({ blocked = false, rooted = false, canSwim = true, seed = 1 } = {}): SimContext {
  return {
    cfg: { seed },
    mobCanSwim: () => canSwim,
    isRooted: () => rooted,
    resolveMovePoint: (nx: number, nz: number) => (blocked ? { x: 0, z: 0 } : { x: nx, z: nz }),
  } as unknown as SimContext;
}

function makeMob(x = 0, z = 0): Entity {
  return {
    pos: { x, y: 0, z },
    prevPos: { x, y: 0, z },
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
const SPEED = 3.5;
// The live world seed (matches tests/evade_immunity.test.ts).
const WORLD_SEED = 20061;

describe('chaseStalledUnreachable', () => {
  it('accumulates while pinned and triggers after CHASE_STALL_TIMEOUT seconds', () => {
    const ctx = makeCtx({ blocked: true });
    const mob = makeMob();
    const target = farTarget();
    const ticksToTimeout = Math.round(CHASE_STALL_TIMEOUT / DT);

    for (let i = 0; i < ticksToTimeout - 1; i++) {
      expect(chaseStalledUnreachable(ctx, mob, target, REACH, SPEED)).toBe(false);
    }
    expect(mob.chaseStall).toBeGreaterThan(0);

    // float accumulation may land the threshold on this call or the next
    const fired =
      chaseStalledUnreachable(ctx, mob, target, REACH, SPEED) ||
      chaseStalledUnreachable(ctx, mob, target, REACH, SPEED);
    expect(fired).toBe(true);
  });

  it('re-arms after triggering: the accumulator restarts from zero', () => {
    const ctx = makeCtx({ blocked: true });
    const mob = makeMob();
    const target = farTarget();

    let fired = 0;
    for (let i = 0; i < Math.round(CHASE_STALL_TIMEOUT / DT) + 2; i++) {
      if (chaseStalledUnreachable(ctx, mob, target, REACH, SPEED)) fired++;
    }
    expect(fired).toBe(1);
    expect(mob.chaseStall).toBeLessThan(CHASE_STALL_TIMEOUT / 2);
  });

  it('resets when the target is within reach', () => {
    const ctx = makeCtx({ blocked: true });
    const mob = makeMob();
    mob.chaseStall = 3;
    const near = { pos: { x: 4, y: 0, z: 0 } } as unknown as Entity;

    expect(chaseStalledUnreachable(ctx, mob, near, REACH, SPEED)).toBe(false);
    expect(mob.chaseStall).toBe(0);
  });

  it('resets when the mob moved this tick', () => {
    const ctx = makeCtx({ blocked: true });
    const mob = makeMob();
    mob.chaseStall = 3;
    mob.prevPos = { x: -0.5, y: 0, z: 0 };

    expect(chaseStalledUnreachable(ctx, mob, farTarget(), REACH, SPEED)).toBe(false);
    expect(mob.chaseStall).toBe(0);
  });

  it('resets when the ground ahead is open (a stationary tick is not a stall)', () => {
    const ctx = makeCtx({ blocked: false });
    const mob = makeMob();
    mob.chaseStall = 3;

    expect(chaseStalledUnreachable(ctx, mob, farTarget(), REACH, SPEED)).toBe(false);
    expect(mob.chaseStall).toBe(0);
  });

  it('holds (neither grows nor resets) while rooted', () => {
    const ctx = makeCtx({ blocked: true, rooted: true });
    const mob = makeMob();
    mob.chaseStall = 3;

    for (let i = 0; i < 40; i++) {
      expect(chaseStalledUnreachable(ctx, mob, farTarget(), REACH, SPEED)).toBe(false);
    }
    expect(mob.chaseStall).toBe(3);
  });
});

describe('blockedTowardTarget', () => {
  it('reports blocked when a collider eats most of the intended step', () => {
    const ctx = makeCtx({ blocked: true });
    expect(blockedTowardTarget(ctx, makeMob(), { x: 20, y: 0, z: 0 }, SPEED)).toBe(true);
  });

  it('reports clear when the step resolves unobstructed', () => {
    const ctx = makeCtx({ blocked: false });
    expect(blockedTowardTarget(ctx, makeMob(), { x: 20, y: 0, z: 0 }, SPEED)).toBe(false);
  });

  it('treats a zero-length step as clear (guard against on-top-of-target and zero speed)', () => {
    const ctx = makeCtx({ blocked: true });
    const mob = makeMob();
    expect(blockedTowardTarget(ctx, mob, { x: 0, y: 0, z: 0 }, SPEED)).toBe(false);
    expect(blockedTowardTarget(ctx, mob, { x: 20, y: 0, z: 0 }, 0)).toBe(false);
  });
});

// The two terrain block modes mirror moveToward against the REAL world
// functions, so each is pinned at a live-world coordinate found by scanning
// seed 20061: the rim wall band for the steep gate, the Great Maze for the
// hedge, a lake for deep water. Colliders resolve clear (identity stub), so
// only the world arm under test can report blocked.
describe('blockedTowardTarget: world block modes (pinned live-world coordinates)', () => {
  it('an unclimbable steep face ahead reads as blocked', () => {
    const ctx = makeCtx({ blocked: false, seed: WORLD_SEED });
    // rim wall band, uphill to the east (re-scanned after the natural-relief
    // rim teeth moved the steep bands a few yards off the old pin)
    const mob = makeMob(-1490, 180);
    expect(blockedTowardTarget(ctx, mob, { x: -1470, y: 0, z: 180 }, SPEED)).toBe(true);
  });

  it('a Great Maze hedge crossing reads as blocked', () => {
    const ctx = makeCtx({ blocked: false, seed: WORLD_SEED });
    const mob = makeMob(294, 944); // maze hedge immediately to the east
    expect(blockedTowardTarget(ctx, mob, { x: 314, y: 0, z: 944 }, SPEED)).toBe(true);
  });

  it('deep water ahead blocks a non-swimmer and not a swimmer', () => {
    const dest = { x: -532, y: 0, z: 1254 };
    const mob = makeMob(-552.1, 1254); // lake edge, deep water to the east
    const landlocked = makeCtx({ blocked: false, canSwim: false, seed: WORLD_SEED });
    expect(blockedTowardTarget(landlocked, mob, dest, SPEED)).toBe(true);
    const swimmer = makeCtx({ blocked: false, canSwim: true, seed: WORLD_SEED });
    expect(blockedTowardTarget(swimmer, mob, dest, SPEED)).toBe(false);
  });
});

describe('phasesThroughObstacles mobs are exempt', () => {
  it('never accumulates or triggers, even fully pinned', () => {
    const entry = Object.entries(MOBS).find(([, t]) => t.phasesThroughObstacles);
    if (!entry) throw new Error('no phasesThroughObstacles template in content');
    const ctx = makeCtx({ blocked: true });
    const mob = makeMob();
    mob.templateId = entry[0];

    for (let i = 0; i < Math.round(CHASE_STALL_TIMEOUT / DT) + 10; i++) {
      expect(chaseStalledUnreachable(ctx, mob, farTarget(), REACH, SPEED)).toBe(false);
    }
    expect(mob.chaseStall).toBe(0);
  });
});
