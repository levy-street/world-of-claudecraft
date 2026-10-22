// The biome-paint grid's hard cell cap: fits a full-size world at the editor's
// finest 0.5yd brush tier (and mid maps at 0.25yd) while rejecting absurd
// grids. Kept in sync with the editor's finestPaintCell budget.
export const MAX_BIOME_PAINT_CELLS = 4_200_000;

// ---- biome-paint ids RLE (TRANSPORT layers only) ----------------------------
//
// A fine grid's plain ids array is several MB of JSON ? past browser storage
// quotas. Transport seams (the editor's localStorage store, the playtest
// sessionStorage handoff) swap `ids` for this run-length string and expand it
// back before anything else sees the document; the document FORMAT itself
// (file export, bundles, the server) always carries the plain array. Lives in
// sim so the game-side playtest reader can decode without importing editor
// code into the shipped bundle.

/** "count:value" pairs, e.g. "120:255,4:3,76:255". */
export function encodeBiomePaintIdsRle(ids: readonly number[]): string {
  const parts: string[] = [];
  let run = 0;
  let cur = -1;
  for (const id of ids) {
    if (id === cur) {
      run++;
      continue;
    }
    if (run > 0) parts.push(`${run}:${cur}`);
    cur = id;
    run = 1;
  }
  if (run > 0) parts.push(`${run}:${cur}`);
  return parts.join(',');
}

/** Expand an RLE ids string, or null on malformed input / expansion bombs. */
export function decodeBiomePaintIdsRle(rle: string): number[] | null {
  const out: number[] = [];
  for (const part of rle.split(',')) {
    const sep = part.indexOf(':');
    if (sep <= 0) return null;
    const run = Number(part.slice(0, sep));
    const value = Number(part.slice(sep + 1));
    if (!Number.isInteger(run) || run <= 0 || !Number.isFinite(value)) return null;
    if (out.length + run > MAX_BIOME_PAINT_CELLS) return null;
    for (let i = 0; i < run; i++) out.push(value);
  }
  return out;
}
