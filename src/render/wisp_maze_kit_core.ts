// The wisp maze's dressing plan (pure core, no Three/DOM): which piece of the
// Blender hedge kit (docs/design/wisp-maze/) stands in each wall cell of the
// trial and how it turns, where the entrance gates, corner lanterns and
// corridor flagstones go, and how each garden spirit hovers and which crest
// it wears. wisp_maze_visual.ts and wisp_maze_guardians.ts are the thin
// painters. Nothing here moves a wall: every hedge fills exactly the cell the
// sim's WISP_MAZE_LAYOUT marks '#', so collision and sight lines are the grid's.

/** The shipped kit (scripts/assets/wisp_maze/build.mjs). */
export const WISP_MAZE_KIT_URL = '/models/props/wisp_maze_kit.glb';
/** The cell size the kit is authored at; a layout of another pitch scales it. */
export const WISP_MAZE_KIT_CELL = 4;

export const WISP_MAZE_HEDGE_KINDS = [
  'Post',
  'End',
  'Straight',
  'Corner',
  'Tee',
  'Cross',
  'Gate',
] as const;
export type WispMazeHedgeKind = (typeof WISP_MAZE_HEDGE_KINDS)[number];

/** Neighbour bits of a wall cell: north is row - 1 (-Z), east is col + 1 (+X). */
export const WISP_MAZE_SIDE = { N: 1, E: 2, S: 4, W: 8 } as const;
const { N, E, S, W } = WISP_MAZE_SIDE;

/** The sides each piece's Blender source joins to a neighbour, unturned. */
const CANONICAL: Readonly<Record<Exclude<WispMazeHedgeKind, 'Gate'>, number>> = {
  Post: 0,
  End: W,
  Straight: E | W,
  Corner: E | S,
  Tee: E | S | W,
  Cross: N | E | S | W,
};

/**
 * Turn a side mask by `quarterTurns` quarter turns of rotation.y = +PI/2
 * each: one turn carries east to north, north to west, west to south and
 * south to east (three's +Y rotation, and Blender's +Z before export).
 */
export function turnSides(mask: number, quarterTurns: number): number {
  let m = mask & 15;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) m = (m >> 1) | ((m & 1) << 3);
  return m;
}

/** The piece and turn whose joined sides are exactly `mask`. */
export function wispMazeHedgePiece(mask: number): {
  kind: Exclude<WispMazeHedgeKind, 'Gate'>;
  quarterTurns: number;
} {
  for (const kind of Object.keys(CANONICAL) as Exclude<WispMazeHedgeKind, 'Gate'>[]) {
    for (let quarterTurns = 0; quarterTurns < 4; quarterTurns++) {
      if (turnSides(CANONICAL[kind], quarterTurns) === (mask & 15)) return { kind, quarterTurns };
    }
  }
  // Unreachable: the six canonical masks cover all sixteen under rotation.
  return { kind: 'Post', quarterTurns: 0 };
}

export interface WispMazeGrid {
  cols: number;
  rows: number;
  grid: readonly string[];
  spawnCell: number;
}

function isWall(layout: WispMazeGrid, row: number, col: number): boolean {
  // Beyond the grid is the open lawn: the outer shell shows its outer face.
  if (row < 0 || row >= layout.rows || col < 0 || col >= layout.cols) return false;
  return layout.grid[row][col] === '#';
}

/** Which of a cell's four neighbours are wall cells. */
export function wispMazeWallMask(layout: WispMazeGrid, cell: number): number {
  const row = Math.floor(cell / layout.cols);
  const col = cell % layout.cols;
  return (
    (isWall(layout, row - 1, col) ? N : 0) |
    (isWall(layout, row, col + 1) ? E : 0) |
    (isWall(layout, row, col - 1) ? W : 0) |
    (isWall(layout, row + 1, col) ? S : 0)
  );
}

/**
 * The entrance gates: the outer-shell cell straight past the player's spawn
 * (the way the trial is entered) and its mirror across the maze, each turned
 * so its closed gate faces the corridor inside. Only a straight run of shell
 * with an open cell behind it can carry a gate; anything else stays hedge.
 */
