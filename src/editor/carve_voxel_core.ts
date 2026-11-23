// FORK: the dug rock volume behind the Caves tool's Dig / Fill / Smooth
// brushes. Strokes used to pile up one blended sphere cut per stamp (a blue
// guide ring each, a 256-record cap, and a field that grew slower with every
// stroke); now they bake into ONE signed-distance grid per document, the
// 'voxel' TerrainCut shape (sim/terrain_cuts.ts), which every consumer of the
// cut field - the surface clip, the walkable floors, the cavity mesher -
// already reads through cutSdfAt. Dig lives in `holes`, fill in
// `holePatches`, so a fill still beats every carve it overlaps the way a
// patch always did.
//
// Pure: no DOM, no three. The app owns undo and the region refresh.

import {
  cutSdfAt,
  cutWarpNoise,
  extendVoxelAir,
  setVoxelData,
  VOXEL_CELL_MAX,
  VOXEL_CELL_MIN,
  VOXEL_MAX_CELLS,
  VOXEL_MAX_DIM,
  VOXEL_ROCK,
  VOXEL_UNIT,
  voxelAirBounds,
  voxelData,
} from '../sim/terrain_cuts';
import type { TerrainCut } from '../sim/types';

export type DigAlphaKind = 'round' | 'halfmoon' | 'ragged' | 'crescent';
export const DIG_ALPHA_KINDS: readonly DigAlphaKind[] = ['round', 'halfmoon', 'ragged', 'crescent'];

export interface DigAlpha {
  kind: DigAlphaKind;
  /** Edge noise, 0..1: how ragged the stamp's rim reads. */
  noise: number;
}

