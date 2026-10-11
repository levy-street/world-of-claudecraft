import { describe, expect, it } from 'vitest';
import { WISP_MAZE_WALL_CELLS } from '../src/render/wisp_maze_core';
import {
  planWispMazeHedges,
  turnSides,
  WISP_GUARDIAN_CRESTS,
  WISP_MAZE_LANTERN_REACH,
  WISP_MAZE_SIDE,
  wispGuardianMotion,
  wispGuardianScale,
  wispMazeFlagstoneTurns,
  wispMazeGateCells,
  wispMazeHedgePiece,
  wispMazeLanternSpots,
  wispMazeWallMask,
} from '../src/render/wisp_maze_kit_core';
import { WISP_MAZE_LAYOUT } from '../src/sim/minigames/wisp_maze';

const { N, E, S, W } = WISP_MAZE_SIDE;
const cellOf = (row: number, col: number) => row * WISP_MAZE_LAYOUT.cols + col;

describe('wisp maze kit core: hedge piece per wall cell', () => {
  it('turns sides the way three turns rotation.y by +PI/2 (east to north)', () => {
    expect(turnSides(E, 1)).toBe(N);
    expect(turnSides(N, 1)).toBe(W);
    expect(turnSides(W, 1)).toBe(S);
    expect(turnSides(S, 1)).toBe(E);
    expect(turnSides(E | S, 4)).toBe(E | S);
    // A +PI/2 turn about +Y carries +X to -Z: east (+X) to north (-Z).
    const angle = Math.PI / 2;
    expect(Math.cos(angle) * 1 + Math.sin(angle) * 0).toBeCloseTo(0);
    expect(-Math.sin(angle) * 1 + Math.cos(angle) * 0).toBeCloseTo(-1);
  });

  it('finds a piece and turn for every one of the sixteen neighbour masks', () => {
    const kinds = new Set<string>();
    for (let mask = 0; mask < 16; mask++) {
      const { kind, quarterTurns } = wispMazeHedgePiece(mask);
      kinds.add(kind);
      const canonical = {
        Post: 0,
        End: W,
        Straight: E | W,
        Corner: E | S,
        Tee: E | S | W,
        Cross: 15,
      }[kind];
      expect(turnSides(canonical, quarterTurns), `mask ${mask}`).toBe(mask);
      const joined = [N, E, S, W].filter((side) => mask & side).length;
      expect(kind).toBe(
        joined === 0
          ? 'Post'
          : joined === 1
            ? 'End'
            : joined === 3
              ? 'Tee'
              : joined === 4
                ? 'Cross'
                : mask === (E | W) || mask === (N | S)
                  ? 'Straight'
                  : 'Corner',
      );
    }
    expect(kinds.size).toBe(6);
  });

  it('dresses exactly the sim wall cells, one piece each, so collision is unchanged', () => {
    const plan = planWispMazeHedges(WISP_MAZE_LAYOUT);
    expect(plan.map((spot) => spot.cell)).toEqual([...WISP_MAZE_WALL_CELLS]);
    for (const spot of plan) {
      const row = Math.floor(spot.cell / WISP_MAZE_LAYOUT.cols);
      expect(WISP_MAZE_LAYOUT.grid[row][spot.cell % WISP_MAZE_LAYOUT.cols]).toBe('#');
    }
  });

  it('reads the grid: corners, runs, run ends and the lone pillars', () => {
    const plan = new Map(planWispMazeHedges(WISP_MAZE_LAYOUT).map((spot) => [spot.cell, spot]));
    // The outer shell's corners join their two runs; beyond the grid is open lawn.
    expect(wispMazeWallMask(WISP_MAZE_LAYOUT, cellOf(0, 0))).toBe(E | S);
    expect(plan.get(cellOf(0, 0))).toMatchObject({ kind: 'Corner', quarterTurns: 0 });
    expect(plan.get(cellOf(0, 10))).toMatchObject({ kind: 'Corner' });
    expect(plan.get(cellOf(10, 10))).toMatchObject({ kind: 'Corner' });
    // The shell's sides run straight (east-west on top, north-south down the flanks).
    expect(plan.get(cellOf(0, 3))).toMatchObject({ kind: 'Straight', quarterTurns: 0 });
    expect(plan.get(cellOf(5, 0))).toMatchObject({ kind: 'Straight' });
    expect(plan.get(cellOf(5, 0))!.quarterTurns % 2).toBe(1);
    // The '#.#.#' rows are lone pillars; the '###' bars are an end, a run, an end.
    expect(plan.get(cellOf(2, 2))).toMatchObject({ kind: 'Post' });
    expect(plan.get(cellOf(4, 2))).toMatchObject({ kind: 'End', quarterTurns: 2 });
    expect(plan.get(cellOf(4, 3))).toMatchObject({ kind: 'Straight', quarterTurns: 0 });
    expect(plan.get(cellOf(4, 4))).toMatchObject({ kind: 'End', quarterTurns: 0 });
  });

  it('sets the gates in the shell straight past the spawn and across from it, facing in', () => {
    // Spawn 104 is row 9, col 5: the shell cell below it is the way in.
    expect(WISP_MAZE_LAYOUT.spawnCell).toBe(cellOf(9, 5));
    expect(wispMazeGateCells(WISP_MAZE_LAYOUT)).toEqual([
      { cell: cellOf(10, 5), quarterTurns: 0 },
      { cell: cellOf(0, 5), quarterTurns: 2 },
    ]);
    const gates = planWispMazeHedges(WISP_MAZE_LAYOUT).filter((spot) => spot.kind === 'Gate');
    expect(gates.map((gate) => gate.cell)).toEqual([cellOf(0, 5), cellOf(10, 5)]);
    // Unturned the gate faces north; turned twice it faces south, into the maze.
    expect(turnSides(N, 2)).toBe(S);
  });

  it('refuses a gate where the shell is not a straight run with a corridor behind it', () => {
    const grid = ['#####', '#...#', '#.#.#', '#...#', '##.##'];
    // The spawn's own column opens to the lawn at the bottom: no gate there,
    // and the mirror cell (top) still takes one.
    const layout = { cols: 5, rows: 5, grid, spawnCell: 3 * 5 + 2 };
    expect(wispMazeGateCells(layout)).toEqual([{ cell: 2, quarterTurns: 2 }]);
  });

  it('stands a lantern past each outer corner with its lamp turned toward the centre', () => {
    const spots = wispMazeLanternSpots(WISP_MAZE_LAYOUT, WISP_MAZE_LAYOUT.pitch);
    expect(spots).toHaveLength(4);
    const half = (WISP_MAZE_LAYOUT.cols * WISP_MAZE_LAYOUT.pitch) / 2;
    for (const spot of spots) {
      expect(Math.abs(spot.x)).toBeCloseTo(half + WISP_MAZE_LANTERN_REACH);
      // The unturned lamp hangs north (-Z); turned, it points back at the centre.
      const armX = -Math.sin(spot.rotationY);
      const armZ = -Math.cos(spot.rotationY);
      expect(Math.sign(armX)).toBe(-Math.sign(spot.x));
      expect(Math.sign(armZ)).toBe(-Math.sign(spot.z));
    }
  });

  it('turns the flagstones every way across the corridors', () => {
    const turns = new Set(WISP_MAZE_LAYOUT.openCells.map(wispMazeFlagstoneTurns));
    expect([...turns].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('wisp maze kit core: the garden spirits', () => {
  it('gives each guardian its own crest and the hard-profile one a bigger frame', () => {
    expect(new Set(WISP_GUARDIAN_CRESTS).size).toBe(5);
    expect([0, 1, 2, 3, 4].map(wispGuardianScale)).toEqual([1, 1, 1, 1, 1.18]);
  });

  it('bobs and sways gently, and holds still under reduced motion', () => {
    for (let tick = 0; tick < 400; tick += 7) {
      for (let index = 0; index < 5; index++) {
        const moving = wispGuardianMotion(tick, index, false);
        expect(moving.hover).toBeGreaterThanOrEqual(0.17);
        expect(moving.hover).toBeLessThanOrEqual(0.33);
        expect(Math.abs(moving.sway)).toBeLessThanOrEqual(0.07);
        expect(wispGuardianMotion(tick, index, true)).toEqual({ hover: 0.25, sway: 0 });
      }
    }
    expect(wispGuardianMotion(10, 0, false)).not.toEqual(wispGuardianMotion(10, 1, false));
  });
});
