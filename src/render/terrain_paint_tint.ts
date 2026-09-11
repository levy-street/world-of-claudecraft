// The biome-paint layer, resolved into render terms.
//
// v0.35's splat shader dropped the fork's ~900-line paint field + custom
// ground-texture atlas (see the note in render/terrain.ts); this module is the
// working subset that brings a map's PAINT LAYER back to the ground without
// re-importing that machinery. A painted cell contributes three things the
// terrain pipelines already know how to draw:
//
//   - a TINT: the swatch's colour, multiplied into the splat albedo exactly
//     like the biome palette tint (splat textures are authored near mid-gray,
//     so the tint is what makes paving read pale and cobbles read slate);
//   - a LAYER: the built-in splat layer (grass/dirt/rock/sand) nearest the
//     swatch's referenced texture family, so a plaza is rocky underfoot and a
//     drill yard is packed dirt — real texture change, not just colour;
//   - SNOW: swatches referencing the Snow family ride the shader's dedicated
//     snow layer (vExtra.y) instead, which carries its own albedo + roughness.
//
// Swatches keep their real `builtin:` texture references in the document, so
// nothing here is lossy: the moment the full atlas is re-integrated (or the
// map is opened in the fork editor that still has it), the true textures take
// over and this mapping simply stops being the closest available drawing.
//
// Used by BOTH terrain pipelines (near chunks — worker included, it bundles
// this with the sim — and the far vista), and by the editor viewport, which
// renders through the same chunk builder.

import { getActiveWorldContent } from '../sim/data';
import type { BiomePaint } from '../sim/types';
import { terrainTextureSet } from './terrain_texture_sets';

export interface PaintTint {
  /** Tint in LINEAR colour space, 0..1 — the working space both terrain
   *  pipelines blend vertex colours in (near chunks via THREE.Color's managed
   *  hex parse, the far vista via its own srgbHexToLinear). */
  r: number;
  g: number;
  b: number;
  /** Splat layer to pull toward: 0 grass, 1 dirt, 2 rock, 3 sand; -1 = tint
   *  only (colour swatches with no texture reference). */
  layer: -1 | 0 | 1 | 2 | 3;
  /** Snow-layer weight (the shader's vExtra.y): 1 for Snow-family swatches. */
  snow: number;
  /** How hard the paint overrides the natural ground (tint and layer). */
  strength: number;
  /** True when the swatch rides the fragment tile array
   *  (terrain_paint_layers.ts): its REAL texture replaces the ground in the
   *  shader, so the near-chunk vertex bridge must NOT also shift the splat
   *  layer for it - that shift bleeds one vertex ring past the painted
   *  cells and reads as a rock rim around the paint. Colour-only and
   *  Snow-family swatches stay false: the vertex path IS their render. */
  textured: boolean;
}

/** The splat layer nearest a built-in texture family. The families are the
 *  texture-set keys in render/terrain_texture_sets.ts ('builtin:<Key>'). */
function layerForTexture(sha: string | undefined): -1 | 0 | 1 | 2 | 3 {
  if (!sha || !sha.startsWith('builtin:')) return -1;
  const key = sha.slice('builtin:'.length);
  if (/^(Rock|Cliff|Paving|Cobble|Tiles|Lava)/i.test(key)) return 2;
  if (/^(Ground|Gravel|Roots|Wood)/i.test(key)) return 1;
  if (/^Sand/i.test(key)) return 3;
  if (/^Grass/i.test(key)) return 0;
  return -1;
}

/** Apply the swatch's lightness shift to its base colour, once, at resolve
 *  time (the per-vertex path must not do colour math per tap). */
function shiftedColor(color: number, light: number | undefined): number {
  if (!light) return color;
  const k = 1 + Math.max(-1, Math.min(1, light));
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * k));
  const b = Math.min(255, Math.round((color & 0xff) * k));
  return (r << 16) | (g << 8) | b;
}

/** sRGB channel to linear, the same transfer THREE.Color's managed hex parse
 *  applies — so a painted tint lands in exactly the space the biome palette
 *  colours already occupy. */
