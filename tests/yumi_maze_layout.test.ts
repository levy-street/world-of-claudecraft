// Protect Yumi! maze layout invariants: determinism, connectivity, braiding,
// symmetry, walkability through the REAL band routing, and the band-edge
// predicates that keep the new easternmost instance band disjoint from the
// delve/arena/dungeon bands.

import { describe, expect, it } from 'vitest';
import { isBlocked, resolvePosition } from '../src/sim/colliders';
import {
  ARENA_X,
  DELVE_BAND_X_MIN,
  DELVE_X_MIN,
  dungeonAt,
  isArenaPos,
  isDelvePos,
  isYumiMazePos,
  YUMI_BAND_X_MAX,
  YUMI_BAND_X_MIN,
  YUMI_MAZE_SLOT_COUNT,
  YUMI_MAZE_X,
  yumiMazeOrigin,
  yumiMazeOriginAt,
} from '../src/sim/data';
import { groundHeight } from '../src/sim/world';
import {
  buildYumiMaze,
  mazeCellAt,
  mazeCellCenter,
  mazeCorridorDistance,
  teleportPoints,
  YUMI_MAZE_COLS,
  YUMI_MAZE_ROWS,
  YUMI_MAZE_SEED,
  YUMI_TELEPORT_MIN_SEP,
  yumiMazeColliders,
  yumiMazeLayout,
} from '../src/sim/yumi_maze_layout';

const WORLD_SEED = 42; // open-world seed; the maze band routing ignores it
const layout = yumiMazeLayout();

function openSides(cx: number, cz: number): number {
  let n = 0;
  if (cx > 0 && layout.vOpen[cx - 1][cz]) n++;
  if (cx < layout.cols - 1 && layout.vOpen[cx][cz]) n++;
  if (cz > 0 && layout.hOpen[cx][cz - 1]) n++;
  if (cz < layout.rows - 1 && layout.hOpen[cx][cz]) n++;
  return n;
}

