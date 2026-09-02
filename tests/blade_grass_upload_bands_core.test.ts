import { describe, expect, it } from 'vitest';
import {
  activateDenseSlot,
  type DenseSlotState,
  deactivateDenseSlot,
} from '../src/render/blade_grass_dense_core';
import { toroidalCell } from '../src/render/blade_grass_pool_core';
import {
  clearUploadBands,
  collectUploadRanges,
  createUploadBands,
  createUploadRangeScratch,
  markUploadDirty,
} from '../src/render/blade_grass_upload_bands_core';

// The two live pools: the ultra carpet (GFX.bladeCarpetRadius 34, cell 0.46)
// and the mid band (MEADOW_BAND_RADIUS 120, MEADOW_BAND_CELL 1.25).
const CARPET = { radius: 34, cell: 0.46 };
const BAND = { radius: 120, cell: 1.25 };

const MATRIX_FLOATS = 16;
const COLOR_FLOATS = 3;
const BYTES_PER_FLOAT = 4;

type Mode = 'span' | 'banded';

interface CrossingCost {
  /** Instances covered by the queued update ranges. */
  instances: number;
  /** Matrix plus colour bytes the ranges hand to bufferSubData. */
  bytes: number;
  /** Submitted prefix at the end of the crossing. */
  prefix: number;
  /** Ranges queued on each attribute. */
  ranges: number;
}

/**
 * A replay of the pool's real index bookkeeping: the same toroidal scan, the
 * same dense packer, the same dirty marks, with the terrain gate replaced by a
 * hashed acceptance so the measurement is about buffer bookkeeping only.
 */
function replayPool(radius: number, cell: number, mode: Mode, accept: number) {
  const gridW = Math.ceil((radius * 2) / cell);
  const pool = gridW * gridW;
  const slotCell = new Int32Array(pool).fill(0x7fffffff);
  const dense: DenseSlotState = {
    count: 0,
    slotToDense: new Int32Array(pool).fill(-1),
    denseToSlot: new Int32Array(pool).fill(-1),
  };
  const bands = createUploadBands(pool, Math.max(1, gridW >> 2));
  const scratch = createUploadRangeScratch(bands);
  const colCi = new Int32Array(gridW);
  let spanLo = pool;
  let spanHi = -1;

  const hash = (i: number, j: number, k: number): number => {
    let h = (i * 374761393 + j * 668265263 + k * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  const mark = (d: number): void => {
    if (mode === 'banded') {
      markUploadDirty(bands, d);
      return;
    }
    if (d < spanLo) spanLo = d;
    if (d > spanHi) spanHi = d;
  };

  const place = (slot: number, ci: number, cj: number): void => {
    const ok = hash(ci, cj, 7) < accept;
    if (ok) {
      mark(activateDenseSlot(dense, slot));
      return;
    }
    const removed = dense.slotToDense[slot];
    if (removed < 0) return;
    if (deactivateDenseSlot(dense, slot) >= 0) mark(removed);
  };

  const clear = (): void => {
    clearUploadBands(bands);
    spanLo = pool;
    spanHi = -1;
  };

  const scan = (baseI: number, baseJ: number): void => {
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
        place(slot, colCi[gi], cjj);
      }
    }
  };

  const cost = (): CrossingCost => {
    let instances = 0;
    let ranges = 0;
    if (mode === 'banded') {
      ranges = collectUploadRanges(bands, scratch);
      for (let r = 0; r < ranges; r++) instances += scratch[r * 2 + 1];
    } else if (spanHi >= 0) {
      ranges = 1;
      instances = spanHi - spanLo + 1;
    }
    return {
      instances,
      ranges,
      prefix: dense.count,
      bytes: instances * (MATRIX_FLOATS + COLOR_FLOATS) * BYTES_PER_FLOAT,
    };
  };

  return {
    gridW,
    pool,
    /** Move the block base and report what that crossing would upload. */
    cross(baseI: number, baseJ: number): CrossingCost {
      clear();
      scan(baseI, baseJ);
      return cost();
    },
  };
}

/** One warmed pool, then the cost of the named crossing from a settled state. */
function crossingCost(
  radius: number,
  cell: number,
  mode: Mode,
  step: readonly [number, number],
  accept = 0.72,
): CrossingCost {
  const pool = replayPool(radius, cell, mode, accept);
  let i = 0;
  let j = 0;
  pool.cross(i, j);
  // settle: a few crossings of each shape so the dense packing has churned
  for (let n = 0; n < 4; n++) {
    i += 1;
    j += 1;
    pool.cross(i, j);
  }
  i += step[0];
  j += step[1];
  return pool.cross(i, j);
}

const STEPS = {
  '+X': [1, 0],
  '+Z': [0, 1],
  diagonal: [1, 1],
} as const;

