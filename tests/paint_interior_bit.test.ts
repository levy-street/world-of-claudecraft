import { describe, expect, it } from 'vitest';

import { markPaintInterior } from '../src/render/terrain_paint_interior_core';

const BIT = 128;
const UNPAINTED = 255;

/** The definition, written out literally: a cell is interior when every cell
 *  of its (2R+1)^2 box carries the same id. O(cells * R^2), which is exactly
 *  what markPaintInterior exists to avoid, so it is the right reference. */
function bruteForce(ids: number[], cols: number, rows: number, R: number): Set<number> {
  const out = new Set<number>();
  for (let r = R; r < rows - R; r++) {
    for (let c = R; c < cols - R; c++) {
      const id = ids[r * cols + c];
      let all = true;
      for (let dr = -R; dr <= R && all; dr++) {
        for (let dc = -R; dc <= R; dc++) {
          if (ids[(r + dr) * cols + (c + dc)] !== id) {
            all = false;
            break;
          }
        }
      }
      if (all) out.add(r * cols + c);
    }
  }
  return out;
}

/** The field bytes fillFieldData would produce: slot 0/1/2 per id, or the
 *  unpainted sentinel for id -1. */
function fieldFor(ids: number[]): Uint8Array {
  const out = new Uint8Array(ids.length * 4);
  for (let i = 0; i < ids.length; i++) out[i * 4] = ids[i] < 0 ? UNPAINTED : ids[i];
  return out;
}

/** Which cells carry the interior bit. The sentinel must be excluded FIRST:
 *  255 already has bit 128 set, so a naive `byte & BIT` reads every unpainted
 *  cell as interior. The shader has the same order of checks (`< 250` before
 *  `>= 128`) and this is the reason for it. */
function marked(out: Uint8Array, count: number): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i < count; i++) {
    if (out[i * 4] !== UNPAINTED && out[i * 4] & BIT) set.add(i);
  }
  return set;
}

// Deterministic LCG: the same grids every run, so a failure is reproducible.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('markPaintInterior', () => {
  it('matches a brute-force box scan on random grids at every radius', () => {
    const rand = rng(20260922);
    for (const R of [1, 2, 3, 4, 6]) {
      for (let trial = 0; trial < 12; trial++) {
        const cols = 17 + Math.floor(rand() * 20);
        const rows = 17 + Math.floor(rand() * 20);
        // Blobby, not per-cell noise: pure noise has almost no interior at
        // R >= 2, which would make the test pass vacuously.
        const ids: number[] = [];
        const scale = 3 + Math.floor(rand() * 6);
        const seeds = Array.from({ length: 4 }, () => Math.floor(rand() * 4) - 1);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            ids.push(seeds[(Math.floor(r / scale) * 2 + Math.floor(c / scale)) % seeds.length]);
          }
        }
        const out = fieldFor(ids);
        markPaintInterior(ids, cols, rows, R, out, BIT);
        const got = marked(out, ids.length);
        // Unpainted cells never take the bit, however uniform their box is.
        const want = new Set([...bruteForce(ids, cols, rows, R)].filter((i) => ids[i] >= 0));
        expect({ R, trial, got: [...got].sort((a, b) => a - b) }).toEqual({
          R,
          trial,
          got: [...want].sort((a, b) => a - b),
        });
      }
    }
  });

  it('marks the middle of a solid block and nothing within R of its border', () => {
    const cols = 21;
    const rows = 21;
    const ids = Array.from({ length: cols * rows }, () => 0);
    const out = fieldFor(ids);
    markPaintInterior(ids, cols, rows, 3, out, BIT);
    // Row 3 col 3 is exactly R from both edges: its box fits, so it IS interior.
    expect(out[(3 * cols + 3) * 4] & BIT).toBe(BIT);
    // Row 2 col 3 is one short: its box runs off the grid.
    expect(out[(2 * cols + 3) * 4] & BIT).toBe(0);
    expect(out[(10 * cols + 10) * 4] & BIT).toBe(BIT);
  });

  it('a single foreign cell clears the bit across its whole radius', () => {
    const cols = 31;
    const rows = 31;
    const ids = Array.from({ length: cols * rows }, () => 0);
    ids[15 * cols + 15] = 1; // one odd cell in the middle of a solid field
    const R = 4;
    const out = fieldFor(ids);
    markPaintInterior(ids, cols, rows, R, out, BIT);
    for (let dr = -R; dr <= R; dr++) {
      for (let dc = -R; dc <= R; dc++) {
        expect(out[((15 + dr) * cols + (15 + dc)) * 4] & BIT).toBe(0);
      }
    }
    // Just outside the odd cell's reach, the field is interior again.
    expect(out[(15 * cols + (15 + R + 1)) * 4] & BIT).toBe(BIT);
  });

  it('never marks an unpainted cell, whose sentinel already carries the bit', () => {
    const cols = 21;
    const rows = 21;
    // Solid unpainted: every box IS uniform, so only the sentinel check can
    // keep these cells out of the interior set.
    const ids = Array.from({ length: cols * rows }, () => -1);
    const out = fieldFor(ids);
    markPaintInterior(ids, cols, rows, 3, out, BIT);
    expect(marked(out, ids.length).size).toBe(0);
    // ...and the sentinel byte itself is left exactly as it was.
    expect([...out.filter((_, i) => i % 4 === 0)].every((b) => b === UNPAINTED)).toBe(true);
  });

  it('marks nothing on a grid too small to hold one box', () => {
    const ids = Array.from({ length: 5 * 5 }, () => 0);
    const out = fieldFor(ids);
    markPaintInterior(ids, 5, 5, 3, out, BIT);
    expect(marked(out, ids.length).size).toBe(0);
  });
});