/** Inclusive-exclusive cell index box inside a voxel grid. */
export interface VoxelBox {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

/** World-space box in yards. */
export interface WorldBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Cells of padding a grid keeps around what it was asked to cover, so a
 *  stroke that wanders a little past the edge does not regrow every stamp. */
const GROW_PAD_CELLS = 6;

function dimsFor(minW: number, maxW: number, cell: number): { origin: number; n: number } {
  const origin = Math.floor(minW / cell - GROW_PAD_CELLS) * cell;
  const n = Math.ceil((maxW - origin) / cell) + GROW_PAD_CELLS;
  return { origin, n: clamp(n, 1, VOXEL_MAX_DIM) };
}

/** A fresh, rock-filled voxel cut covering `box` at `cell` yards. */
export function makeVoxelCut(cell: number, box: WorldBox): TerrainCut {
  const c = clamp(cell, VOXEL_CELL_MIN, VOXEL_CELL_MAX);
  const dx = dimsFor(box.minX, box.maxX, c);
  const dy = dimsFor(box.minY, box.maxY, c);
  const dz = dimsFor(box.minZ, box.maxZ, c);
  const cut: TerrainCut = {
    x: 0,
    y: 0,
    z: 0,
    radius: 1,
    shape: 'voxel',
    carve: true,
    cell: c,
    vx0: dx.origin,
    vy0: dy.origin,
    vz0: dz.origin,
    nx: dx.n,
    ny: dy.n,
    nz: dz.n,
    vox: '',
  };
  setVoxelData(cut, new Int8Array(dx.n * dy.n * dz.n).fill(VOXEL_ROCK));
  syncVoxelCentre(cut);
  return cut;
}

/** Keep x/y/z/radius (the rect readers' view of the cut) in step with the grid. */
export function syncVoxelCentre(cut: TerrainCut): void {
  const cell = cut.cell ?? 1;
  const nx = cut.nx ?? 0;
  const ny = cut.ny ?? 0;
  const nz = cut.nz ?? 0;
  cut.x = (cut.vx0 ?? 0) + (nx * cell) / 2;
  cut.y = (cut.vy0 ?? 0) + (ny * cell) / 2;
  cut.z = (cut.vz0 ?? 0) + (nz * cell) / 2;
  cut.radius = Math.max(1, Math.hypot(nx * cell, ny * cell, nz * cell) / 2);
}

/** Does the grid already contain the world box (with one cell of slack)? */
export function voxelCovers(cut: TerrainCut, box: WorldBox): boolean {
  const cell = cut.cell ?? 1;
  const x0 = cut.vx0 ?? 0;
  const y0 = cut.vy0 ?? 0;
  const z0 = cut.vz0 ?? 0;
  return (
    box.minX >= x0 + cell &&
    box.minY >= y0 + cell &&
    box.minZ >= z0 + cell &&
    box.maxX <= x0 + ((cut.nx ?? 0) - 1) * cell &&
    box.maxY <= y0 + ((cut.ny ?? 0) - 1) * cell &&
    box.maxZ <= z0 + ((cut.nz ?? 0) - 1) * cell
  );
}

/** The grid's placement: origin and dims. What an undo of a regrow restores. */
export interface VoxelFields {
  vx0: number;
  vy0: number;
  vz0: number;
  nx: number;
  ny: number;
  nz: number;
}

export function voxelFields(cut: TerrainCut): VoxelFields {
  return {
    vx0: cut.vx0 ?? 0,
    vy0: cut.vy0 ?? 0,
    vz0: cut.vz0 ?? 0,
    nx: cut.nx ?? 0,
    ny: cut.ny ?? 0,
    nz: cut.nz ?? 0,
  };
}

/** Cell offset of the current grid's origin from `from` (how far cell
 *  indices taken in the old grid shift in the new one). */
export function voxelShiftFrom(
  cut: TerrainCut,
  from: VoxelFields,
): { x: number; y: number; z: number } {
  const cell = cut.cell ?? 1;
  return {
    x: Math.round((from.vx0 - (cut.vx0 ?? 0)) / cell),
    y: Math.round((from.vy0 - (cut.vy0 ?? 0)) / cell),
    z: Math.round((from.vz0 - (cut.vz0 ?? 0)) / cell),
  };
}

/**
 * Re-place the grid at `fields` (grow or crop), keeping every cell the two
 * placements share. Cells outside the new placement are dropped, new cells
 * are rock. Undo of a regrow is a crop back to the old fields, so no undo
 * step ever has to keep a copy of the whole volume.
 */
export function resizeVoxelCut(cut: TerrainCut, fields: VoxelFields): void {
  const cell = cut.cell ?? 1;
  const old = voxelFields(cut);
  if (
    old.vx0 === fields.vx0 &&
    old.vy0 === fields.vy0 &&
    old.vz0 === fields.vz0 &&
    old.nx === fields.nx &&
    old.ny === fields.ny &&
    old.nz === fields.nz
  ) {
    return;
  }
  const data = voxelData(cut);
  const next = new Int8Array(fields.nx * fields.ny * fields.nz).fill(VOXEL_ROCK);
  // Shared cell range, in NEW indices.
  const sx = Math.round((old.vx0 - fields.vx0) / cell);
  const sy = Math.round((old.vy0 - fields.vy0) / cell);
  const sz = Math.round((old.vz0 - fields.vz0) / cell);
  const x0 = Math.max(0, sx);
  const x1 = Math.min(fields.nx, sx + old.nx);
  const y0 = Math.max(0, sy);
  const y1 = Math.min(fields.ny, sy + old.ny);
  const z0 = Math.max(0, sz);
  const z1 = Math.min(fields.nz, sz + old.nz);
  if (x1 > x0) {
    for (let z = z0; z < z1; z++) {
      for (let y = y0; y < y1; y++) {
        const src = ((z - sz) * old.ny + (y - sy)) * old.nx + (x0 - sx);
        const dst = (z * fields.ny + y) * fields.nx + x0;
        next.set(data.subarray(src, src + (x1 - x0)), dst);
      }
    }
  }
  cut.vx0 = fields.vx0;
  cut.vy0 = fields.vy0;
  cut.vz0 = fields.vz0;
  cut.nx = fields.nx;
  cut.ny = fields.ny;
  cut.nz = fields.nz;
  setVoxelData(cut, next);
  syncVoxelCentre(cut);
}

/** The placement a grow to cover `box` would take, or null past the budget. */
export function grownVoxelFields(cut: TerrainCut, box: WorldBox): VoxelFields | null {
  const cell = cut.cell ?? 1;
  const f = voxelFields(cut);
  // Extend ONLY the sides the box passes, padding those sides alone. The
  // first cut of this padded every side on every regrow, so a tunnel dug
  // straight ahead grew the grid 12 cells in all three axes per stroke and
  // hit the budget after five stamps ("cannot dig through the hill").
  const side = (min: number, max: number, o: number, n: number): { origin: number; n: number } => {
    let origin = o;
    let end = o + n * cell;
    if (min < origin + cell) origin = Math.floor(min / cell - GROW_PAD_CELLS) * cell;
    if (max > end - cell) end = Math.ceil(max / cell + GROW_PAD_CELLS) * cell;
    return { origin, n: Math.round((end - origin) / cell) };
  };
  const dx = side(box.minX, box.maxX, f.vx0, f.nx);
  const dy = side(box.minY, box.maxY, f.vy0, f.ny);
  const dz = side(box.minZ, box.maxZ, f.vz0, f.nz);
  if (dx.n > VOXEL_MAX_DIM || dy.n > VOXEL_MAX_DIM || dz.n > VOXEL_MAX_DIM) return null;
  if (dx.n * dy.n * dz.n > VOXEL_MAX_CELLS) return null;
  return { vx0: dx.origin, vy0: dy.origin, vz0: dz.origin, nx: dx.n, ny: dy.n, nz: dz.n };
}

/**
 * Grow the grid so it covers `box`, keeping every existing cell's value.
 * Returns false (grid untouched) when the grown grid would pass the
 * document's cell budget - the caller reports it.
 */
export function growVoxelCut(cut: TerrainCut, box: WorldBox): boolean {
  if (voxelCovers(cut, box)) return true;
  const fields = grownVoxelFields(cut, box);
  if (!fields) return false;
  resizeVoxelCut(cut, fields);
  return true;
}

/** The coarsest-necessary cell for a NEW grid under a brush of `radius`: the
 *  maker's Dig detail, stepped coarser only when one stamp of that brush
 *  would already take a quarter of the whole cell budget. */
export function pickDigCell(preferred: number, radius: number): number {
  let cell = clamp(preferred, VOXEL_CELL_MIN, VOXEL_CELL_MAX);
  for (;;) {
    const span = (radius * 1.75 + cell * 2) * 2 + GROW_PAD_CELLS * 2 * cell;
    const n = Math.ceil(span / cell);
    if (n * n * n <= VOXEL_MAX_CELLS / 4 || cell >= VOXEL_CELL_MAX) return cell;
    cell = Math.min(VOXEL_CELL_MAX, cell * 2);
  }
}

/** The world box a stamp of `radius` at `c` can touch, including the
 *  distance band the field stores around its surface. */
export function stampWorldBox(
  c: { x: number; y: number; z: number },
  radius: number,
  cell: number,
): WorldBox {
  const reach = radius * 1.75 + cell * 2;
  return {
    minX: c.x - reach,
    minY: c.y - reach,
    minZ: c.z - reach,
    maxX: c.x + reach,
    maxY: c.y + reach,
    maxZ: c.z + reach,
  };
}

function worldToBox(cut: TerrainCut, w: WorldBox): VoxelBox {
  const cell = cut.cell ?? 1;
  const nx = cut.nx ?? 0;
  const ny = cut.ny ?? 0;
  const nz = cut.nz ?? 0;
  const f = (v: number, o: number, n: number): number => clamp(Math.floor((v - o) / cell), 0, n);
  const g = (v: number, o: number, n: number): number => clamp(Math.ceil((v - o) / cell) + 1, 0, n);
  return {
    x0: f(w.minX, cut.vx0 ?? 0, nx),
    y0: f(w.minY, cut.vy0 ?? 0, ny),
    z0: f(w.minZ, cut.vz0 ?? 0, nz),
    x1: g(w.maxX, cut.vx0 ?? 0, nx),
    y1: g(w.maxY, cut.vy0 ?? 0, ny),
    z1: g(w.maxZ, cut.vz0 ?? 0, nz),
  };
}

/** The world rect a voxel box covers, padded for the region rebuild. */
export function voxelBoxRegion(
  cut: TerrainCut,
  box: VoxelBox,
  pad = 2,
): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const cell = cut.cell ?? 1;
  return {
    minX: (cut.vx0 ?? 0) + box.x0 * cell - pad,
    minZ: (cut.vz0 ?? 0) + box.z0 * cell - pad,
    maxX: (cut.vx0 ?? 0) + box.x1 * cell + pad,
    maxZ: (cut.vz0 ?? 0) + box.z1 * cell + pad,
  };
}

