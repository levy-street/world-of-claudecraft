// src/sim/forced_move_step.ts: the step gate warrior Charge and /follow share
// (moved whole out of Sim.updateChargeMovement / updateFollowMovement). These
// pin each arm on the shipped world: deep water blocks, open flat ground does
// not, an unclimbable rise blocks, and /follow's `gateTinySteps` arm lets a
// sub-1e-5 step through a rise that a Charge step of the same length is
// refused on.

import { describe, expect, it } from 'vitest';
import { PLAYER_START } from '../src/sim/data';
import { forcedMoveGroundHeight } from '../src/sim/forced_move_ground';
import { forcedStepBlocked } from '../src/sim/forced_move_step';
import { PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import type { Vec3 } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;

function standing(x: number, z: number): Vec3 {
  return { x, y: groundHeight(x, z, SEED), z };
}

/** First grid point (coarse sweep) whose ground sits in deep water. */
function findDeepWater(): { x: number; z: number } {
  for (let x = -1500; x <= 1500; x += 25) {
    for (let z = -1500; z <= 1500; z += 25) {
      if (groundHeight(x, z, SEED) < waterLevelAt(x, z, SEED) - PLAYER_SWIM_DEPTH - 1) {
        return { x, z };
      }
    }
  }
  throw new Error('no deep water on the shipped world');
}

/** A short dry step whose rise is far past the climb limit, nowhere near water. */
function findCliffStep(): { from: Vec3; nx: number; nz: number; step: number } {
  const step = 0.5;
  for (let x = -1500; x <= 1500; x += 10) {
    for (let z = -1500; z <= 1500; z += 10) {
      const h0 = groundHeight(x, z, SEED);
      if (h0 < waterLevelAt(x, z, SEED) + 2) continue;
      const nx = x + step;
      const h1 = groundHeight(nx, z, SEED);
      if ((h1 - h0) / step > PLAYER_MAX_CLIMB_SLOPE * 2) {
        return { from: { x, y: h0, z }, nx, nz: z, step };
      }
    }
  }
  throw new Error('no cliff on the shipped world');
}

describe('forcedStepBlocked', () => {
  it('blocks a step into deep water on either mover arm', () => {
    const w = findDeepWater();
    const from = standing(w.x - 0.5, w.z);
    expect(forcedStepBlocked(SEED, from, w.x, w.z, 0.5, false)).toBe(true);
    expect(forcedStepBlocked(SEED, from, w.x, w.z, 0.5, true)).toBe(true);
  });

  it('lets a short step across the flat player start through', () => {
    const from = standing(PLAYER_START.x, PLAYER_START.z);
    const nx = PLAYER_START.x + 0.35;
    expect(forcedStepBlocked(SEED, from, nx, PLAYER_START.z, 0.35, false)).toBe(false);
    expect(forcedStepBlocked(SEED, from, nx, PLAYER_START.z, 0.35, true)).toBe(false);
  });

  it('blocks an unclimbable rise for Charge and /follow alike', () => {
    const c = findCliffStep();
    // The same surface the gate samples on the built-in world.
    expect(forcedMoveGroundHeight(c.nx, c.nz, SEED, c.from.y)).toBeGreaterThan(c.from.y);
    expect(forcedStepBlocked(SEED, c.from, c.nx, c.nz, c.step, false)).toBe(true);
    expect(forcedStepBlocked(SEED, c.from, c.nx, c.nz, c.step, true)).toBe(true);
  });

  it('only /follow ignores the rise on a sub-1e-5 step', () => {
    const c = findCliffStep();
    expect(forcedStepBlocked(SEED, c.from, c.nx, c.nz, 1e-6, false)).toBe(true);
    expect(forcedStepBlocked(SEED, c.from, c.nx, c.nz, 1e-6, true)).toBe(false);
  });
});
