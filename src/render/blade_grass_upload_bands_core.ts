// Banded dirty tracking for the blade-grass instance buffers.
//
// The toroidal pools re-place a thin ring of slots per cell crossing, but the
// dense submitted prefix is packed by activation order, so the touched dense
// indices are scattered across it: an X-axis crossing re-places one grid
// COLUMN, which is GRID_W slots at stride GRID_W, and every activation lands
// at the top of the prefix. One min/max span over that set therefore covers
// nearly the whole prefix, and the pool re-uploaded almost all of its matrix
// and colour bytes on every crossing.
//
// The fix is a coarse block index over the dense prefix. BLOCK SIZE IS THE
// GRID WIDTH, derived from the pool's own geometry: the pool is GRID_W x
// GRID_W slots, a Z-axis crossing re-places one contiguous run of GRID_W
// slots, and an X-axis crossing re-places GRID_W slots spaced GRID_W apart,
// so a block of GRID_W dense indices holds a single entry of the strided set
// and a whole row of the contiguous one. That makes the block count GRID_W as
// well, and each crossing dirties a handful of instances per touched block
// instead of the span between the lowest and highest of them.
//
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/blade_grass_upload_bands_core.test.ts.

export interface UploadBands {
  /** Dense indices per block; the pool's grid width. */
  readonly blockSize: number;
  /** Blocks covering the whole dense capacity. */
  readonly blocks: number;
  /** Lowest touched dense index per block, -1 when the block is clean. */
  readonly lo: Int32Array;
  /** Highest touched dense index per block, -1 when the block is clean. */
  readonly hi: Int32Array;
}

export function createUploadBands(capacity: number, blockSize: number): UploadBands {
  const size = Math.max(1, blockSize | 0);
  const blocks = Math.max(1, Math.ceil(capacity / size));
  return {
    blockSize: size,
    blocks,
    lo: new Int32Array(blocks).fill(-1),
    hi: new Int32Array(blocks).fill(-1),
  };
}

/** Record that one dense instance index needs re-uploading. */
export function markUploadDirty(bands: UploadBands, dense: number): void {
  const block = (dense / bands.blockSize) | 0;
  const lo = bands.lo[block];
  if (lo < 0 || dense < lo) bands.lo[block] = dense;
  if (dense > bands.hi[block]) bands.hi[block] = dense;
}

/** Forget every mark; the caller has queued the ranges it wanted. */
export function clearUploadBands(bands: UploadBands): void {
  bands.lo.fill(-1);
  bands.hi.fill(-1);
}

/** Scratch big enough for the ranges `collectUploadRanges` can emit. */
export function createUploadRangeScratch(bands: UploadBands): Int32Array {
  return new Int32Array(bands.blocks * 2);
}

/**
 * Fill `out` with the ranges to upload, as (start, count) pairs, and return
 * how many pairs were written.
 *
 * One range per dirty block, tightened to that block's own lowest and highest
 * touched index. Three merges adjacent ranges itself before it issues the
 * bufferSubData calls (WebGLAttributes), so neighbouring blocks cost one call.
 * Past half the blocks the ranges no longer buy anything: the gaps between
 * them are smaller than the ranges themselves and each one is another driver
 * call, so a majority-dirty pass (a teleport backfill) collapses to the single
 * spanning range the pool used to submit unconditionally.
 */
export function collectUploadRanges(bands: UploadBands, out: Int32Array): number {
  let dirty = 0;
  let spanLo = -1;
  let spanHi = -1;
  for (let b = 0; b < bands.blocks; b++) {
    const lo = bands.lo[b];
    if (lo < 0) continue;
    dirty++;
    if (spanLo < 0) spanLo = lo;
    spanHi = bands.hi[b];
  }
  if (dirty === 0) return 0;
  if (dirty * 2 > bands.blocks) {
    out[0] = spanLo;
    out[1] = spanHi - spanLo + 1;
    return 1;
  }
  let n = 0;
  for (let b = 0; b < bands.blocks; b++) {
    const lo = bands.lo[b];
    if (lo < 0) continue;
    out[n * 2] = lo;
    out[n * 2 + 1] = bands.hi[b] - lo + 1;
    n++;
  }
  return n;
}