export function unionVoxelBox(a: VoxelBox | null, b: VoxelBox): VoxelBox {
  if (!a) return { ...b };
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    z0: Math.min(a.z0, b.z0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
    z1: Math.max(a.z1, b.z1),
  };
}

/**
 * The stamp's radius multiplier in a direction (unit vector from the stamp
 * centre). 'halfmoon' bites deeper along `into` (the wall normal turned
 * inward, or straight down on open ground); 'ragged' and 'crescent' add rim
 * noise on top, scaled by `noise`.
 */
export function alphaRadiusScale(
  alpha: DigAlpha,
  dirX: number,
  dirY: number,
  dirZ: number,
  into: { x: number; y: number; z: number },
  px: number,
  py: number,
  pz: number,
  radius: number,
): number {
  let f = 1;
  if (alpha.kind === 'halfmoon' || alpha.kind === 'crescent') {
    const d = dirX * into.x + dirY * into.y + dirZ * into.z;
    f = 0.62 + 0.55 * Math.max(0, d) - 0.18 * Math.max(0, -d);
  }
  if (alpha.kind === 'ragged' || alpha.kind === 'crescent') {
    const n = cutWarpNoise(px, py, pz, Math.max(0.75, radius * 0.55));
    f *= 1 + Math.max(0, alpha.noise) * 0.45 * n;
  } else if (alpha.noise > 0) {
    const n = cutWarpNoise(px, py, pz, Math.max(0.75, radius * 0.55));
    f *= 1 + alpha.noise * 0.25 * n;
  }
  return Math.max(0.15, f);
}

