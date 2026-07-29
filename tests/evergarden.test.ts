// The Evergarden: zone registration, and the Great Maze contract. The maze
// hedges are MODELED walls over flat lawn (world.ts GARDEN_MAZE owns the
// grid; movement blocks on its piece boxes and garden_features.ts draws the
// same cells), so these tests are what keeps an edit to the grid honest:
// the corridors must stay walkable, the walls must stay impassable, and the
// entrance must still reach the Fountain Court and the north exit.

import { describe, expect, it } from 'vitest';
import { resolveMovement } from '../src/sim/colliders';
import {
  EVERGARDEN_CAMPS,
  EVERGARDEN_KNIGHT_CAMPS,
  EVERGARDEN_PROPS,
  EVERGARDEN_ROADS,
  EVERGARDEN_ZONE,
} from '../src/sim/content/evergarden';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import {
  crossesGardenHedge,
  GARDEN_MAZE_GRID,
  gardenMazeCellPieces,
  inGardenMaze,
  inGardenMazeWall,
  MAZE_CELL,
  MAZE_COLS,
  MAZE_ROWS,
  MAZE_WALL_DEPTH,
  MAZE_X0,
  MAZE_Z1,
  terrainHeight,
  WATER_LEVEL,
} from '../src/sim/world';

const SEED = 1337; // matches the fixed client seed in src/main.ts

// Cell (col, row) center in world coordinates. Row 0 is the NORTH row.
function cellCenter(c: number, r: number): { x: number; z: number } {
  return {
    x: MAZE_X0 + c * MAZE_CELL + MAZE_CELL / 2,
    z: MAZE_Z1 - r * MAZE_CELL - MAZE_CELL / 2,
  };
}

describe('Evergarden zone registration', () => {
  it('keeps its hub, graveyard, and camps on dry, in-zone ground', () => {
    const { hub, graveyard } = EVERGARDEN_ZONE;
    expect(hub.z).toBeGreaterThan(EVERGARDEN_ZONE.zMin);
    expect(hub.z).toBeLessThan(EVERGARDEN_ZONE.zMax);
    expect(terrainHeight(hub.x, hub.z, SEED)).toBeGreaterThan(WATER_LEVEL);
    expect(terrainHeight(graveyard.x, graveyard.z, SEED)).toBeGreaterThan(WATER_LEVEL);
    for (const camp of EVERGARDEN_CAMPS) {
      expect(terrainHeight(camp.center.x, camp.center.z, SEED)).toBeGreaterThan(WATER_LEVEL);
    }
  });

  it('keeps every road on dry ground along its whole length', () => {
    for (const road of EVERGARDEN_ROADS) {
      for (let i = 0; i < road.length - 1; i++) {
        const a = road[i];
        const b = road[i + 1];
        const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps;
          const z = a.z + ((b.z - a.z) * k) / steps;
          expect(
            terrainHeight(x, z, SEED),
            `road ${Math.round(x)},${Math.round(z)}`,
          ).toBeGreaterThan(WATER_LEVEL);
        }
      }
    }
  });

  it('keeps roads, camps (except the court), and props out of the maze', () => {
    for (const road of EVERGARDEN_ROADS) {
      for (const p of road) expect(inGardenMaze(p.x, p.z), `road ${p.x},${p.z}`).toBe(false);
    }
    for (const camp of EVERGARDEN_CAMPS) {
      if (camp.mobId === 'the_topiary_bull') continue; // the court's keeper
      expect(inGardenMaze(camp.center.x, camp.center.z), camp.mobId).toBe(false);
    }
    for (const t of EVERGARDEN_PROPS.greatTrees ?? []) {
      expect(inGardenMaze(t.x, t.z), `tree ${t.x},${t.z}`).toBe(false);
      // dry footing too: a wet spot would strand an invisible trunk collider
      expect(terrainHeight(t.x, t.z, SEED), `tree ${t.x},${t.z}`).toBeGreaterThan(WATER_LEVEL);
    }
  });
});

