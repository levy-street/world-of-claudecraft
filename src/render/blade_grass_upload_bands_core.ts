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
// The fix is a coarse block index over the dense prefix. BLOCK SIZE IS A
// QUARTER OF THE GRID WIDTH, derived from the pool's own geometry and its
// density gate: a crossing re-places one slot LINE, about GRID_W instances,
// into a prefix of about GRID_W squared times the meadow's coverage, so its
// marks land about `coverage * GRID_W` apart. A block below that spacing holds
// one mark and uploads one instance; a block at or above it holds two and
// uploads the span between them. The coverage floor is the density gate's own
// 0.44 (placeSlot's `0.44 + 1.7 * lush * lush`), so a quarter row is under the
// spacing for any ground the meadow can produce. Measured on the replay in
// tests/blade_grass_upload_bands_core.test.ts, an X crossing of the ultra
// carpet: a full row uploads 17.4 percent of the prefix, a half row 0.74, a
// quarter row 0.74 at full coverage and 0.84 at the sparse end where the half
// row costs 5.4, and an eighth row buys nothing further. The range COUNT is
// bounded by the marks, not by the block count, so the finer index is free.
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
 *
 * The fallback is decided on BYTES, not on how many blocks are dirty: once the
 * ranges would carry more than half of the span they sit in, splitting them
 * saves less than a factor of two in bytes and every extra range is another
 * driver call, so the pass collapses to the single spanning range the pool used
 * to submit unconditionally. A block-count rule was wrong here: a crossing
 * marks one instance in each of many blocks, which is the case the ranges exist
 * for, and counting blocks collapsed exactly then.
 */
export function collectUploadRanges(bands: UploadBands, out: Int32Array): number {
  let covered = 0;
  let spanLo = -1;
  let spanHi = -1;
  for (let b = 0; b < bands.blocks; b++) {
    const lo = bands.lo[b];
    if (lo < 0) continue;
    const hi = bands.hi[b];
    covered += hi - lo + 1;
    if (spanLo < 0) spanLo = lo;
    spanHi = hi;
  }
  if (spanLo < 0) return 0;
  const span = spanHi - spanLo + 1;
  if (covered * 2 > span) {
    out[0] = spanLo;
    out[1] = span;
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
