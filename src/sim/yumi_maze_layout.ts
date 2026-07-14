// The Protect Yumi! maze, generated deterministically from a FIXED seed so the
// competitive map is identical every match and on every host (offline Sim,
// server, headless). The generator is a pure leaf: its only randomness is a
// LOCAL Rng seeded from the argument, never the sim's shared stream, and the
// result is memoized per seed, so building the layout draws nothing at all
// from a running world.
//
// Shape: a 13x13 cell grid (6.75yd pitch: 5.75yd clear corridors + 1yd walls),
// carved by an iterative recursive backtracker, then 180-degree symmetrized
// (union of openings, so neither team gets shorter routes), five plazas
// cleared (NW/SE team spawns, a 3x3 center, NE/SW Yumi starts), and every
// dead end braided open (plus its mirror) so each cell lies on a loop and no
// corridor is a trap. Closed wall segments are run-length merged into
// WallStub rects; sim/colliders.ts turns them into the instance-local OBB set
// shared by all match slots (the ARENA_COLLIDERS pattern).
// Sim layer: no three.js imports.
import type { Collider } from './colliders';
import type { WallStub } from './dungeon_layout';
import { Rng } from './rng';

// The fixed competitive map. Changing this constant is a map rotation: every
// host derives the same maze from it, nothing about it crosses the wire.
export const YUMI_MAZE_SEED = 0xca7f00d;

export const YUMI_MAZE_COLS = 13;
export const YUMI_MAZE_ROWS = 13;
export const YUMI_MAZE_PITCH = 6.75; // yd per cell (5.75 clear + 1 wall; the 1.5x playtest scale)
export const YUMI_MAZE_WALL_HALF = 0.5; // wall half thickness
/** Visual wall height (renderer reads this; movement/LoS ignore height). */
export const YUMI_MAZE_WALL_HEIGHT = 7.5;
/**
 * Minimum separation between the two Yumis' teleport destinations, in yards.
 * Per design they MAY land near each other (a brawl is welcome), they just
 * never overlap: one cell apart is the floor.
 */
export const YUMI_TELEPORT_MIN_SEP = 5;

export interface MazeCellRef {
  cx: number;
  cz: number;
}

export interface YumiMazeSpawn {
  x: number;
  z: number;
  facing: number;
}

export interface YumiMazeLayout {
  seed: number;
  cols: number;
  rows: number;
  pitch: number;
  wallHalf: number;
  /** Outer face of the shell walls (instance-local |x|,|z| extent). */
  halfExtent: number;
  /** Merged interior wall rects, instance-local, rot 0. */
  walls: WallStub[];
  /** The four outer shell slabs. */
  shell: WallStub[];
  /** Every cell, row-major (the whole braided maze is open and connected). */
  openCells: MazeCellRef[];
  /** Teleport destination candidates: openCells minus the two spawn plazas. */
  teleportCells: MazeCellRef[];
  /** Team A (blue) entry points in the NW plaza, facing the maze center. */
  spawnA: YumiMazeSpawn[];
  /** Team B (red) entry points in the SE plaza, facing the maze center. */
  spawnB: YumiMazeSpawn[];
  /** Team A's Yumi initial position (SW plaza center). */
  yumiStartA: { x: number; z: number };
  /** Team B's Yumi initial position (NE plaza center). */
  yumiStartB: { x: number; z: number };
  /** Open-wall adjacency: vOpen[vx][cz] = passage between (vx,cz) and (vx+1,cz). */
  vOpen: boolean[][];
  /** Open-wall adjacency: hOpen[cx][hz] = passage between (cx,hz) and (cx,hz+1). */
  hOpen: boolean[][];
}

const COLS = YUMI_MAZE_COLS;
const ROWS = YUMI_MAZE_ROWS;
const PITCH = YUMI_MAZE_PITCH;
const WALL_HALF = YUMI_MAZE_WALL_HALF;
const HALF_COLS = (COLS - 1) / 2; // 6: the center cell index
// Shell slab centerline sits half a wall beyond the outermost cell faces.
const SHELL_CENTER = (COLS * PITCH) / 2 + WALL_HALF;
const HALF_EXTENT = SHELL_CENTER + WALL_HALF;

// Cleared blocks (inclusive cell ranges). NW/SE are the team entry plazas,
// SW/NE the Yumi start plazas, the 3x3 center the midfield brawl room. The
// set is 180-degree symmetric by construction.
const PLAZAS = [
  { x0: 0, x1: 1, z0: 0, z1: 1 }, // NW: team A spawn
  { x0: 11, x1: 12, z0: 11, z1: 12 }, // SE: team B spawn
  { x0: 5, x1: 7, z0: 5, z1: 7 }, // center
  { x0: 11, x1: 12, z0: 0, z1: 1 }, // NE: Yumi B start
  { x0: 0, x1: 1, z0: 11, z1: 12 }, // SW: Yumi A start
] as const;
const SPAWN_PLAZAS = [PLAZAS[0], PLAZAS[1]] as const;