describe('the Great Maze', () => {
  it('has a well-formed grid', () => {
    expect(GARDEN_MAZE_GRID.length).toBe(MAZE_ROWS);
    for (const row of GARDEN_MAZE_GRID) {
      expect(row.length).toBe(MAZE_COLS);
      expect(/^[#.]+$/.test(row)).toBe(true);
    }
  });

  it('is solvable: the entrance reaches the Fountain Court and the north exit', () => {
    // Full BFS flood over open cells from the south entrance (last row's
    // gap): the court, the exit, and in fact EVERY corridor cell must be
    // reachable, so no grid edit can strand a pocket of unreachable lawn.
    const entranceCol = GARDEN_MAZE_GRID[MAZE_ROWS - 1].indexOf('.');
    const exitCol = GARDEN_MAZE_GRID[0].indexOf('.');
    expect(entranceCol).toBeGreaterThanOrEqual(0);
    expect(exitCol).toBeGreaterThanOrEqual(0);
    const court = { c: 7, r: 8 }; // the open 3x3 center
    expect(GARDEN_MAZE_GRID[court.r][court.c]).toBe('.');
    const seen = new Set<string>([`${entranceCol},${MAZE_ROWS - 1}`]);
    const queue = [{ c: entranceCol, r: MAZE_ROWS - 1 }];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (!cur) break;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const c = cur.c + dc;
        const r = cur.r + dr;
        if (c < 0 || c >= MAZE_COLS || r < 0 || r >= MAZE_ROWS) continue;
        if (GARDEN_MAZE_GRID[r][c] !== '.') continue;
        const key = `${c},${r}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ c, r });
      }
    }
    expect(seen.has(`${court.c},${court.r}`), 'court reachable').toBe(true);
    expect(seen.has(`${exitCol},0`), 'exit reachable').toBe(true);
    let openCells = 0;
    for (const row of GARDEN_MAZE_GRID) for (const ch of row) if (ch === '.') openCells++;
    expect(seen.size, 'every corridor cell reachable').toBe(openCells);
  });

  it('covers every wall cell with hedge pieces and keeps every corridor open', () => {
    // The modeled-wall contract: every wall cell carries at least one piece
    // and its center is blocked ground; every corridor cell center is open;
    // and along a wall RUN the pieces join seamlessly (the shared-edge
    // midpoint of two run neighbors is still blocked, so no gap a player
    // could slip through mid-run).
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        const center = cellCenter(c, r);
        const pieces = gardenMazeCellPieces(c, r);
        if (GARDEN_MAZE_GRID[r][c] === '#') {
          expect(pieces, `wall ${c},${r} has pieces`).not.toBeNull();
          expect(pieces && (pieces.h || pieces.v), `wall ${c},${r} carries a piece`).toBe(true);
          expect(inGardenMazeWall(center.x, center.z), `wall ${c},${r} blocks`).toBe(true);
          for (const [dc, dr] of [
            [1, 0],
            [0, 1],
          ]) {
            const oc = c + dc;
            const or = r + dr;
            if (oc >= MAZE_COLS || or >= MAZE_ROWS) continue;
            if (GARDEN_MAZE_GRID[or][oc] !== '#') continue;
            const other = cellCenter(oc, or);
            const mid = { x: (center.x + other.x) / 2, z: (center.z + other.z) / 2 };
            expect(inGardenMazeWall(mid.x, mid.z), `seam between ${c},${r} and ${oc},${or}`).toBe(
              true,
            );
          }
        } else {
          expect(pieces, `corridor ${c},${r}`).toBeNull();
          expect(inGardenMazeWall(center.x, center.z), `corridor ${c},${r} open`).toBe(false);
        }
      }
    }
  });

  it('blocks the straight crossing from every corridor into its wall neighbors', () => {
    // The modeled hedges are the barrier now, not terrain: the segment from
    // a corridor center to an adjacent wall center must cross blocked
    // ground (crossesGardenHedge is exactly what resolveMovement consults).
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        if (GARDEN_MAZE_GRID[r][c] !== '#') continue;
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const oc = c + dc;
          const or = r + dr;
          if (oc < 0 || oc >= MAZE_COLS || or < 0 || or >= MAZE_ROWS) continue;
          if (GARDEN_MAZE_GRID[or][oc] !== '.') continue;
          const from = cellCenter(oc, or);
          const to = cellCenter(c, r);
          expect(
            crossesGardenHedge(from.x, from.z, to.x, to.z),
            `wall ${c},${r} from ${oc},${or}`,
          ).toBe(true);
        }
      }
    }
  });

  it('lays the maze over flat lawn: no terrain wall remains', () => {
    // The old terrain hedges are gone: a wall cell's ground is the same
    // lawn as its corridor neighbors, so the modeled pieces meet the grass
    // with no raised plinth and no leftover unclimbable mound.
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        if (GARDEN_MAZE_GRID[r][c] !== '#') continue;
        const center = cellCenter(c, r);
        const hWall = terrainHeight(center.x, center.z, SEED);
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const oc = c + dc;
          const or = r + dr;
          if (oc < 0 || oc >= MAZE_COLS || or < 0 || or >= MAZE_ROWS) continue;
          if (GARDEN_MAZE_GRID[or][oc] !== '.') continue;
          const other = cellCenter(oc, or);
          const hOpen = terrainHeight(other.x, other.z, SEED);
          expect(Math.abs(hWall - hOpen), `wall ${c},${r} vs corridor ${oc},${or}`).toBeLessThan(2);
        }
      }
    }
  });

  it('keeps corridors flat across their full width', () => {
    // The modeled walls live inside the wall cells, so the walkable lane is
    // the whole 9yd corridor cell, not a narrow center strip.
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        if (GARDEN_MAZE_GRID[r][c] !== '.') continue;
        const center = cellCenter(c, r);
        const hCenter = terrainHeight(center.x, center.z, SEED);
        for (const [ox, oz] of [
          [MAZE_CELL / 2 - 1, 0],
          [-(MAZE_CELL / 2 - 1), 0],
          [0, MAZE_CELL / 2 - 1],
          [0, -(MAZE_CELL / 2 - 1)],
        ]) {
          const h = terrainHeight(center.x + ox, center.z + oz, SEED);
          expect(Math.abs(h - hCenter), `corridor ${c},${r} edge ${ox},${oz}`).toBeLessThan(2);
        }
      }
    }
  });

  it('keeps corridor centers flat enough to walk', () => {
    // Along every open cell center, the local slope to its open neighbors
    // stays under the climb gate, so the labyrinth is fully traversable.
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        if (GARDEN_MAZE_GRID[r][c] !== '.') continue;
        const here = cellCenter(c, r);
        const hHere = terrainHeight(here.x, here.z, SEED);
        for (const [dc, dr] of [
          [1, 0],
          [0, 1],
        ]) {
          const oc = c + dc;
          const or = r + dr;
          if (oc >= MAZE_COLS || or >= MAZE_ROWS) continue;
          if (GARDEN_MAZE_GRID[or][oc] !== '.') continue;
          const there = cellCenter(oc, or);
          const hThere = terrainHeight(there.x, there.z, SEED);
          const slope = Math.abs(hThere - hHere) / MAZE_CELL;
          expect(slope, `corridor ${c},${r} -> ${oc},${or}`).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
        }
      }
    }
  });
});

describe('the hedge walls are hard colliders', () => {
  // Find an interior wall cell with open corridor on both its east and west
  // sides, and prove movement cannot cross it, straight or diagonal. The
  // slope gate is not what stops it (a shallow diagonal defeats slope);
  // resolveMovement's hedge wall check is.
  function findCrossableWall(): { c: number; r: number } {
    for (let r = 1; r < MAZE_ROWS - 1; r++) {
      for (let c = 1; c < MAZE_COLS - 1; c++) {
        if (GARDEN_MAZE_GRID[r][c] !== '#') continue;
        if (GARDEN_MAZE_GRID[r][c - 1] === '.' && GARDEN_MAZE_GRID[r][c + 1] === '.') {
          return { c, r };
        }
      }
    }
    throw new Error('no wall with corridors on both sides');
  }

  it('blocks walking straight through a hedge', () => {
    const wall = findCrossableWall();
    const from = cellCenter(wall.c - 1, wall.r);
    const to = cellCenter(wall.c + 1, wall.r);
    const end = resolveMovement(SEED, from.x, from.z, to.x, to.z, 0.5);
    // never inside the hedge, and never on the far side: the mover stops at
    // the piece's west face (the wall box is centered in its cell)
    expect(inGardenMazeWall(end.x, end.z)).toBe(false);
    const face = MAZE_X0 + wall.c * MAZE_CELL + (MAZE_CELL - MAZE_WALL_DEPTH) / 2;
    expect(end.x).toBeLessThan(face + 0.3);
  });

  it('blocks the diagonal cheese over a hedge', () => {
    const wall = findCrossableWall();
    const from = cellCenter(wall.c - 1, wall.r);
    // a long shallow diagonal aimed across the wall
    const to = { x: from.x + MAZE_CELL * 2, z: from.z + 3 };
    let x = from.x;
    let z = from.z;
    // push repeatedly, as a player holding a diagonal key would
    for (let i = 0; i < 40; i++) {
      const step = resolveMovement(SEED, x, z, to.x, to.z, 0.5);
      x = step.x;
      z = step.z;
    }
    expect(inGardenMazeWall(x, z)).toBe(false);
    const face = MAZE_X0 + wall.c * MAZE_CELL + (MAZE_CELL - MAZE_WALL_DEPTH) / 2;
    expect(x, 'slid along the hedge, never across it').toBeLessThan(face + 0.3);
  });

  it('lets movement flow freely along a corridor', () => {
    // control: the same mover walks the entrance corridor unimpeded
    const entranceCol = GARDEN_MAZE_GRID[MAZE_ROWS - 1].indexOf('.');
    const from = cellCenter(entranceCol, MAZE_ROWS - 1);
    const to = cellCenter(entranceCol, MAZE_ROWS - 3);
    const end = resolveMovement(SEED, from.x, from.z, to.x, to.z, 0.5);
    expect(Math.hypot(end.x - to.x, end.z - to.z)).toBeLessThan(1);
  });
});

describe('the maze patrol', () => {
  it('posts each patrol knight in a dead-end corridor, leashed to its cell', () => {
    const patrols = EVERGARDEN_KNIGHT_CAMPS.filter((c) => inGardenMaze(c.center.x, c.center.z));
    expect(patrols.length).toBeGreaterThanOrEqual(2);
    expect(patrols.length).toBeLessThanOrEqual(3);
    for (const camp of patrols) {
      const c = Math.floor((camp.center.x - MAZE_X0) / MAZE_CELL);
      const r = Math.floor((MAZE_Z1 - camp.center.z) / MAZE_CELL);
      expect(GARDEN_MAZE_GRID[r][c], `camp (${camp.center.x},${camp.center.z}) corridor`).toBe('.');
      const openNeighbors = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].filter(([dc, dr]) => GARDEN_MAZE_GRID[r + dr]?.[c + dc] === '.').length;
      expect(openNeighbors, `camp (${camp.center.x},${camp.center.z}) dead end`).toBe(1);
      expect(camp.radius, 'leash stays inside the corridor').toBeLessThanOrEqual(3);
      expect(camp.count).toBe(1);
    }
  });

  it('keeps the patrol out of the hedges while it paces', () => {
    // the live sim: the knights idle-wander their dead ends for 30 seconds
    // and must never stand inside a wall piece (moveToward consults
    // crossesGardenHedge, the same barrier players hit)
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const entities = (
      sim as unknown as {
        entities: Map<number, { templateId?: string; pos: { x: number; z: number } }>;
      }
    ).entities;
    const knights = [...entities.values()].filter(
      (e) => e.templateId === 'hedge_knight' && inGardenMaze(e.pos.x, e.pos.z),
    );
    expect(knights.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 20 * 30; i++) {
      sim.tick();
      if (i % 20 === 0) {
        for (const k of knights) {
          expect(
            inGardenMazeWall(k.pos.x, k.pos.z),
            `knight in a hedge at (${k.pos.x.toFixed(1)},${k.pos.z.toFixed(1)}) t${i}`,
          ).toBe(false);
        }
      }
    }
  });
});