/** The cell box a stamp will touch (for an undo snapshot taken BEFORE it). */
export function stampBox(
  cut: TerrainCut,
  c: { x: number; y: number; z: number },
  radius: number,
): VoxelBox {
  return worldToBox(cut, stampWorldBox(c, radius, cut.cell ?? 1));
}

/**
 * Bake one brush stamp into the grid: dig lowers the field to the stamp's
 * signed distance (min), fill raises it (max of the negated stamp, i.e. rock
 * inside). The caller must have grown the grid to cover
 * stampWorldBox(c, radius, cell) first. Returns the touched cell box.
 */
export function stampVoxel(
  cut: TerrainCut,
  op: 'dig' | 'fill' | 'restore',
  c: { x: number; y: number; z: number },
  radius: number,
  alpha: DigAlpha,
  into: { x: number; y: number; z: number },
): VoxelBox {
  const cell = cut.cell ?? 1;
  const nx = cut.nx ?? 0;
  const ny = cut.ny ?? 0;
  const box = worldToBox(cut, stampWorldBox(c, radius, cell));
  const data = voxelData(cut);
  extendVoxelAir(cut, box);
  const x0 = cut.vx0 ?? 0;
  const y0 = cut.vy0 ?? 0;
  const z0 = cut.vz0 ?? 0;
  const q = VOXEL_UNIT / cell;
  for (let z = box.z0; z < box.z1; z++) {
    const wz = z0 + (z + 0.5) * cell;
    for (let y = box.y0; y < box.y1; y++) {
      const wy = y0 + (y + 0.5) * cell;
      const row = (z * ny + y) * nx;
      for (let x = box.x0; x < box.x1; x++) {
        const wx = x0 + (x + 0.5) * cell;
        const ox = wx - c.x;
        const oy = wy - c.y;
        const oz = wz - c.z;
        const dist = Math.hypot(ox, oy, oz);
        let f = 1;
        if (alpha.kind !== 'round' || alpha.noise > 0) {
          const inv = dist > 1e-6 ? 1 / dist : 0;
          f = alphaRadiusScale(alpha, ox * inv, oy * inv, oz * inv, into, ox, oy, oz, radius);
        }
        const d = dist - radius * f;
        const i = row + x;
        if (op === 'restore') {
          // Put the rock BACK into a dig grid: the field can only rise, to
          // the stamp's outside distance (CSG subtraction of the air), so a
          // fully refilled tunnel returns to solid rock and its mesh goes.
          const v = clamp(Math.round(-d * q), -127, 127);
          if (v > data[i]) data[i] = v;
          continue;
        }
        const v = clamp(Math.round(d * q), -127, 127);
        // A patch record is solid where ITS field is negative (carveFieldAt
        // takes max(d, -patch)), so a fill stamp writes the same signed
        // distance into the fill grid that a dig writes into the dig grid.
        if (v < data[i]) data[i] = v;
      }
    }
  }
  return box;
}