function s2l(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Resolved swatches, cached per paint layer object (content identity: a new
// document projection is a new BiomePaint, and the cache follows it).
const fxCache = new WeakMap<BiomePaint, Map<number, PaintTint | null>>();

function fxFor(bp: BiomePaint, id: number): PaintTint | null {
  let map = fxCache.get(bp);
  if (!map) {
    map = new Map();
    fxCache.set(bp, map);
  }
  const hit = map.get(id);
  if (hit !== undefined) return hit;
  const swatch = bp.custom?.find((s) => s.id === id);
  let fx: PaintTint | null = null;
  if (swatch) {
    const snow = swatch.textureSha?.startsWith('builtin:Snow') === true;
    const color = shiftedColor(swatch.color, swatch.light);
    // Mirrors terrain_paint_layers.ts textureSlotSwatch: which swatches the
    // fragment tile array renders (imported shas always; builtin shas when
    // the set exists and is not Snow-family).
    const sha = swatch.textureSha;
    const textured =
      !!sha &&
      !snow &&
      (sha.startsWith('builtin:')
        ? terrainTextureSet(sha.slice('builtin:'.length)) !== null
        : true);
    fx = {
      r: s2l(((color >> 16) & 0xff) / 255),
      g: s2l(((color >> 8) & 0xff) / 255),
      b: s2l((color & 0xff) / 255),
      layer: snow ? -1 : layerForTexture(swatch.textureSha),
      snow: snow ? 0.9 : 0,
      strength: 0.88,
      textured,
    };
  }
  map.set(id, fx);
  return fx;
}

/**
 * The paint at WORLD (x, z), or null where unpainted / painted with a
 * built-in biome id (those recolour through biomeAt's palette path already).
 * Grid lookup plus a cached swatch resolve — cheap enough for the chunk
 * builder's per-vertex loop.
 */
export function paintTintAt(x: number, z: number): PaintTint | null {
  const bp = getActiveWorldContent().biomePaint;
  if (!bp) return null;
  const c = Math.floor((x - bp.originX) / bp.cell);
  if (c < 0 || c >= bp.cols) return null;
  const r = Math.floor((z - bp.originZ) / bp.cell);
  if (r < 0 || r >= bp.rows) return null;
  const id = bp.ids[r * bp.cols + c];
  if (id === 255) return null;
  return fxFor(bp, id);
}

const texturedIdsCache = new WeakMap<BiomePaint, Set<number>>();

/** The swatch ids the fragment tile array renders (mirrors
 *  terrain_paint_layers.ts textureSlotSwatch), cached per BiomePaint. */
function texturedIds(bp: BiomePaint): Set<number> {
  let ids = texturedIdsCache.get(bp);
  if (!ids) {
    ids = new Set();
    for (const s of bp.custom ?? []) if (fxFor(bp, s.id)?.textured) ids.add(s.id);
    texturedIdsCache.set(bp, ids);
  }
  return ids;
}

/**
 * Does any TEXTURED paint cell touch the world rect, widened by `marginCells`
 * cells on every side? The chunk builder asks this once per chunk so the
 * splat material can skip its paint taps entirely on unpainted draws (the
 * presence bit in terrain_splat_presence_core.ts). The margin covers the
 * fragment feather (a 2x2 bilinear over cell centres reaches one cell past
 * a painted cell), so a chunk is never wrongly declared paint-free.
 */
export function paintTexturedCellsIn(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  marginCells = 2,
): boolean {
  const bp = getActiveWorldContent().biomePaint;
  if (!bp || !bp.ids) return false;
  const ids = texturedIds(bp);
  if (ids.size === 0) return false;
  const c0 = Math.max(0, Math.floor((minX - bp.originX) / bp.cell) - marginCells);
  const c1 = Math.min(bp.cols - 1, Math.floor((maxX - bp.originX) / bp.cell) + marginCells);
  const r0 = Math.max(0, Math.floor((minZ - bp.originZ) / bp.cell) - marginCells);
  const r1 = Math.min(bp.rows - 1, Math.floor((maxZ - bp.originZ) / bp.cell) + marginCells);
  if (c1 < c0 || r1 < r0) return false;
  for (let r = r0; r <= r1; r++) {
    const row = r * bp.cols;
    for (let c = c0; c <= c1; c++) {
      const id = bp.ids[row + c];
      if (id !== 255 && ids.has(id)) return true;
    }
  }
  return false;
}
