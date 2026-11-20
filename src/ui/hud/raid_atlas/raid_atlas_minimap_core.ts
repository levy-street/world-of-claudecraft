// The raid atlas on the round minimap, as pure decisions: which part of a page
// raster the minimap shows round the player, when a sharp detail tile beats the
// whole-page plate, which room names the minimap can afford at its zoom, and
// the key that lets an unchanged minimap skip its repaint.
//
// Projection (it mirrors the dungeon minimap, dungeon_map_view.ts): the
// player's page point sits at the minimap's centre and one page yard spans
// `pxPerYard` CSS px; page u grows to the right, v down (u = maxX - x,
// v = maxZ - z, raid_atlas_camera_core.ts). North is always up: the minimap
// has no rotate mode.
//
// DOM-free and deterministic.

/** A raster of one page: `k` raster px per page yard, the page point (u, v)
 *  at its top-left corner, and its size in raster px. The whole-page plate is
 *  one (offset 0, 0); a sharp detail tile is another. */
export interface RaidAtlasRaster {
  k: number;
  offU: number;
  offV: number;
  w: number;
  h: number;
}

/** A drawImage source rect (raster px) and its destination (CSS px). */
export interface RaidAtlasBlit {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** A detail tile pays off once the minimap asks this much more resolution
 *  than the plate holds (the M-map's own sharp threshold, raid_atlas_painter). */
export const RAID_ATLAS_MINIMAP_SHARP_AT = 1.2;
/** A detail tile spans this many minimap diameters, so a walk keeps it valid. */
export const RAID_ATLAS_MINIMAP_TILE_SPAN = 2.2;
/** Major room names show from this minimap zoom (the presets are 1, 1.5, 2, 3). */
export const RAID_ATLAS_MINIMAP_LABEL_ZOOM = 2;

/** The part of `raster` the minimap shows round page point (u, v), clipped to
 *  what the raster holds; null when none of it is in view. */
export function minimapBlit(
  raster: RaidAtlasRaster,
  u: number,
  v: number,
  size: number,
  pxPerYard: number,
): RaidAtlasBlit | null {
  if (!(pxPerYard > 0) || !(raster.k > 0)) return null;
  const span = size / pxPerYard;
  const u0 = u - span / 2;
  const v0 = v - span / 2;
  const iu0 = Math.max(u0, raster.offU);
  const iv0 = Math.max(v0, raster.offV);
  const iu1 = Math.min(u0 + span, raster.offU + raster.w / raster.k);
  const iv1 = Math.min(v0 + span, raster.offV + raster.h / raster.k);
  if (!(iu1 > iu0) || !(iv1 > iv0)) return null;
  return {
    sx: (iu0 - raster.offU) * raster.k,
    sy: (iv0 - raster.offV) * raster.k,
    sw: (iu1 - iu0) * raster.k,
    sh: (iv1 - iv0) * raster.k,
    dx: (iu0 - u0) * pxPerYard,
    dy: (iv0 - v0) * pxPerYard,
    dw: (iu1 - iu0) * pxPerYard,
    dh: (iv1 - iv0) * pxPerYard,
  };
}

/** Does `raster` hold the whole minimap view round (u, v)? */
export function rasterCovers(
  raster: RaidAtlasRaster,
  u: number,
  v: number,
  size: number,
  pxPerYard: number,
): boolean {
  if (!(pxPerYard > 0) || !(raster.k > 0)) return false;
  const half = size / 2 / pxPerYard;
  return (
    u - half >= raster.offU &&
    v - half >= raster.offV &&
    u + half <= raster.offU + raster.w / raster.k &&
    v + half <= raster.offV + raster.h / raster.k
  );
}

/** True when the minimap at this scale wants more detail than the plate
 *  (`plateK` plate px per yard) can give its `dpr`-dense canvas. */
export function minimapWantsDetail(pxPerYard: number, dpr: number, plateK: number): boolean {
  return pxPerYard * dpr > plateK * RAID_ATLAS_MINIMAP_SHARP_AT;
}

/** The detail tile to render for a minimap centred on (u, v): device-px dense,
 *  a few minimap diameters wide, centred on the player. */
export function minimapDetailTile(
  u: number,
  v: number,
  size: number,
  pxPerYard: number,
  dpr: number,
): RaidAtlasRaster {
  const k = pxPerYard * dpr;
  const side = Math.ceil(size * dpr * RAID_ATLAS_MINIMAP_TILE_SPAN);
  const halfYards = side / 2 / k;
  return { k, offU: u - halfYards, offV: v - halfYards, w: side, h: side };
}

/** Is a tile still the right one for this scale (same density)? */
export function tileMatchesScale(tile: RaidAtlasRaster, pxPerYard: number, dpr: number): boolean {
  return Math.abs(tile.k - pxPerYard * dpr) < 1e-6;
}

/** Which room names the minimap draws at a zoom preset: none when zoomed out
 *  (they would crowd the marks), the major ones close in. */
export function minimapRoomLabels(zoom: number): 'none' | 'major' {
  return zoom >= RAID_ATLAS_MINIMAP_LABEL_ZOOM ? 'major' : 'none';
}

/** Screen point (CSS px) of page point (pu, pv) on a minimap centred on (u, v). */
export function minimapScreen(
  pu: number,
  pv: number,
  u: number,
  v: number,
  size: number,
  pxPerYard: number,
): { sx: number; sy: number } {
  return { sx: size / 2 + (pu - u) * pxPerYard, sy: size / 2 + (pv - v) * pxPerYard };
}

/** Everything a minimap paint shows, reduced to what can change it. */
export interface RaidAtlasMinimapState {
  floor: string;
  /** Player position (instance-local yards) and facing (radians). */
  lx: number;
  lz: number;
  facing: number;
  pxPerYard: number;
  /** The canvas backing width: a resize (DPR change) wipes the canvas. */
  backing: number;
  /** One letter per boss state, in plan order. */
  bosses: string;
  /** True while any boss fights: its pulse animates, so every paint is new. */
  engaged: boolean;
  members: readonly { x: number; z: number; cls: string; dead: boolean }[];
  /** Live marks in minimap px (mobs, loot, gates). */
  marks: readonly { kind: string; cx: number; cy: number; aggro?: boolean }[];
  pins: string;
  /** The view settled (a sharp tile may replace the plate). */
  settled: boolean;
  /** Whether the floor's plate is ready (a cold first paint repaints once it is). */
  plateReady: boolean;
}

const q = (n: number, step: number): number => Math.round(n / step);

/**
 * The idle-skip key of a minimap paint: equal keys draw identical pixels, so
 * the painter can leave the canvas as it is. Positions quantise below a
 * device pixel; null while a boss fights (its pulse moves every paint).
 */
export function raidAtlasMinimapKey(s: RaidAtlasMinimapState): string | null {
  if (s.engaged) return null;
  // A quarter CSS px of movement at this scale, in yards.
  const step = 0.25 / Math.max(1e-6, s.pxPerYard);
  let key = `${s.floor}|${q(s.lx, step)}|${q(s.lz, step)}|${q(s.facing, 0.004)}|${s.pxPerYard}|${s.backing}|${s.bosses}|${s.pins}|${s.settled ? 1 : 0}|${s.plateReady ? 1 : 0}`;
  for (const m of s.members) key += `|m${q(m.x, step)},${q(m.z, step)},${m.cls},${m.dead ? 1 : 0}`;
  for (const m of s.marks)
    key += `|${m.kind[0]}${q(m.cx, 0.25)},${q(m.cy, 0.25)}${m.aggro ? '!' : ''}`;
  return key;
}