/**
 * Smooth the field inside the brush: a 3x3x3 box blur, blended in by a
 * radial falloff so the brush edge never steps. Returns the touched box.
 */
export function smoothVoxel(
  cut: TerrainCut,
  c: { x: number; y: number; z: number },
  radius: number,
  strength: number,
): VoxelBox {
  const cell = cut.cell ?? 1;
  const nx = cut.nx ?? 0;
  const ny = cut.ny ?? 0;
  const nz = cut.nz ?? 0;
  const box = worldToBox(cut, {
    minX: c.x - radius,
    minY: c.y - radius,
    minZ: c.z - radius,
    maxX: c.x + radius,
    maxY: c.y + radius,
    maxZ: c.z + radius,
  });
  const data = voxelData(cut);
  extendVoxelAir(cut, box);
  const src = data.slice();
  const x0 = cut.vx0 ?? 0;
  const y0 = cut.vy0 ?? 0;
  const z0 = cut.vz0 ?? 0;
  const k = clamp(strength, 0, 1);
  for (let z = box.z0; z < box.z1; z++) {
    const wz = z0 + (z + 0.5) * cell;
    for (let y = box.y0; y < box.y1; y++) {
      const wy = y0 + (y + 0.5) * cell;
      for (let x = box.x0; x < box.x1; x++) {
        const wx = x0 + (x + 0.5) * cell;
        const t = Math.hypot(wx - c.x, wy - c.y, wz - c.z) / Math.max(1e-6, radius);
        if (t >= 1) continue;
        let sum = 0;
        let n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const zz = z + dz;
          if (zz < 0 || zz >= nz) continue;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= ny) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= nx) continue;
              sum += src[(zz * ny + yy) * nx + xx];
              n++;
            }
          }
        }
        const i = (z * ny + y) * nx + x;
        const w = k * (1 - t * t);
        data[i] = Math.round(src[i] + (sum / n - src[i]) * w);
      }
    }
  }
  return box;
}

/** Re-encode the live volume into the record's `vox` text (a save, a clone
 *  to a worker, and the sanitizer all read the text): call at stroke end. */
export function commitVoxelText(cut: TerrainCut): void {
  setVoxelData(cut, voxelData(cut));
}

/**
 * Extend a stroke's undo snapshot to cover a wider box: cells the previous
 * snapshot held keep their ORIGINAL values, cells outside it are read from
 * the live grid (they are still untouched by this stroke).
 */
export function extendSnapshot(
  cut: TerrainCut,
  prevBox: VoxelBox,
  prevSnap: Int8Array,
  box: VoxelBox,
): Int8Array {
  const out = snapshotVoxels(cut, box);
  const w = box.x1 - box.x0;
  const pw = prevBox.x1 - prevBox.x0;
  for (let z = prevBox.z0; z < prevBox.z1; z++) {
    for (let y = prevBox.y0; y < prevBox.y1; y++) {
      const src = ((z - prevBox.z0) * (prevBox.y1 - prevBox.y0) + (y - prevBox.y0)) * pw;
      const dst = ((z - box.z0) * (box.y1 - box.y0) + (y - box.y0)) * w + (prevBox.x0 - box.x0);
      out.set(prevSnap.subarray(src, src + pw), dst);
    }
  }
  return out;
}

