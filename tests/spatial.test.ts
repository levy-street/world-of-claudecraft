import { describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { SpatialGrid } from '../src/sim/spatial';
import { dist2d, type Entity } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

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

function insertDistantEntities(grid: SpatialGrid, count: number, firstId = 100): void {
  for (let offset = 0; offset < count; offset++) {
    grid.insert({
      id: firstId + offset,
      pos: { x: 1_000 + offset * 40, y: 0, z: 1_000 },
    } as Entity);
  }
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
      const bruteForce = bruteForceInRadius(sim, x, z, r);
      expect(gridInRadius(sim.grid, x, z, r)).toEqual(bruteForce);
      expect(sim.grid.hasInRadius(x, z, r)).toBe(bruteForce.size > 0);
    }
  });

  it('keeps inclusive boundaries and one-unit stale-cell drift exact', () => {
    for (const fillerCount of [0, 32]) {
      const boundaryGrid = new SpatialGrid();
      const boundary = { id: 1, pos: { x: 3, y: 0, z: 4 } } as Entity;
      boundaryGrid.insert(boundary);
      insertDistantEntities(boundaryGrid, fillerCount);
      expect(boundaryGrid.hasInRadius(0, 0, 5)).toBe(true);
      boundary.pos.z = 4.0001;
      expect(boundaryGrid.hasInRadius(0, 0, 5)).toBe(false);
    }

    const drifts = [
      { id: 2, storedX: 31.5, currentX: 32.25, queryX: 64.1 },
      { id: 3, storedX: -31.5, currentX: -32.25, queryX: -64.1 },
    ];
    for (const drift of drifts) {
      const grid = new SpatialGrid();
      const entity = { id: drift.id, pos: { x: drift.storedX, y: 0, z: 0 } } as Entity;
      grid.insert(entity);
      insertDistantEntities(grid, 32);
      entity.pos.x = drift.currentX;
      expect(grid.hasInRadius(drift.queryX, 0, 31.9)).toBe(true);
    }
  });

  it('stops an existence query after the first matching entity', () => {
    for (const fillerCount of [0, 31]) {
      const grid = new SpatialGrid();
      const first = { id: 1, pos: { x: 0, y: 0, z: 0 } } as Entity;
      const unread = { id: 2, pos: { x: 1, y: 0, z: 0 } } as Entity;
      grid.insert(first);
      grid.insert(unread);
      insertDistantEntities(grid, fillerCount);
      Object.defineProperty(unread, 'pos', {
        configurable: true,
        get() {
          throw new Error('query did not stop after its first match');
        },
      });

      expect(grid.hasInRadius(0, 0, 5)).toBe(true);
    }
  });

  it('limits direct entity walks to small grids before switching to cell lookups', () => {
    type InspectableGrid = { cells: Map<number, Entity[]> };

    const atLinearCap = new SpatialGrid();
    insertDistantEntities(atLinearCap, 32);
    const capCells = (atLinearCap as unknown as InspectableGrid).cells;
    const capCellLookup = vi.spyOn(capCells, 'get');

    expect(atLinearCap.hasInRadius(0, 0, 100)).toBe(false);
    expect(capCellLookup).not.toHaveBeenCalled();

    const large = new SpatialGrid();
    for (let id = 1; id <= 33; id++) {
      large.insert({ id, pos: { x: 500 + id, y: 0, z: 0 } } as Entity);
    }
    const largeCells = (large as unknown as InspectableGrid).cells;
    const largeCellLookup = vi.spyOn(largeCells, 'get');

    expect(large.hasInRadius(0, 0, 100)).toBe(false);
    expect(largeCellLookup).toHaveBeenCalled();

    const atCellWindowSize = new SpatialGrid();
    insertDistantEntities(atCellWindowSize, 1);
    const windowCells = (atCellWindowSize as unknown as InspectableGrid).cells;
    const windowCellLookup = vi.spyOn(windowCells, 'get');

    expect(atCellWindowSize.hasInRadius(16, 16, 1)).toBe(false);
    expect(windowCellLookup).not.toHaveBeenCalled();

    const overCellWindowSize = new SpatialGrid();
    insertDistantEntities(overCellWindowSize, 2);
    const overWindowCells = (overCellWindowSize as unknown as InspectableGrid).cells;
    const overWindowCellLookup = vi.spyOn(overWindowCells, 'get');

    expect(overCellWindowSize.hasInRadius(16, 16, 1)).toBe(false);
    expect(overWindowCellLookup).toHaveBeenCalled();
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
    // Stage the pull in the collider-free open-field lane rather than walking a fixed
    // heading out of the spawn hoping to reach a camp: that route depends on whatever
    // the authored world puts on the heading (it now wedges the player against a fence
    // 27 yards north, so nothing ever aggroes). The mob's own aggro scan still makes
    // the pull, which is what the per-player combat flag is being checked against.
    placePlayerInOpenField(sim);
    const wolf = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 5,
    });
    wolf.hostile = true;
    sim.addEntity(wolf);
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
