// Thornhollow's keeps are two storeys, and the only thing that makes a second
// storey in this engine is a 'collider/plane' deck raising walkable ground.
// That mechanism has one sharp edge and one failure mode, and this file exists
// for both:
//
//   * walkable ground is a HEIGHTFIELD, one floor per point. A deck laid over
//     a doorway does not roof it, it LIFTS it, and the player walking through
//     the gate is teleported five yards into the air. So every deck run has to
//     break at every opening, and that is asserted here by walking through each
//     opening and reading the floor under it.
//   * a rampart nobody can climb is scenery. So the walkable surface is
//     flood-filled from OUTSIDE the keep, through the gate, and the flag on its
//     podium and the rampart over the curtain both have to come out reachable ,
//     by stairs, not by any accident of the fill.
//
// The fill is the movement kernel's own rules: isBlocked() decides where the
// body fits, groundHeight() decides the floor, and a step is legal when it
// rises no more than PLAYER_MAX_CLIMB_SLOPE over the step. Descents are free
// (that is falling), which is why reaching the rampart proves a climb exists:
// nothing falls upward.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customMapToWorldContent } from '../src/editor/custom_map';
import { TH_FLAG_Z, thornhollowMap } from '../src/editor/shipped_thornhollow';
import { invalidateStaticColliders, isBlocked } from '../src/sim/colliders';
import { setActiveWorldContent } from '../src/sim/data';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { groundHeight } from '../src/sim/world';

const SEED = 20061;
const map = thornhollowMap('Thornhollow', 'keep_test', 1);

// Mirrors the module's own constants; kept here so a layout change that moves a
// wall has to move this too rather than silently passing.
const KEEP_TOP_Y = 11;
const RAMPART_Y = 5.75;
const PODIUM_Y = 2.5;
const KEEP_HALF_X = 46;
const KEEP_FRONT_Z = 135;
const KEEP_BACK_Z = 181;
const PORT_Z = 158;

const STEP = 0.5;
/** The body the fill walks with, a touch under PLAYER_BODY_RADIUS so a legal
 *  doorway is not judged impassable by a grid that never lands on its centre. */
const BODY = 0.45;
const MAX_RISE = PLAYER_MAX_CLIMB_SLOPE * STEP;

interface Fill {
  has: (x: number, z: number) => boolean;
  floor: (x: number, z: number) => number;
  size: number;
}

/** Flood-fill the walkable surface inside a rect, starting from `from`. */
function flood(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  from: { x: number; z: number },
): Fill {
  const cols = Math.round((x1 - x0) / STEP) + 1;
  const rows = Math.round((z1 - z0) / STEP) + 1;
  const key = (c: number, r: number): number => r * cols + c;
  const heights = new Float64Array(cols * rows);
  const open = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * STEP;
      const z = z0 + r * STEP;
      const y = groundHeight(x, z, SEED);
      heights[key(c, r)] = y;
      // moverY is the FEET height, and it is what lets a body walk under an
      // arch's lintel and step over a kerb (colliders.ts passesUnder /
      // stepsOver). Omitting it makes every banded box a full-height wall,
      // which would judge every doorway on this map shut.
      open[key(c, r)] = isBlocked(SEED, x, z, BODY, false, undefined, 0, { y: y, lift: 0 }) ? 0 : 1;
    }
  }
  const seen = new Uint8Array(cols * rows);
  const sc = Math.round((from.x - x0) / STEP);
  const sr = Math.round((from.z - z0) / STEP);
  if (!open[key(sc, sr)]) throw new Error(`fill start (${from.x}, ${from.z}) is blocked`);
  const stack = [key(sc, sr)];
  seen[key(sc, sr)] = 1;
  let size = 1;
  while (stack.length > 0) {
    const k = stack.pop() as number;
    const c = k % cols;
    const r = (k - c) / cols;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nk = key(nc, nr);
      if (seen[nk] || !open[nk]) continue;
      // Climb limit up; falling down is free.
      if (heights[nk] - heights[k] > MAX_RISE) continue;
      seen[nk] = 1;
      size++;
      stack.push(nk);
    }
  }
  return {
    has: (x, z) => {
      const c = Math.round((x - x0) / STEP);
      const r = Math.round((z - z0) / STEP);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
      return seen[key(c, r)] === 1;
    },
    floor: (x, z) => {
      const c = Math.round((x - x0) / STEP);
      const r = Math.round((z - z0) / STEP);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return NaN;
      return heights[key(c, r)];
    },
    size,
  };
}

let fill: Fill;

beforeAll(() => {
  setActiveWorldContent(customMapToWorldContent(map));
  invalidateStaticColliders();
  // Start on the open field in front of Crimson's gate, OUTSIDE the keep, so
  // everything the fill reaches was reached the way an attacker reaches it.
  fill = flood(-56, 56, -190, -120, { x: 0, z: -128 });
});

// setActiveWorldContent is module-global for the whole worker. Leaving an
// AUTHORED world mounted hands the next file a map carrying objective anchors,
// and the objective driver then spawns flags and practice champions into
// whatever that file is simulating, which showed up as Vale Cup's
// same-seed-replays-identically test failing for no visible reason.
afterAll(() => {
  setActiveWorldContent(null);
  invalidateStaticColliders();
});