function cellCenterX(cx: number): number {
  return (cx - HALF_COLS) * PITCH;
}

export function mazeCellCenter(l: YumiMazeLayout, c: MazeCellRef): { x: number; z: number } {
  return { x: (c.cx - (l.cols - 1) / 2) * l.pitch, z: (c.cz - (l.rows - 1) / 2) * l.pitch };
}

/** Clamped inverse of mazeCellCenter (instance-local coords to cell). */
export function mazeCellAt(l: YumiMazeLayout, x: number, z: number): MazeCellRef {
  const cx = Math.min(l.cols - 1, Math.max(0, Math.round(x / l.pitch + (l.cols - 1) / 2)));
  const cz = Math.min(l.rows - 1, Math.max(0, Math.round(z / l.pitch + (l.rows - 1) / 2)));
  return { cx, cz };
}

function inPlaza(p: { x0: number; x1: number; z0: number; z1: number }, cx: number, cz: number) {
  return cx >= p.x0 && cx <= p.x1 && cz >= p.z0 && cz <= p.z1;
}

/**
 * Build the maze for a seed. Pure and deterministic: exported for tests; use
 * the memoized yumiMazeLayout() everywhere else.
 */
export function buildYumiMaze(seed: number): YumiMazeLayout {
  const rng = new Rng(seed);
  // vOpen[vx][cz]: passage between (vx,cz) and (vx+1,cz). hOpen[cx][hz]:
  // passage between (cx,hz) and (cx,hz+1). All closed to start.
  const vOpen: boolean[][] = [];
  for (let vx = 0; vx < COLS - 1; vx++) vOpen.push(new Array<boolean>(ROWS).fill(false));
  const hOpen: boolean[][] = [];
  for (let cx = 0; cx < COLS; cx++) hOpen.push(new Array<boolean>(ROWS - 1).fill(false));

  const openBetween = (ax: number, az: number, bx: number, bz: number) => {
    if (ax === bx) hOpen[ax][Math.min(az, bz)] = true;
    else vOpen[Math.min(ax, bx)][az] = true;
  };

  // 1) Iterative recursive backtracker: a perfect maze visiting every cell.
  const visited: boolean[][] = [];
  for (let cx = 0; cx < COLS; cx++) visited.push(new Array<boolean>(ROWS).fill(false));
  const stack: MazeCellRef[] = [{ cx: 0, cz: 0 }];
  visited[0][0] = true;
  const nbrs: MazeCellRef[] = [];
  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    nbrs.length = 0;
    if (cur.cz > 0 && !visited[cur.cx][cur.cz - 1]) nbrs.push({ cx: cur.cx, cz: cur.cz - 1 });
    if (cur.cx < COLS - 1 && !visited[cur.cx + 1][cur.cz])
      nbrs.push({ cx: cur.cx + 1, cz: cur.cz });
    if (cur.cz < ROWS - 1 && !visited[cur.cx][cur.cz + 1])
      nbrs.push({ cx: cur.cx, cz: cur.cz + 1 });
    if (cur.cx > 0 && !visited[cur.cx - 1][cur.cz]) nbrs.push({ cx: cur.cx - 1, cz: cur.cz });
    if (nbrs.length === 0) {
      stack.pop();
      continue;
    }
    const next = nbrs[rng.int(0, nbrs.length - 1)];
    openBetween(cur.cx, cur.cz, next.cx, next.cz);
    visited[next.cx][next.cz] = true;
    stack.push(next);
  }

  // 2) 180-degree symmetrize by UNION of openings: only removes walls, so
  // connectivity holds, and the rotated map is identical for both teams.
  for (let vx = 0; vx < COLS - 1; vx++) {
    for (let cz = 0; cz < ROWS; cz++) {
      const mvx = COLS - 2 - vx;
      const mcz = ROWS - 1 - cz;
      if (vOpen[vx][cz] || vOpen[mvx][mcz]) {
        vOpen[vx][cz] = true;
        vOpen[mvx][mcz] = true;
      }
    }
  }
  for (let cx = 0; cx < COLS; cx++) {
    for (let hz = 0; hz < ROWS - 1; hz++) {
      const mcx = COLS - 1 - cx;
      const mhz = ROWS - 2 - hz;
      if (hOpen[cx][hz] || hOpen[mcx][mhz]) {
        hOpen[cx][hz] = true;
        hOpen[mcx][mhz] = true;
      }
    }
  }

  // 3) Carve the plazas: open every wall strictly inside each block.
  for (const p of PLAZAS) {
    for (let cx = p.x0; cx <= p.x1; cx++) {
      for (let cz = p.z0; cz <= p.z1; cz++) {
        if (cx + 1 <= p.x1) vOpen[cx][cz] = true;
        if (cz + 1 <= p.z1) hOpen[cx][cz] = true;
      }
    }
  }

  const openSides = (cx: number, cz: number): number => {
    let n = 0;
    if (cx > 0 && vOpen[cx - 1][cz]) n++;
    if (cx < COLS - 1 && vOpen[cx][cz]) n++;
    if (cz > 0 && hOpen[cx][cz - 1]) n++;
    if (cz < ROWS - 1 && hOpen[cx][cz]) n++;
    return n;
  };

  // 4) Braid: every dead end opens one closed interior wall (rng pick) plus
  // its mirror. Opening walls never creates a dead end, so one row-major pass
  // leaves every cell with at least two exits (multiple routes everywhere).
  for (let cz = 0; cz < ROWS; cz++) {
    for (let cx = 0; cx < COLS; cx++) {
      if (openSides(cx, cz) > 1) continue;
      const closed: Array<{ v: boolean; a: number; b: number }> = [];
      if (cx > 0 && !vOpen[cx - 1][cz]) closed.push({ v: true, a: cx - 1, b: cz });
      if (cx < COLS - 1 && !vOpen[cx][cz]) closed.push({ v: true, a: cx, b: cz });
      if (cz > 0 && !hOpen[cx][cz - 1]) closed.push({ v: false, a: cx, b: cz - 1 });
      if (cz < ROWS - 1 && !hOpen[cx][cz]) closed.push({ v: false, a: cx, b: cz });
      if (closed.length === 0) continue;
      const w = closed[rng.int(0, closed.length - 1)];
      if (w.v) {
        vOpen[w.a][w.b] = true;
        vOpen[COLS - 2 - w.a][ROWS - 1 - w.b] = true;
      } else {
        hOpen[w.a][w.b] = true;
        hOpen[COLS - 1 - w.a][ROWS - 2 - w.b] = true;
      }
    }
  }

  // 5) Run-length merge the surviving closed walls into stub rects. The
  // WALL_HALF end extension seals the 1yd grid nodes where perpendicular
  // walls meet (overlapping OBBs are harmless).
  const walls: WallStub[] = [];
  for (let vx = 0; vx < COLS - 1; vx++) {
    const lineX = cellCenterX(vx) + PITCH / 2;
    let run = -1;
    for (let cz = 0; cz <= ROWS; cz++) {
      const closedHere = cz < ROWS && !vOpen[vx][cz];
      if (closedHere && run < 0) run = cz;
      if (!closedHere && run >= 0) {
        const len = cz - run;
        walls.push({
          x: lineX,
          z: ((run + cz - 1) / 2 - HALF_COLS) * PITCH,
          hw: WALL_HALF,
          hd: (len * PITCH) / 2 + WALL_HALF,
        });
        run = -1;
      }
    }
  }
  for (let hz = 0; hz < ROWS - 1; hz++) {
    const lineZ = cellCenterX(hz) + PITCH / 2;
    let run = -1;
    for (let cx = 0; cx <= COLS; cx++) {
      const closedHere = cx < COLS && !hOpen[cx][hz];
      if (closedHere && run < 0) run = cx;
      if (!closedHere && run >= 0) {
        const len = cx - run;
        walls.push({
          x: ((run + cx - 1) / 2 - HALF_COLS) * PITCH,
          z: lineZ,
          hw: (len * PITCH) / 2 + WALL_HALF,
          hd: WALL_HALF,
        });
        run = -1;
      }
    }
  }

  const shell: WallStub[] = [
    { x: 0, z: -SHELL_CENTER, hw: HALF_EXTENT, hd: WALL_HALF },
    { x: 0, z: SHELL_CENTER, hw: HALF_EXTENT, hd: WALL_HALF },
    { x: -SHELL_CENTER, z: 0, hw: WALL_HALF, hd: HALF_EXTENT },
    { x: SHELL_CENTER, z: 0, hw: WALL_HALF, hd: HALF_EXTENT },
  ];

  const openCells: MazeCellRef[] = [];
  const teleportCells: MazeCellRef[] = [];
  for (let cz = 0; cz < ROWS; cz++) {
    for (let cx = 0; cx < COLS; cx++) {
      const cell = { cx, cz };
      openCells.push(cell);
      if (!SPAWN_PLAZAS.some((p) => inPlaza(p, cx, cz))) teleportCells.push(cell);
    }
  }

  // Entry points: five per team, spread inside the 2x2 spawn plaza, all
  // facing the maze center (facing 0 looks toward +z, the arena convention).
  const spawnOffsets = [
    { x: 0, z: 0 },
    { x: -2, z: -2 },
    { x: 2, z: -2 },
    { x: -2, z: 2 },
    { x: 2, z: 2 },
  ];
  const plazaCenter = (p: { x0: number; x1: number; z0: number; z1: number }) => ({
    x: ((p.x0 + p.x1) / 2 - HALF_COLS) * PITCH,
    z: ((p.z0 + p.z1) / 2 - HALF_COLS) * PITCH,
  });
  const mkSpawns = (base: { x: number; z: number }): YumiMazeSpawn[] =>
    spawnOffsets.map((o) => {
      const x = base.x + o.x;
      const z = base.z + o.z;
      return { x, z, facing: Math.atan2(-x, -z) };
    });
  const nw = plazaCenter(PLAZAS[0]);
  const se = plazaCenter(PLAZAS[1]);

  return {
    seed,
    cols: COLS,
    rows: ROWS,
    pitch: PITCH,
    wallHalf: WALL_HALF,
    halfExtent: HALF_EXTENT,
    walls,
    shell,
    openCells,
    teleportCells,
    spawnA: mkSpawns(nw),
    spawnB: mkSpawns(se),
    yumiStartA: plazaCenter(PLAZAS[4]),
    yumiStartB: plazaCenter(PLAZAS[3]),
    vOpen,
    hOpen,
  };
}

