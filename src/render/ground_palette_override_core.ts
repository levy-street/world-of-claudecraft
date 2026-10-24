// Per-zone ground palette OVERRIDES: the hook the palette lab
// (src/render/palette_lab/) uses to repaint a zone's ground without touching
// the shipped BIOME_PALETTE table.
//
// The ground tint is baked into terrain vertex colours (near chunks, built on
// the main thread AND in the zone build worker) and into the far-vista tiles,
// each from a per-zone palette cache made at module load. This module is the
// one source those caches re-read: they compare `groundPaletteVersion()` with
// the version they last built from and rebuild their per-zone entries when it
// moved, so an override reaches every builder on its next chunk. With no
// override set (every normal session) the version never moves and every cache
// keeps the stock BIOME_PALETTE rows, byte for byte.
//
// Plain data, no Three and no DOM: the worker imports it, and the table rides
// a chunk request as structured-cloned JSON (`groundPaletteOverrideTable`).

import type { BiomeId } from '../sim/types';
import { BIOME_PALETTE } from './terrain_palette';

/** The five ground tones a zone paints with (sRGB hex, BIOME_PALETTE's shape). */
export interface GroundPaletteHexes {
  readonly grass: number;
  readonly grassDark: number;
  readonly grassYellow: number;
  readonly dirt: number;
  readonly sand: number;
}

/** Zone id to its override. A zone missing from the table paints stock. */
export type GroundPaletteTable = Readonly<Record<string, GroundPaletteHexes>>;

let table: GroundPaletteTable | null = null;
let tableKey = '';
let version = 0;

function keyOf(next: GroundPaletteTable | null): string {
  if (!next) return '';
  const ids = Object.keys(next).sort();
  return ids
    .map((id) => {
      const p = next[id];
      return `${id}:${p.grass},${p.grassDark},${p.grassYellow},${p.dirt},${p.sand}`;
    })
    .join('|');
}

/**
 * Replace the override table (null clears every override). Returns true only
 * when the effective table changed, which is also the only time the version
 * moves, so re-sending the same table (every worker job carries it) costs
 * the caches nothing.
 */
export function setGroundPaletteOverrides(next: GroundPaletteTable | null): boolean {
  const key = keyOf(next);
  if (key === tableKey) return false;
  tableKey = key;
  table = key === '' ? null : { ...next };
  version++;
  return true;
}

/** Bumped on every effective change; caches rebuild when it differs. */
export function groundPaletteVersion(): number {
  return version;
}

/** The live table, for shipping to the zone build worker (null = stock). */
export function groundPaletteOverrideTable(): GroundPaletteTable | null {
  return table;
}

/** The palette a zone paints with: its override, else its biome's stock row. */
export function groundPaletteFor(zoneId: string, biome: BiomeId): GroundPaletteHexes {
  return table?.[zoneId] ?? BIOME_PALETTE[biome];
}