describe('thornhollow: the two-storey keep', () => {
  it('lets an attacker in the gate reach the flag on its podium', () => {
    // The gate itself, at plateau height (not lifted onto the rampart).
    expect(fill.has(0, -KEEP_FRONT_Z)).toBe(true);
    expect(fill.floor(0, -KEEP_FRONT_Z)).toBeCloseTo(KEEP_TOP_Y, 2);
    // The flag court, and then the podium the flag stands on.
    expect(fill.has(0, -TH_FLAG_Z)).toBe(true);
    expect(fill.floor(0, -TH_FLAG_Z)).toBeCloseTo(KEEP_TOP_Y + PODIUM_Y, 2);
  });

  it('opens all three ways into the keep, every one of them at ground level', () => {
    // A deck laid across an opening would read KEEP_TOP_Y + RAMPART_Y here.
    for (const [x, z] of [
      [0, -KEEP_FRONT_Z], // the main gate
      [-KEEP_HALF_X, -PORT_Z], // west sally port
      [KEEP_HALF_X, -PORT_Z], // east sally port
    ]) {
      expect(fill.has(x, z), `no way through (${x}, ${z})`).toBe(true);
      expect(fill.floor(x, z), `lifted floor at (${x}, ${z})`).toBeCloseTo(KEEP_TOP_Y, 2);
    }
  });

  it('makes the rampart climbable, all the way round', () => {
    const walk = KEEP_TOP_Y + RAMPART_Y;
    const mid = KEEP_HALF_X - 2.5; // the deck centreline between the two courses
    // A point on each of the four sides, plus both stair heads.
    for (const [x, z, what] of [
      [-mid, -146, 'west rampart (front half)'],
      [-mid, -170, 'west rampart (back half)'],
      [mid, -146, 'east rampart (front half)'],
      [mid, -170, 'east rampart (back half)'],
      [-20, -KEEP_BACK_Z + 2.5, 'back rampart'],
      [20, -KEEP_FRONT_Z - 2.5, 'front rampart, east of the gate'],
      [-20, -KEEP_FRONT_Z - 2.5, 'front rampart, west of the gate'],
    ] as [number, number, string][]) {
      expect(fill.has(x, z), `unreachable: ${what}`).toBe(true);
      expect(fill.floor(x, z), `wrong height: ${what}`).toBeCloseTo(walk, 1);
    }
  });

  it('carries the rampart over the gate on two separate runs, not one', () => {
    // The gate gap is the point of the split: directly over the gate there is
    // no deck, so the front walk is two stubs and the ring goes round the back.
    expect(fill.floor(0, -KEEP_FRONT_Z - 2.5)).toBeCloseTo(KEEP_TOP_Y, 2);
  });

  it('never lifts walkable ground where no deck was authored', () => {
    // Every reachable cell in the keep sits at one of exactly four levels: the
    // ravine approach, the plateau, the podium, or the rampart walk (the stairs
    // and podium ramps sweep between them). Anything else is a deck that
    // overhangs ground it should not, which is the bug this whole file is for.
    const bad: string[] = [];
    for (let z = -186; z <= -132; z += STEP) {
      for (let x = -50; x <= 50; x += STEP) {
        if (!fill.has(x, z)) continue;
        const h = fill.floor(x, z);
        if (h < KEEP_TOP_Y - 0.01) continue; // the approach ramp outside the gate
        if (h > KEEP_TOP_Y + RAMPART_Y + 0.01) {
          bad.push(`(${x}, ${z}) floats at ${h.toFixed(2)}`);
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it('walls the flag court so the podium is only reachable through a door', () => {
    // The court's own walls stand; a carrier cannot be shot at from every angle
    // at once, and an attacker cannot walk in through the back.
    expect(isBlocked(SEED, 0, -175, BODY, false, undefined, 0, { y: 11, lift: 0 })).toBe(true);
    expect(fill.has(0, -167 + 9)).toBe(true); // in front of the court door
  });

  it('is the same fight for Azure', () => {
    // The north keep is the south keep's point mirror, so one fill of it proves
    // the mirror held through every deck, ramp and rail.
    const north = flood(-56, 56, 120, 190, { x: 0, z: 128 });
    expect(north.has(0, KEEP_FRONT_Z)).toBe(true);
    expect(north.floor(0, KEEP_FRONT_Z)).toBeCloseTo(KEEP_TOP_Y, 2);
    expect(north.has(0, TH_FLAG_Z)).toBe(true);
    expect(north.floor(0, TH_FLAG_Z)).toBeCloseTo(KEEP_TOP_Y + PODIUM_Y, 2);
    const mid = KEEP_HALF_X - 2.5;
    expect(north.has(mid, 146)).toBe(true);
    expect(north.floor(mid, 146)).toBeCloseTo(KEEP_TOP_Y + RAMPART_Y, 1);
  });

  it('mirrors every deck, ramp and stair through the origin', () => {
    // The walkable HEIGHT field over the built fortress, twin for twin. This is
    // the assertion that catches a tilted deck whose mirror leans the wrong
    // way: the footprint still matches, so a reachability check can pass while
    // one team climbs its podium and the other walks off the back of it.
    //
    // Samples land on quarter-yard offsets on purpose. Every deck edge in this
    // map falls on a half yard, and a sample sitting EXACTLY on one resolves by
    // the sign of a floating-point comparison, which the two halves have
    // opposite versions of. That is a sampling artifact, not an asymmetry, and
    // it would make this test flag the one thing it is not looking for.
    //
    // The scatter (trees, undergrowth) is deliberately NOT mirrored, it is one
    // rng over the whole map, so this walks the keeps' own footprint only.
    for (let z = -184.25; z <= -132.5; z += 1) {
      for (let x = -49.25; x <= 49.5; x += 1) {
        const south = groundHeight(x, z, SEED);
        const north = groundHeight(-x, -z, SEED);
        expect(north, `${x},${z} -> ${-x},${-z}`).toBeCloseTo(south, 6);
      }
    }
  });
});
