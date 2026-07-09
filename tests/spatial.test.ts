import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SpatialGrid } from '../src/sim/spatial';
import { dist2d, Entity } from '../src/sim/types';

function bruteForceInRadius(sim: Sim, x: number, z: number, radius: number): Set<number> {
  const out = new Set<number>();
  for (const e of sim.entities.values()) {
    if (dist2d({ x, y: 0, z }, e.pos) <= radius) out.add(e.id);
  }
  return out;
}

function gridInRadius(grid: SpatialGrid, x: number, z: number, radius: number): Set<number> {
  const out = new Set<number>();
  grid.forEachInRadius(x, z, radius, (e) => out.add(e.id));
  return out;
}

describe('spatial grid', () => {
  it('radius queries match a brute-force scan across the whole world', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior' });
    // let mobs wander off their spawn points and the grid re-bucket them
    for (let i = 0; i < 200; i++) sim.tick();

    const probes: Array<[number, number, number]> = [];
    for (let z = -1200; z <= 1200; z += 150) {
      probes.push([60, z, 120], [200, z, 25], [350, z, 8]);
    }
    probes.push([900, 0, 120]); // dungeon strip
    for (const [x, z, r] of probes) {
      expect(gridInRadius(sim.grid, x, z, r)).toEqual(bruteForceInRadius(sim, x, z, r));
    }
  });

  it('keeps the roster exact on spawn and despawn without a tick', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('mage', 'Gridtest');
    const p = sim.entities.get(pid)!;
    expect(gridInRadius(sim.grid, p.pos.x, p.pos.z, 5).has(pid)).toBe(true);
    expect(gridInRadius(sim.playerGrid, p.pos.x, p.pos.z, 5).has(pid)).toBe(true);
    sim.removePlayer(pid);
    expect(gridInRadius(sim.grid, p.pos.x, p.pos.z, 5).has(pid)).toBe(false);
    expect(gridInRadius(sim.playerGrid, p.pos.x, p.pos.z, 5).has(pid)).toBe(false);
  });

  it('re-buckets teleported entities immediately', () => {
    const grid = new SpatialGrid();
    const e = { id: 1, pos: { x: 0, y: 0, z: 0 } } as Entity;
    grid.insert(e);
    e.pos.x = 500;
    e.pos.z = -700;
    grid.update(e);
    expect(gridInRadius(grid, 500, -700, 2).has(1)).toBe(true);
    expect(gridInRadius(grid, 0, 0, 2).has(1)).toBe(false);
  });

  it('player combat flag matches per-player scan semantics', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior' });
    const p = sim.entities.get(sim.primaryId)!;
    // Park the player right next to the nearest hostile camp mob and let it
    // aggro, rather than wandering forward from spawn (which can walk straight
    // into the minigame-hub portal and teleport away before finding a camp).
    // The invariant under test is that p.inCombat tracks a real aggro from the
    // end-of-tick engagedPids scan, not the spawn-area navigation path.
    let target: Entity | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !e.dead && e.hostile) {
        const d = dist2d(p.pos, e.pos);
        if (d < best) {
          best = d;
          target = e;
        }
      }
    }
    expect(target, 'expected at least one hostile camp mob in the world').toBeTruthy();
    p.pos = { x: target!.pos.x + 1, y: target!.pos.y, z: target!.pos.z + 1 };
    p.prevPos = { ...p.pos };
    let aggroed = false;
    for (let i = 0; i < 400 && !aggroed; i++) {
      sim.tick();
      for (const e of sim.entities.values()) {
        if (
          e.kind === 'mob' &&
          !e.dead &&
          (e.aiState === 'chase' || e.aiState === 'attack') &&
          e.aggroTargetId === p.id
        ) {
          aggroed = true;
        }
      }
    }
    expect(aggroed).toBe(true);
    expect(p.inCombat).toBe(true);
  });
});
