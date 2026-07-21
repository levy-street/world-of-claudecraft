import { describe, expect, it } from 'vitest';
import { isBlocked, pathCrossesFence, resolveMovement, resolvePosition } from '../src/sim/colliders';
import { Sim } from '../src/sim/sim';
import { findPath, findPlayerPath, PLAYER_SWIM_DEPTH, resolvePlayerDestination } from '../src/sim/pathfind';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';
import { PROPS } from '../src/sim/data';

describe('player pathfinding', () => {
  it('smooths open-grid A* stair steps into one direct movement leg', () => {
    const from = { x: 1000, z: 1000 };
    const to = { x: 1008, z: 1005 };

    const path = findPath(from, to, {
      seed: 20061,
      bodyRadius: 0,
      maxClimbSlope: Infinity,
      minGround: -Infinity,
      maxSpan: 128,
      ignoreFences: true,
    });

    expect(path).toEqual([to]);
  });

  it('routes around static blockers instead of walking straight through them', () => {
    const seed = 20061;
    const from = { x: -4, z: 2 };
    const to = { x: 4, z: 2 };
    const path = findPlayerPath(seed, from, to);

    expect(isBlocked(seed, 0, 2)).toBe(true);
    expect(path.length).toBeGreaterThan(1);
    expect(path.some((p) => Math.abs(p.z - 2) > 0.5)).toBe(true);
    expect(path[path.length - 1]).toEqual(to);
  });

  it('resolves click destinations inside buildings to the nearest walkable outside point', () => {
    const seed = 20061;
    const target = resolvePlayerDestination(seed, { x: 10, z: 12 });

    expect(isBlocked(seed, 10, 12)).toBe(true);
    expect(isBlocked(seed, target.x, target.z)).toBe(false);
    expect(Math.hypot(target.x - 10, target.z - 12)).toBeGreaterThan(0.5);
    expect(Math.hypot(target.x - 10, target.z - 12)).toBeLessThan(6);
  });

  it('snaps a water click to shore for walkers but keeps it for swimmers', () => {
    const seed = 20061;
    const water = { x: -108, z: 84 }; // deep lake cell on this seed (ground -8.5)
    const deepThreshold = WATER_LEVEL - PLAYER_SWIM_DEPTH;
    expect(groundHeight(water.x, water.z, seed)).toBeLessThan(deepThreshold);

    // Default (walker): shoved out of the water to the nearest dry/wadeable cell.
    const walked = resolvePlayerDestination(seed, water);
    expect(groundHeight(walked.x, walked.z, seed)).toBeGreaterThanOrEqual(deepThreshold);
    expect(Math.hypot(walked.x - water.x, walked.z - water.z)).toBeGreaterThan(0.5);

    // Swimmer: the click lands where you clicked, still over deep water.
    const swum = resolvePlayerDestination(seed, water, true);
    expect(Math.hypot(swum.x - water.x, swum.z - water.z)).toBeLessThan(0.5);
    expect(groundHeight(swum.x, swum.z, seed)).toBeLessThan(deepThreshold);
  });

  it('routes a swimming player into deep water instead of stopping at the bank', () => {
    const seed = 20061;
    const from = { x: -120, z: 85 }; // land beside the lake
    const water = { x: -108, z: 84 }; // deep lake cell
    const deepThreshold = WATER_LEVEL - PLAYER_SWIM_DEPTH;

    const path = findPlayerPath(seed, from, water, 128, true, true);
    const end = path[path.length - 1];
    expect(end).toEqual(water);
    // The route actually finishes in the water, not snapped short onto the shore.
    expect(groundHeight(end.x, end.z, seed)).toBeLessThan(deepThreshold);
  });

  it('treats fence runs as movement blockers', () => {
    const seed = 20061;
    expect(isBlocked(seed, 19, 10)).toBe(true);

    const from = { x: 13, z: 7 };
    const to = { x: 25, z: 13 };
    const path = findPlayerPath(seed, from, to);

    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual(to);
  });

  it('routes over a fence when the mover can jump it (click-to-move)', () => {
    const seed = 20061;
    const from = { x: 13, z: 7 };
    const to = { x: 25, z: 13 };

    const anySegmentCrossesFence = (path: { x: number; z: number }[]) => {
      let prev = from;
      for (const p of path) {
        if (pathCrossesFence(prev.x, prev.z, p.x, p.z)) return true;
        prev = p;
      }
      return false;
    };

    // ignoreFences off → must detour around the fence (no segment crosses it)
    expect(anySegmentCrossesFence(findPlayerPath(seed, from, to, 128, false))).toBe(false);
    // ignoreFences on (what click-to-move uses) → routes straight over it
    expect(anySegmentCrossesFence(findPlayerPath(seed, from, to, 128, true))).toBe(true);
  });

  it('blocks normal player movement through fences', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior' });
    const p = sim.player;
    const fence = { x1: 16, z1: 16, x2: 22, z2: 4 };
    const mx = (fence.x1 + fence.x2) / 2;
    const mz = (fence.z1 + fence.z2) / 2;
    const dx = fence.x2 - fence.x1;
    const dz = fence.z2 - fence.z1;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;

    p.pos.x = mx - nx * 3;
    p.pos.z = mz - nz * 3;
    p.pos.y = groundHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    p.facing = Math.atan2(nx, nz);
    sim.moveInput.forward = true;

    for (let i = 0; i < 40; i++) sim.tick();

    const side = (p.pos.x - mx) * nx + (p.pos.z - mz) * nz;
    expect(side).toBeLessThan(-0.5);
  });

  it('lets a jumping player clear a fence', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior' });
    const p = sim.player;
    const fence = { x1: 16, z1: 16, x2: 22, z2: 4 };
    const mx = (fence.x1 + fence.x2) / 2;
    const mz = (fence.z1 + fence.z2) / 2;
    const dx = fence.x2 - fence.x1;
    const dz = fence.z2 - fence.z1;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;

    // jump from close to the fence: the jump's arc tops the rail, so forward
    // momentum carries the player across even though they start below it
    p.pos.x = mx - nx * 1.5;
    p.pos.z = mz - nz * 1.5;
    p.pos.y = groundHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    p.facing = Math.atan2(nx, nz);
    sim.moveInput.forward = true;
    sim.moveInput.jump = true;

    for (let i = 0; i < 40; i++) sim.tick();

    const side = (p.pos.x - mx) * nx + (p.pos.z - mz) * nz;
    expect(side).toBeGreaterThan(0.5);
  });

  it('sweeps movement segments so a long step cannot tunnel through a fence', () => {
    const seed = 20061;
    const fence = { x1: 16, z1: 16, x2: 22, z2: 4 };
    const mx = (fence.x1 + fence.x2) / 2;
    const mz = (fence.z1 + fence.z2) / 2;
    const dx = fence.x2 - fence.x1;
    const dz = fence.z2 - fence.z1;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    const from = { x: mx - nx * 3, z: mz - nz * 3 };
    const to = { x: mx + nx * 3, z: mz + nz * 3 };

    const resolved = resolveMovement(seed, from.x, from.z, to.x, to.z, 0.5);
    const side = (resolved.x - mx) * nx + (resolved.z - mz) * nz;
    expect(side).toBeLessThan(-0.5);
  });

  it('lets the player stand close to the fence face without crossing it', () => {
    const seed = 20061;
    const fence = { x1: 16, z1: 16, x2: 22, z2: 4 };
    const mx = (fence.x1 + fence.x2) / 2;
    const mz = (fence.z1 + fence.z2) / 2;
    const dx = fence.x2 - fence.x1;
    const dz = fence.z2 - fence.z1;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    const nearFence = { x: mx - nx * 0.95, z: mz - nz * 0.95 };

    const resolved = resolvePosition(seed, nearFence.x, nearFence.z, 0.5);
    const side = (resolved.x - mx) * nx + (resolved.z - mz) * nz;
    expect(side).toBeGreaterThan(-1.05);
    expect(side).toBeLessThan(-0.7);
  });

  it('blocks crossing every authored fence run', () => {
    const seed = 20061;
    for (const fence of PROPS.fences) {
      const mx = (fence.x1 + fence.x2) / 2;
      const mz = (fence.z1 + fence.z2) / 2;
      const dx = fence.x2 - fence.x1;
      const dz = fence.z2 - fence.z1;
      const len = Math.hypot(dx, dz);
      const nx = -dz / len;
      const nz = dx / len;
      const from = { x: mx - nx * 3, z: mz - nz * 3 };
      const to = { x: mx + nx * 3, z: mz + nz * 3 };

      const resolved = resolveMovement(seed, from.x, from.z, to.x, to.z, 0.5);
      const side = (resolved.x - mx) * nx + (resolved.z - mz) * nz;
      expect(side, `fence ${fence.x1},${fence.z1} -> ${fence.x2},${fence.z2}`).toBeLessThan(-0.5);
    }
  });
});
