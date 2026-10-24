// The foam texture the water surface breaks its whitecaps, surf and contact
// foam up with: a tileable pattern of bubble cells and lacy streaks, generated
// once at load from a fixed seed (no image file, no Math.random), so every
// client draws the same foam. Pure and DOM-free; ocean_material.ts uploads it.
//
// Channels (8-bit each):
//   R  lace: the open, net-like structure of aged foam (cell edges of a
//      Worley field, softened by fractal noise), 1 on the foam threads
//   G  bubbles: small round cells, the dense fresh foam of a breaking crest
//   B  low-frequency patchiness (fractal value noise), used to vary density
//   A  unused (255)

import { oceanRng } from './ocean_spectrum_core';

export const OCEAN_FOAM_SIZE = 256;

/** Periodic value noise on a `cells` x `cells` lattice over the unit square. */
function makeValueNoise(cells: number, rand: () => number): (u: number, v: number) => number {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (ix: number, iy: number) =>
      grid[(((iy % cells) + cells) % cells) * cells + (((ix % cells) + cells) % cells)];
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Periodic Worley field: distances to the nearest and second-nearest feature point. */
function makeWorley(cells: number, rand: () => number): (u: number, v: number) => [number, number] {
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  for (let i = 0; i < px.length; i++) {
    px[i] = rand();
    py[i] = rand();
  }
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const ix = cx + ox;
        const iy = cy + oy;
        const t = (((iy % cells) + cells) % cells) * cells + (((ix % cells) + cells) % cells);
        const dx = ix + px[t] - x;
        const dy = iy + py[t] - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    }
    return [f1, f2];
  };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** The RGBA8 foam texture, OCEAN_FOAM_SIZE square, tileable on both axes. */
export function buildOceanFoamTexels(seed = 9187): Uint8Array {
  const size = OCEAN_FOAM_SIZE;
  const rand = oceanRng(seed);
  const lace = makeWorley(9, rand);
  const laceFine = makeWorley(23, rand);
  const bubbles = makeWorley(73, rand);
  const noiseA = makeValueNoise(4, rand);
  const noiseB = makeValueNoise(8, rand);
  const noiseC = makeValueNoise(16, rand);
  const noiseD = makeValueNoise(32, rand);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const fbm =
        noiseA(u, v) * 0.5 + noiseB(u, v) * 0.25 + noiseC(u, v) * 0.15 + noiseD(u, v) * 0.1;
      // Warp the lace lookup a little so the cells read as torn foam, not tiles.
      const wu = u + (noiseC(u + 0.31, v) - 0.5) * 0.05;
      const wv = v + (noiseC(u, v + 0.67) - 0.5) * 0.05;
      const [a1, a2] = lace(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1);
      const [b1, b2] = laceFine(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1);
      const thread = 1 - smooth(0.0, 0.16, a2 - a1);
      const threadFine = 1 - smooth(0.0, 0.12, b2 - b1);
      const laceValue = clamp01(Math.max(thread, threadFine * 0.75) * (0.55 + 0.9 * fbm));
      const [c1] = bubbles(u, v);
      // Sparse, uneven bubbles: only cells whose random size clears a threshold
      // show, so fresh foam reads as fizz rather than as a regular dot grid.
      const cellSize = noiseD(u * 3 + 0.21, v * 3 + 0.53);
      const bubble = clamp01(
        smooth(0.32 * cellSize + 0.08, 0.04, c1) * smooth(0.35, 0.75, cellSize),
      );
      const t = (y * size + x) * 4;
      out[t] = Math.round(laceValue * 255);
      out[t + 1] = Math.round(bubble * 255);
      out[t + 2] = Math.round(clamp01(fbm) * 255);
      out[t + 3] = 255;
    }
  }
  return out;
}