describe('blade grass instance upload ranges', () => {
  it('reproduces the whole-prefix upload the single spanning range issued', () => {
    // The audit's baseline: the dense prefix is packed by activation order, so
    // an X crossing's strided column, a diagonal's two rings, and the
    // activations that always land at the top put one min/max span across
    // essentially the whole prefix.
    for (const name of ['+X', '+Z', 'diagonal'] as const) {
      for (const { radius, cell } of [CARPET, BAND]) {
        const span = crossingCost(radius, cell, 'span', STEPS[name]);
        expect(span.ranges).toBe(1);
        expect(span.instances / span.prefix).toBeGreaterThan(0.97);
      }
    }
  });

  it('keeps every crossing under a fiftieth of the prefix once banded', () => {
    for (const name of ['+X', '+Z', 'diagonal'] as const) {
      for (const { radius, cell } of [CARPET, BAND]) {
        const before = crossingCost(radius, cell, 'span', STEPS[name]);
        const after = crossingCost(radius, cell, 'banded', STEPS[name]);
        expect(after.prefix).toBe(before.prefix);
        expect(after.instances / after.prefix).toBeLessThan(0.02);
        expect(after.bytes).toBeLessThan(before.bytes / 40);
      }
    }
  });

  it('bounds the queued ranges by the marks a crossing can make', () => {
    // The range count is what costs driver calls. A crossing re-places one slot
    // line, so it can never mark more than about GRID_W instances however fine
    // the block index is.
    for (const name of ['+X', 'diagonal'] as const) {
      for (const { radius, cell } of [CARPET, BAND]) {
        const gridW = Math.ceil((radius * 2) / cell);
        const after = crossingCost(radius, cell, 'banded', STEPS[name]);
        expect(after.ranges).toBeGreaterThan(0);
        expect(after.ranges).toBeLessThanOrEqual(2 * gridW);
      }
    }
  });

  it('holds under a sparser and a denser meadow alike', () => {
    for (const accept of [0.45, 0.95]) {
      for (const name of ['+X', '+Z', 'diagonal'] as const) {
        for (const { radius, cell } of [CARPET, BAND]) {
          const after = crossingCost(radius, cell, 'banded', STEPS[name], accept);
          expect(after.instances / after.prefix).toBeLessThan(0.02);
        }
      }
    }
  });

  it('collapses to one spanning range only when the ranges stop paying', () => {
    const bands = createUploadBands(64, 8); // 8 blocks
    const out = createUploadRangeScratch(bands);
    expect(collectUploadRanges(bands, out)).toBe(0);

    // sparse marks far apart: the ranges carry far less than the span
    markUploadDirty(bands, 3);
    markUploadDirty(bands, 4);
    markUploadDirty(bands, 40);
    expect(collectUploadRanges(bands, out)).toBe(2);
    expect([out[0], out[1], out[2], out[3]]).toEqual([3, 2, 40, 1]);

    // many dirty blocks but still one instance each: STILL worth splitting,
    // which is the case a block-count rule got wrong
    clearUploadBands(bands);
    for (let b = 0; b < 8; b++) markUploadDirty(bands, b * 8);
    expect(collectUploadRanges(bands, out)).toBe(8);

    // once the marks carry more than half the span, one range is cheaper
    clearUploadBands(bands);
    for (let d = 0; d < 40; d++) markUploadDirty(bands, d);
    expect(collectUploadRanges(bands, out)).toBe(1);
    expect([out[0], out[1]]).toEqual([0, 40]);

    clearUploadBands(bands);
    expect(collectUploadRanges(bands, out)).toBe(0);
  });

  it('sizes one block per quarter grid row of dense indices', () => {
    const bands = createUploadBands(148 * 148, 37);
    expect(bands.blockSize).toBe(37);
    expect(bands.blocks).toBe(592);
    expect(createUploadRangeScratch(bands)).toHaveLength(1184);
  });
});

describe('blade grass banded upload wiring', () => {
  it('queues one range per dirty block on every sector of both live pools', async () => {
    const { readFileSync } = await import('node:fs');
    const pool = readFileSync(
      new URL('../src/render/blade_grass_sector_pool.ts', import.meta.url),
      'utf8',
    );
    // a quarter grid row of dense indices per block: the unsplit pool's own
    // derivation, unchanged by the sector split
    expect(pool).toContain('createUploadBands(capacity, Math.max(1, gridW >> 2))');
    expect(pool).toContain('const ranges = collectUploadRanges(s.bands, s.ranges);');
    expect(pool).toContain('s.im.instanceMatrix.addUpdateRange(start * 16, count * 16);');
    expect(pool).toContain('s.im.instanceColor.addUpdateRange(start * 3, count * 3);');
    for (const file of ['blade_grass.ts', 'blade_grass_band.ts']) {
      const source = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      expect(source).toContain('sectorPool.queueUploads();');
      expect(source).not.toContain('dirtyHi');
    }
  });
});