describe('yumi maze generation', () => {
  it('is deterministic: same seed builds an identical maze', () => {
    const a = buildYumiMaze(YUMI_MAZE_SEED);
    const b = buildYumiMaze(YUMI_MAZE_SEED);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('different seeds build different wall sets', () => {
    const a = buildYumiMaze(YUMI_MAZE_SEED);
    const b = buildYumiMaze(YUMI_MAZE_SEED + 1);
    expect(a.walls).not.toEqual(b.walls);
  });

  it('memoizes the layout and collider set (same reference per call)', () => {
    expect(yumiMazeLayout()).toBe(layout);
    expect(yumiMazeColliders()).toBe(yumiMazeColliders());
  });

  it('every cell is reachable from both team spawns', () => {
    const a = mazeCellAt(layout, layout.spawnA[0].x, layout.spawnA[0].z);
    const b = mazeCellAt(layout, layout.spawnB[0].x, layout.spawnB[0].z);
    for (const cell of layout.openCells) {
      expect(Number.isFinite(mazeCorridorDistance(layout, a, cell))).toBe(true);
      expect(Number.isFinite(mazeCorridorDistance(layout, b, cell))).toBe(true);
    }
  });

  it('has zero dead ends: every cell keeps at least two exits', () => {
    for (let cz = 0; cz < layout.rows; cz++) {
      for (let cx = 0; cx < layout.cols; cx++) {
        expect(openSides(cx, cz), `cell ${cx},${cz}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('wall set is 180-degree rotationally symmetric (fair routes)', () => {
    const keys = new Set(
      layout.walls.map((w) => `${w.x.toFixed(2)},${w.z.toFixed(2)},${w.hw},${w.hd}`),
    );
    for (const w of layout.walls) {
      const mirrored = `${(-w.x).toFixed(2)},${(-w.z).toFixed(2)},${w.hw},${w.hd}`;
      expect(keys.has(mirrored), `mirror of wall at ${w.x},${w.z}`).toBe(true);
    }
  });

  it('teleport cells exclude the two team spawn plazas', () => {
    expect(layout.openCells).toHaveLength(YUMI_MAZE_COLS * YUMI_MAZE_ROWS);
    expect(layout.teleportCells).toHaveLength(YUMI_MAZE_COLS * YUMI_MAZE_ROWS - 8);
    for (const c of layout.teleportCells) {
      const inNw = c.cx <= 1 && c.cz <= 1;
      const inSe = c.cx >= layout.cols - 2 && c.cz >= layout.rows - 2;
      expect(inNw || inSe).toBe(false);
    }
  });

  it('every teleport cell has partners past the min separation', () => {
    const pts = teleportPoints(layout);
    for (let i = 0; i < pts.length; i++) {
      let partners = 0;
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue;
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
        if (d >= YUMI_TELEPORT_MIN_SEP) partners++;
      }
      expect(partners).toBeGreaterThanOrEqual(10);
    }
  });

  it('spawns are fair: long route between teams, symmetric objectives', () => {
    // The plaza centers sit on cell boundaries, so compare true mirror cells
    // (the 180-degree rotation image), not two independent roundings.
    const a = mazeCellAt(layout, layout.spawnA[0].x, layout.spawnA[0].z);
    const b = { cx: layout.cols - 1 - a.cx, cz: layout.rows - 1 - a.cz };
    expect(mazeCorridorDistance(layout, a, b)).toBeGreaterThanOrEqual(12);
    const center = { cx: (layout.cols - 1) / 2, cz: (layout.rows - 1) / 2 };
    expect(mazeCorridorDistance(layout, a, center)).toBe(mazeCorridorDistance(layout, b, center));
    const ya = mazeCellAt(layout, layout.yumiStartA.x, layout.yumiStartA.z);
    const yb = { cx: layout.cols - 1 - ya.cx, cz: layout.rows - 1 - ya.cz };
    expect(mazeCorridorDistance(layout, a, ya)).toBe(mazeCorridorDistance(layout, b, yb));
  });

  it('yumi starts sit in the NE/SW plazas, apart from both team spawns', () => {
    expect(layout.yumiStartA.x).toBeLessThan(0);
    expect(layout.yumiStartA.z).toBeGreaterThan(0);
    expect(layout.yumiStartB.x).toBeGreaterThan(0);
    expect(layout.yumiStartB.z).toBeLessThan(0);
    const d = Math.hypot(
      layout.yumiStartA.x - layout.yumiStartB.x,
      layout.yumiStartA.z - layout.yumiStartB.z,
    );
    expect(d).toBeGreaterThan(YUMI_TELEPORT_MIN_SEP);
  });

  it('keeps the collider budget', () => {
    expect(yumiMazeColliders().length).toBeLessThanOrEqual(120);
    expect(yumiMazeColliders().length).toBeGreaterThan(20);
  });
});

describe('yumi maze band routing', () => {
  it('teleport points are walkable through the real resolver, wide movers too', () => {
    const o = yumiMazeOrigin(0);
    for (const p of teleportPoints(layout)) {
      expect(isBlocked(WORLD_SEED, o.x + p.x, o.z + p.z, 0.5)).toBe(false);
      expect(isBlocked(WORLD_SEED, o.x + p.x, o.z + p.z, 0.8)).toBe(false);
    }
  });

  it('spawn points and yumi starts are walkable in every slot', () => {
    for (let slot = 0; slot < YUMI_MAZE_SLOT_COUNT; slot++) {
      const o = yumiMazeOrigin(slot);
      for (const s of [...layout.spawnA, ...layout.spawnB]) {
        expect(isBlocked(WORLD_SEED, o.x + s.x, o.z + s.z, 0.8)).toBe(false);
      }
      for (const y of [layout.yumiStartA, layout.yumiStartB]) {
        expect(isBlocked(WORLD_SEED, o.x + y.x, o.z + y.z, 0.8)).toBe(false);
      }
    }
  });

  it('walls actually block and push movers out', () => {
    const o = yumiMazeOrigin(0);
    const wall = layout.walls[0];
    expect(isBlocked(WORLD_SEED, o.x + wall.x, o.z + wall.z, 0.5)).toBe(true);
    const res = resolvePosition(WORLD_SEED, o.x + wall.x, o.z + wall.z, 0.5);
    const pushed = Math.hypot(res.x - (o.x + wall.x), res.z - (o.z + wall.z));
    expect(pushed).toBeGreaterThan(0);
    // The shell blocks too: the outer face never lets a mover through.
    expect(isBlocked(WORLD_SEED, o.x + layout.halfExtent - 0.2, o.z, 0.5)).toBe(true);
  });

  it('cell centers map back to their cells', () => {
    for (const cell of layout.openCells) {
      const p = mazeCellCenter(layout, cell);
      expect(mazeCellAt(layout, p.x, p.z)).toEqual({ cx: cell.cx, cz: cell.cz });
    }
  });
});

describe('yumi maze band edges', () => {
  it('band predicates are disjoint at the boundaries', () => {
    expect(isYumiMazePos(YUMI_MAZE_X)).toBe(true);
    expect(isYumiMazePos(YUMI_BAND_X_MIN)).toBe(true);
    expect(isYumiMazePos(YUMI_BAND_X_MIN - 1)).toBe(false);
    expect(isDelvePos(YUMI_MAZE_X)).toBe(false);
    expect(isDelvePos(YUMI_BAND_X_MIN)).toBe(false);
    expect(isDelvePos(YUMI_BAND_X_MIN - 1)).toBe(true);
    expect(isDelvePos(DELVE_X_MIN)).toBe(true);
    expect(isDelvePos(DELVE_BAND_X_MIN)).toBe(true);
    expect(isArenaPos(YUMI_MAZE_X)).toBe(false);
    expect(isArenaPos(ARENA_X)).toBe(true);
    expect(dungeonAt(YUMI_MAZE_X)).toBeNull();
    // Two-sided east cap: the Vale Cup practice pitches (x = 30000) must
    // never classify as the maze band.
    expect(isYumiMazePos(YUMI_BAND_X_MAX - 1)).toBe(true);
    expect(isYumiMazePos(YUMI_BAND_X_MAX)).toBe(false);
    expect(isYumiMazePos(30000)).toBe(false);
  });

  it('slot origins resolve back to their slots', () => {
    for (let slot = 0; slot < YUMI_MAZE_SLOT_COUNT; slot++) {
      const o = yumiMazeOrigin(slot);
      expect(o.x).toBe(YUMI_MAZE_X);
      const at = yumiMazeOriginAt(o.z + 3);
      expect(at.slot).toBe(slot);
      expect(at.z).toBe(o.z);
    }
  });

  it('the maze band has a flat floor', () => {
    const o = yumiMazeOrigin(0);
    const h0 = groundHeight(o.x, o.z, WORLD_SEED);
    expect(groundHeight(o.x + 15, o.z - 20, WORLD_SEED)).toBe(h0);
    expect(groundHeight(o.x - 25, o.z + 25, WORLD_SEED)).toBe(h0);
  });
});

describe('yumi maze: golden shape', () => {
  // The competitive map is a FIXED artifact: the structural invariants above
  // all keep holding through an accidental YUMI_MAZE_SEED edit, which would
  // silently rotate the "identical every match" map. Pin the seed and a
  // checksum of the derived geometry so a rotation is always a conscious,
  // test-updating change.
  it('pins the fixed seed and the derived wall geometry', () => {
    expect(YUMI_MAZE_SEED).toBe(0xca7f00d);
    let h = 2166136261;
    const mix = (v: number) => {
      h = Math.imul(h ^ Math.round(v * 8), 16777619);
    };
    for (const w of layout.walls) {
      mix(w.x);
      mix(w.z);
      mix(w.hw);
      mix(w.hd);
    }
    for (const c of layout.openCells) {
      mix(c.cx);
      mix(c.cz);
    }
    expect({ walls: layout.walls.length, open: layout.openCells.length, hash: h >>> 0 }).toEqual({
      walls: 44,
      open: 169,
      hash: 1115337129,
    });
  });
});