const layoutCache = new Map<number, YumiMazeLayout>();
const colliderCache = new Map<number, Collider[]>();

/** The memoized maze layout (the fixed competitive map by default). */
export function yumiMazeLayout(seed: number = YUMI_MAZE_SEED): YumiMazeLayout {
  let l = layoutCache.get(seed);
  if (!l) {
    l = buildYumiMaze(seed);
    layoutCache.set(seed, l);
  }
  return l;
}

/**
 * Instance-local collision set (walls + shell as rot-0 OBBs), memoized and
 * shared by every match slot, the ARENA_COLLIDERS pattern.
 */
export function yumiMazeColliders(seed: number = YUMI_MAZE_SEED): Collider[] {
  let c = colliderCache.get(seed);
  if (!c) {
    const l = yumiMazeLayout(seed);
    c = [...l.shell, ...l.walls].map((w) => ({
      type: 'obb' as const,
      x: w.x,
      z: w.z,
      hw: w.hw,
      hd: w.hd,
      rot: 0,
    }));
    colliderCache.set(seed, c);
  }
  return c;
}

/**
 * Corridor distance between two cells in cells walked (BFS over open walls),
 * or Infinity if unreachable (never, once braided; the tests pin that).
 */
export function mazeCorridorDistance(l: YumiMazeLayout, a: MazeCellRef, b: MazeCellRef): number {
  if (a.cx === b.cx && a.cz === b.cz) return 0;
  const dist = new Map<number, number>();
  const key = (cx: number, cz: number) => cz * l.cols + cx;
  const queue: Array<{ cx: number; cz: number }> = [{ cx: a.cx, cz: a.cz }];
  dist.set(key(a.cx, a.cz), 0);
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const d = dist.get(key(cur.cx, cur.cz)) ?? 0;
    const step = (cx: number, cz: number, open: boolean) => {
      if (!open || dist.has(key(cx, cz))) return;
      dist.set(key(cx, cz), d + 1);
      queue.push({ cx, cz });
    };
    step(cur.cx - 1, cur.cz, cur.cx > 0 && l.vOpen[cur.cx - 1][cur.cz]);
    step(cur.cx + 1, cur.cz, cur.cx < l.cols - 1 && l.vOpen[cur.cx][cur.cz]);
    step(cur.cx, cur.cz - 1, cur.cz > 0 && l.hOpen[cur.cx][cur.cz - 1]);
    step(cur.cx, cur.cz + 1, cur.cz < l.rows - 1 && l.hOpen[cur.cx][cur.cz]);
    const found = dist.get(key(b.cx, b.cz));
    if (found !== undefined) return found;
  }
  return dist.get(key(b.cx, b.cz)) ?? Infinity;
}

/** Teleport candidate points as instance-local coordinates. */
export function teleportPoints(l: YumiMazeLayout): Array<{ x: number; z: number }> {
  return l.teleportCells.map((c) => mazeCellCenter(l, c));
}