export function wispMazeGateCells(layout: WispMazeGrid): { cell: number; quarterTurns: number }[] {
  const row = Math.floor(layout.spawnCell / layout.cols);
  const col = layout.spawnCell % layout.cols;
  const reach = [
    { d: row, cell: col, inward: S },
    { d: layout.rows - 1 - row, cell: (layout.rows - 1) * layout.cols + col, inward: N },
    { d: col, cell: row * layout.cols, inward: E },
    { d: layout.cols - 1 - col, cell: row * layout.cols + layout.cols - 1, inward: W },
  ];
  const nearest = reach.reduce((best, next) => (next.d < best.d ? next : best));
  const mirror = reach[reach.indexOf(nearest) ^ 1];
  const out: { cell: number; quarterTurns: number }[] = [];
  for (const { cell, inward } of [nearest, mirror]) {
    const mask = wispMazeWallMask(layout, cell);
    const r = Math.floor(cell / layout.cols);
    const c = cell % layout.cols;
    const inner =
      inward === N
        ? [r - 1, c]
        : inward === S
          ? [r + 1, c]
          : inward === E
            ? [r, c + 1]
            : [r, c - 1];
    if (!isWall(layout, r, c) || isWall(layout, inner[0], inner[1])) continue;
    const run = inward === N || inward === S ? E | W : N | S;
    if (mask !== run) continue;
    // The Blender gate faces north unturned.
    let quarterTurns = 0;
    while (turnSides(N, quarterTurns) !== inward) quarterTurns++;
    out.push({ cell, quarterTurns });
  }
  return out;
}

export interface WispMazeHedgeSpot {
  cell: number;
  kind: WispMazeHedgeKind;
  quarterTurns: number;
}

/** Every wall cell's piece: exactly one per '#' cell, in cell order. */
export function planWispMazeHedges(layout: WispMazeGrid): WispMazeHedgeSpot[] {
  const gates = new Map(wispMazeGateCells(layout).map((gate) => [gate.cell, gate.quarterTurns]));
  const out: WispMazeHedgeSpot[] = [];
  for (let cell = 0; cell < layout.cols * layout.rows; cell++) {
    if (layout.grid[Math.floor(cell / layout.cols)][cell % layout.cols] !== '#') continue;
    const gate = gates.get(cell);
    out.push(
      gate === undefined
        ? { cell, ...wispMazeHedgePiece(wispMazeWallMask(layout, cell)) }
        : { cell, kind: 'Gate', quarterTurns: gate },
    );
  }
  return out;
}

/** How far past each outer corner a lantern post stands, in yards. */
export const WISP_MAZE_LANTERN_REACH = 1;

/**
 * One lantern post just past each outer corner of the maze, its lamp arm
 * turned toward the maze centre. Local to the site centre; rotationY is
 * three's rotation.y (the Blender post hangs its lamp north, unturned).
 */
export function wispMazeLanternSpots(
  layout: Pick<WispMazeGrid, 'cols' | 'rows'>,
  pitch: number,
): { x: number; z: number; rotationY: number }[] {
  const hx = (layout.cols * pitch) / 2 + WISP_MAZE_LANTERN_REACH;
  const hz = (layout.rows * pitch) / 2 + WISP_MAZE_LANTERN_REACH;
  const out: { x: number; z: number; rotationY: number }[] = [];
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) out.push({ x: sx * hx, z: sz * hz, rotationY: Math.atan2(sx, sz) });
  }
  return out;
}

/** A corridor cell's flagstone turn, so the one authored cell never repeats in step. */
export function wispMazeFlagstoneTurns(cell: number): number {
  return ((cell * 7) ^ (cell >> 2)) & 3;
}

export const WISP_GUARDIAN_CRESTS = ['Crest0', 'Crest1', 'Crest2', 'Crest3', 'Crest4'] as const;
/** The hard-profile guardian (the fifth) stands broader and taller. */
export function wispGuardianScale(index: number): number {
  return index === 4 ? 1.18 : 1;
}

/**
 * A spirit's drift: the hover it bobs on and a slow side-to-side sway, both
 * held still under reduced motion. Presentation only; the sim owns where it is.
 */
export function wispGuardianMotion(
  tick: number,
  index: number,
  reducedMotion: boolean,
  out: { hover: number; sway: number } = { hover: 0, sway: 0 },
): { hover: number; sway: number } {
  out.hover = reducedMotion ? 0.25 : 0.25 + Math.sin(tick * 0.16 + index * 1.7) * 0.08;
  out.sway = reducedMotion ? 0 : Math.sin(tick * 0.09 + index * 2.3) * 0.07;
  return out;
}
