import { describe, expect, it } from 'vitest';
import { toroidalCell } from '../src/render/blade_grass_pool_core';

describe('blade grass toroidal cell ownership', () => {
  it('gives each slot line the one cell of the block congruent to it', () => {
    const gridW = 148;
    for (const base of [0, 1, -1, -74, 5000, -5000]) {
      const seen = new Set<number>();
      for (let g = 0; g < gridW; g++) {
        const cell = toroidalCell(base, g, gridW);
        expect(cell).toBeGreaterThanOrEqual(base);
        expect(cell).toBeLessThan(base + gridW);
        expect(((cell - g) % gridW) + gridW).toBe(gridW); // cell === g (mod gridW)
        seen.add(cell);
      }
      expect(seen.size).toBe(gridW);
    }
  });

  it('moves exactly one line to the far edge per crossing', () => {
    const gridW = 148;
    let moved = 0;
    for (let g = 0; g < gridW; g++) {
      if (toroidalCell(0, g, gridW) !== toroidalCell(1, g, gridW)) moved++;
    }
    expect(moved).toBe(1);
  });
});

// The toroidal scan re-places a slot only when its owned CELL changes. That is
// sound only while placement is a pure function of the cell. A gate keyed off
// anything that moves with the player (a fade disc centred on the camera, say)
// silently freezes its verdict for the slot's whole residency, and the meadow
// grows holes as the player walks: a rejected rim cell is never revisited when
// it arrives under the player's feet. Measured before this pin existed: the
// ultra carpet lost 3850 clusters the shader draws at FULL scale after 23 yards
// of walking, the nearest 13 yards from the player, and 76 percent of the pool
// at steady state. This is the guard for that whole class.
describe('blade grass placement verdicts survive walking', () => {
  const CARPET = { radius: 34, cell: 0.46 };
  const BAND = { radius: 120, cell: 1.25 };

  const hash = (i: number, j: number, k: number): number => {
    let h = (i * 374761393 + j * 668265263 + k * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  /** The live acceptance shape: a decision about the CELL and nothing else. */
  const cellPure = (ci: number, cj: number): boolean => hash(ci, cj, 7) < 0.72;

  function walkedPool(
    radius: number,
    cell: number,
    crossings: number,
    di: number,
    dj: number,
    accepts: (ci: number, cj: number, baseI: number, baseJ: number) => boolean = cellPure,
  ) {
    const gridW = Math.ceil((radius * 2) / cell);
    const pool = gridW * gridW;
    const slotCell = new Int32Array(pool).fill(0x7fffffff);
    const placed = new Uint8Array(pool);
    const colCi = new Int32Array(gridW);
    let baseI = 0;
    let baseJ = 0;
    const scan = (): void => {
      for (let gi = 0; gi < gridW; gi++) colCi[gi] = toroidalCell(baseI, gi, gridW);
      for (let gj = 0; gj < gridW; gj++) {
        const cjj = toroidalCell(baseJ, gj, gridW);
        const packedLo = cjj & 0xffff;
        const rowBase = gj * gridW;
        for (let gi = 0; gi < gridW; gi++) {
          const packed = ((colCi[gi] & 0xffff) << 16) | packedLo;
          const slot = rowBase + gi;
          if (slotCell[slot] === packed) continue;
          slotCell[slot] = packed;
          placed[slot] = accepts(colCi[gi], cjj, baseI, baseJ) ? 1 : 0;
        }
      }
    };
    scan();
    for (let n = 0; n < crossings; n++) {
      baseI += di;
      baseJ += dj;
      scan();
    }
    return { gridW, placed, baseI, baseJ, colCi };
  }

  it('leaves the same pool a fresh scan would build, after any walk', () => {
    for (const { radius, cell } of [CARPET, BAND]) {
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [-1, 1],
      ] as const) {
        for (const crossings of [1, 37, 200]) {
          const walked = walkedPool(radius, cell, crossings, di, dj);
          const fresh = walkedPool(radius, cell, 0, 0, 0);
          // rebuild the fresh arm at the walked arm's own base
          const gridW = walked.gridW;
          const rebuilt = new Uint8Array(gridW * gridW);
          for (let gj = 0; gj < gridW; gj++) {
            const cjj = toroidalCell(walked.baseJ, gj, gridW);
            for (let gi = 0; gi < gridW; gi++) {
              const ci = toroidalCell(walked.baseI, gi, gridW);
              rebuilt[gj * gridW + gi] = cellPure(ci, cjj) ? 1 : 0;
            }
          }
          expect(fresh.placed.length).toBe(rebuilt.length);
          let drift = 0;
          for (let slot = 0; slot < rebuilt.length; slot++) {
            if (walked.placed[slot] !== rebuilt[slot]) drift++;
          }
          expect(drift, `${radius}yd pool, ${crossings} crossings of (${di},${dj})`).toBe(0);
        }
      }
    }
  });

  it('catches a verdict that moves with the player, which is what this pin is for', () => {
    // The regression itself, kept executable: a gate centred on the player (a
    // fade disc) admits only the thin chord of the entering column that is
    // already inside the radius, and the toroidal skip then freezes that "no"
    // for the cell's whole traversal. Drift must be large, or the pin above
    // proves nothing.
    const { radius, cell } = CARPET;
    const gridW = Math.ceil((radius * 2) / cell);
    const limit = radius + cell * Math.SQRT1_2;
    const limitSq = limit * limit;
    const playerCentred = (ci: number, cj: number, baseI: number, baseJ: number): boolean => {
      if (!cellPure(ci, cj)) return false;
      const cx = (baseI + (gridW >> 1) + 0.5) * cell;
      const cz = (baseJ + (gridW >> 1) + 0.5) * cell;
      const dx = ci * cell - cx;
      const dz = cj * cell - cz;
      return dx * dx + dz * dz <= limitSq;
    };
    const fresh = walkedPool(radius, cell, 0, 0, 0, playerCentred);
    const walked = walkedPool(radius, cell, 200, 1, 0, playerCentred);
    const freshCount = fresh.placed.reduce<number>((a, b) => a + b, 0);
    const walkedCount = walked.placed.reduce<number>((a, b) => a + b, 0);
    // the pool erodes to a fraction of what a fresh scan would place
    expect(walkedCount).toBeLessThan(freshCount / 2);
  });

  it('keeps the placed count steady instead of eroding as the player walks', () => {
    for (const { radius, cell } of [CARPET, BAND]) {
      const start = walkedPool(radius, cell, 0, 0, 0);
      const startCount = start.placed.reduce<number>((a, b) => a + b, 0);
      for (const crossings of [50, 200]) {
        const walked = walkedPool(radius, cell, crossings, 1, 0);
        const count = walked.placed.reduce<number>((a, b) => a + b, 0);
        // the meadow's density is a property of the ground, not of the walk
        expect(Math.abs(count - startCount) / startCount).toBeLessThan(0.05);
      }
    }
  });
});

describe('blade grass placement reads only its own cell', () => {
  it('keeps every player-relative term out of both placeSlot bodies', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['blade_grass.ts', 'blade_grass_band.ts']) {
      const source = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      const start = source.indexOf(
        'function placeSlot(slot: number, ci: number, cj: number): void {',
      );
      expect(start, file).toBeGreaterThan(0);
      const body = source.slice(start, source.indexOf('\n  }\n', start));
      // Anything that moves with the player would be frozen into the slot by
      // the toroidal skip in scanTargetBlock. Placement takes (ci, cj, seed).
      for (const playerRelative of [
        'uPlayerPos',
        'baseI',
        'baseJ',
        'discCenter',
        'bandFar',
        'px',
        'pz',
      ]) {
        expect(body.includes(playerRelative), `${file}: placeSlot reads ${playerRelative}`).toBe(
          false,
        );
      }
    }
  });
});
