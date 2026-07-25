import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SpatialGrid } from '../src/sim/spatial';
import { dist2d, type Entity } from '../src/sim/types';

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

  it('reclaims an emptied cell instead of leaking it forever', () => {
    // remove() used to leave a stale empty array behind in `cells` whenever
    // the last occupant of a cell moved out, so a long-lived process
    // accumulated one dead Map entry per distinct cell any entity ever
    // vacated. Simulate an entity wandering through many distinct cells (as
    // happens over hours of real movement) and assert the tracked cell count
    // stays at the true occupied count (1) instead of growing with the
    // number of moves.
    const grid = new SpatialGrid();
    const e = { id: 1, pos: { x: 0, y: 0, z: 0 } } as Entity;
    grid.insert(e);
    for (let i = 1; i <= 500; i++) {
      e.pos.x = i * 40; // 40 > cellSize (32), so every step crosses a cell boundary
      grid.update(e);
    }
    expect(grid.cellCount()).toBe(1);
  });

  it('player combat flag matches per-player scan semantics', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior' });
    const p = sim.entities.get(sim.primaryId)!;
    // walk the player into a camp until something aggroes
    let aggroed = false;
    for (let i = 0; i < 4000 && !aggroed; i++) {
      const meta = sim.players.get(sim.primaryId)!;
      meta.moveInput.forward = true;
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