/** Copy the cells of `box` (undo). */
export function snapshotVoxels(cut: TerrainCut, box: VoxelBox): Int8Array {
  const nx = cut.nx ?? 0;
  const ny = cut.ny ?? 0;
  const data = voxelData(cut);
  const w = box.x1 - box.x0;
  const out = new Int8Array(w * (box.y1 - box.y0) * (box.z1 - box.z0));
  let o = 0;
  for (let z = box.z0; z < box.z1; z++) {
    for (let y = box.y0; y < box.y1; y++) {
      const i = (z * ny + y) * nx + box.x0;
      out.set(data.subarray(i, i + w), o);
      o += w;
    }
  }
  return out;
}

/** Restore a snapshotVoxels copy into `box` (same grid dims). */
export function restoreVoxels(cut: TerrainCut, box: VoxelBox, snap: Int8Array): void {
  const nx = cut.nx ?? 0;
  const ny = cut.ny ?? 0;
  const data = voxelData(cut);
  const w = box.x1 - box.x0;
  let o = 0;
  for (let z = box.z0; z < box.z1; z++) {
    for (let y = box.y0; y < box.y1; y++) {
      const i = (z * ny + y) * nx + box.x0;
      data.set(snap.subarray(o, o + w), i);
      o += w;
    }
  }
  setVoxelData(cut, data);
}

/** True when nothing is dug (every cell is rock): the record can go. */
export function voxelIsEmpty(cut: TerrainCut): boolean {
  return voxelAirBounds(cut) === null;
}

// ---- FORK: the Fill tool's eraser box -------------------------------------
// SPACEY (2026-09-12): "make the fill brush a square that you can scale to any
// size; anything in that square removes all caves in that area."

/** The grid cells an erase box can reach in a dug volume (its rotated
 *  footprint's circumscribed rect), or null when the box misses the grid. */
export function eraseVoxelBounds(cut: TerrainCut, box: TerrainCut): VoxelBox | null {
  const hx = box.halfX ?? box.radius;
  const hy = box.halfY ?? box.radius;
  const hz = box.halfZ ?? box.radius;
  const reach = Math.hypot(hx, hz);
  const vb = worldToBox(cut, {
    minX: box.x - reach,
    maxX: box.x + reach,
    minY: box.y - hy,
    maxY: box.y + hy,
    minZ: box.z - reach,
    maxZ: box.z + reach,
  });
  if (vb.x1 <= vb.x0 || vb.y1 <= vb.y0 || vb.z1 <= vb.z0) return null;
  return vb;
}

/** Every cell whose centre lies inside the oriented box goes back to solid
 *  rock. Returns true when any cell changed (the record's text is refreshed
 *  then, so the worker meshes the erased volume). */
export function eraseVoxelBox(cut: TerrainCut, box: TerrainCut, vb: VoxelBox): boolean {
  const cell = cut.cell ?? 1;
  const nx = cut.nx ?? 0;
  const ny = cut.ny ?? 0;
  const data = voxelData(cut);
  const x0 = cut.vx0 ?? 0;
  const y0 = cut.vy0 ?? 0;
  const z0 = cut.vz0 ?? 0;
  let changed = false;
  for (let z = vb.z0; z < vb.z1; z++) {
    const wz = z0 + (z + 0.5) * cell;
    for (let y = vb.y0; y < vb.y1; y++) {
      const wy = y0 + (y + 0.5) * cell;
      const row = (z * ny + y) * nx;
      for (let x = vb.x0; x < vb.x1; x++) {
        const i = row + x;
        if (data[i] === VOXEL_ROCK) continue;
        const wx = x0 + (x + 0.5) * cell;
        if (cutSdfAt(box, wx, wy, wz) > 0) continue;
        data[i] = VOXEL_ROCK;
        changed = true;
      }
    }
  }
  if (changed) setVoxelData(cut, data);
  return changed;
}
