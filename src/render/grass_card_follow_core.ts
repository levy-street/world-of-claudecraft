// Where a grass card follows the ground's colour, eased across zone borders.
//
// CARD_FOLLOWS_GROUND (grass_card_tint_core.ts) names the biomes whose cards take the
// meadow's own colour. A biome switches at a zone's edge, but the ground palette it answers
// to blends across that edge (terrain_chunk_build.ts paletteAt: from 30 yd before a strip
// zone's far side to 35 yd past it, and columnBlendAt round a column zone), so a floor
// looked up by biome alone stepped the cards' colour along the line while the ground under
// them eased. This blends the floor with the palette's own windows: where the ground is
// half marsh the cards follow it by half.
//
// Pure: sim data and plain numbers, no Three and no DOM.
import { COLUMN_ZONES, columnBlendAt, isBuiltinWorldActive, STRIP_ZONES } from '../sim/data';
import { zoneBiomeAt } from '../sim/world';
import { CARD_FOLLOWS_GROUND } from './grass_card_tint_core';
import { clamp01 } from './num_clamp';

/** The window a strip zone's palette blends into the next one over, in yards about the
 *  border (terrain_chunk_build.ts paletteAt reads the same two numbers). */
export const STRIP_BLEND_LEAD_YD = 30;
export const STRIP_BLEND_SPAN_YD = 65;

const floorOf = (biome: string): number =>
  Object.hasOwn(CARD_FOLLOWS_GROUND, biome) ? CARD_FOLLOWS_GROUND[biome] : 0;

/** How far the cards at (x, z) follow the ground, 0 to 1. */
export function cardFollowAt(x: number, z: number): number {
  // a maker's world blends its own palette: its cards answer to the biome they stand in
  if (!isBuiltinWorldActive()) return floorOf(zoneBiomeAt(x, z));
  let w = floorOf(STRIP_ZONES[0].biome);
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const t = clamp01((z - (STRIP_ZONES[i].zMax - STRIP_BLEND_LEAD_YD)) / STRIP_BLEND_SPAN_YD);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    w += (floorOf(STRIP_ZONES[i + 1].biome) - w) * tt;
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t > 0) w += (floorOf(col.biome) - w) * t;
  }
  return w;
}
