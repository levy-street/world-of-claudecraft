// Pure relief painter for the Thornhollow battleground field's two map
// backgrounds: the M-key field plan (battleground_map_painter) and the cached
// minimap raster (minimap_painter). Host-agnostic (no DOM, no canvas, no i18n):
// it writes straight into the flat RGBA buffer an `ImageData` exposes, which is
// the same contract map_terrain.ts holds for the overworld map, so the heavy
// per-pixel work is unit-testable in Node and the two surfaces cannot drift.
//
// Heights come from `bgFieldHeightLocal`, the ONE surface the sim, the server
// and the renderer all sample, so a shaded rise on the map is a rise a fighter
// really walks. The colours are a hypsometric ramp over the authored field (the
// sunken Ruin Courtyard, the ravine floor the flag run crosses, the chamber
// swells, then the two keep terraces) plus a west-to-east hillshade.
//
// The field's relief is DELIBERATELY shallow, because the layout under it is
// combat-tuned on flat ground: about five yards from the bottom of the
// courtyard bowl to the top of a keep terrace. So the ramp is packed into that
// band and the hillshade gain runs hot, several times the overworld's: at map
// scale the terrace fronts and the bowl rim are the two shapes that have to
// read, and each is a couple of yards of rise spread over a dozen.
//
// The ramp is a hardcoded terrain palette, exactly as map_terrain.ts hardcodes
// the overworld biome colours: it is sampled terrain, not HUD chrome, and a
// design token cannot be read from a raw pixel buffer anyway. Every HUD-chrome
// colour drawn OVER this stays a token in the calling painter.

import { bgFieldHeightLocal } from '../sim/battleground_field';

/** One hypsometric stop: [field height in yards, r, g, b]. */
type ReliefStop = readonly [number, number, number, number];

// Ascending by height. The play surface sits between about -2.4 (the bottom of
// the Ruin Courtyard bowl) and 2.4 (the keep terraces).
const RELIEF_RAMP: readonly ReliefStop[] = [
  [-2.5, 138, 128, 104], // the bottom of the courtyard bowl, the deepest ground
  [-1.2, 165, 154, 128], // the bowl's shoulders
  [0, 186, 174, 146], // the ravine floor: the flag run
  [1.2, 197, 187, 160], // the chamber swells
  [2, 208, 199, 175], // the two keep terraces
  [2.8, 216, 208, 187], // the crest behind each keep
];

// Hillshade from the west-to-east slope, reusing the already-sampled
// left-neighbour height so relief costs no extra height samples (the
// map_terrain.ts technique). Clamped so a slope cannot blow out to white or
// crush to black.
const SHADE_GAIN = 2.2;
const SHADE_MIN = 0.58;
const SHADE_MAX = 1.36;
const OPAQUE = 255;

/** Linear-interpolated ramp colour for one height, written into `out`. */
function rampRgb(h: number, out: [number, number, number]): void {
  const first = RELIEF_RAMP[0];
  if (h <= first[0]) {
    out[0] = first[1];
    out[1] = first[2];
    out[2] = first[3];
    return;
  }
  for (let i = 1; i < RELIEF_RAMP.length; i++) {
    const hi = RELIEF_RAMP[i];
    if (h > hi[0]) continue;
    const lo = RELIEF_RAMP[i - 1];
    const t = (h - lo[0]) / (hi[0] - lo[0]);
    out[0] = lo[1] + (hi[1] - lo[1]) * t;
    out[1] = lo[2] + (hi[2] - lo[2]) * t;
    out[2] = lo[3] + (hi[3] - lo[3]) * t;
    return;
  }
  const last = RELIEF_RAMP[RELIEF_RAMP.length - 1];
  out[0] = last[1];
  out[1] = last[2];
  out[2] = last[3];
}

/**
 * Paint a `w` by `h` RGBA buffer with the field's shaded relief.
 *
 * The pixel grid follows the map convention BOTH consumers draw in: the world's
 * east is -x, so +x runs toward column 0 (map-left), and +z runs toward row 0
 * (map-up). `originX` / `originZ` are therefore the field-local yards at the
 * buffer's top-left corner, and one pixel is `1 / pxPerYard` yards.
 */
export function paintBgFieldRelief(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  pxPerYard: number,
  originX: number,
  originZ: number,
): void {
  const rgb: [number, number, number] = [0, 0, 0];
  for (let iy = 0; iy < h; iy++) {
    const lz = originZ - (iy + 0.5) / pxPerYard;
    let prevH = 0;
    for (let ix = 0; ix < w; ix++) {
      const lx = originX - (ix + 0.5) / pxPerYard;
      const height = bgFieldHeightLocal(lx, lz);
      rampRgb(height, rgb);
      const left = ix === 0 ? height : prevH;
      prevH = height;
      const shade = Math.max(SHADE_MIN, Math.min(SHADE_MAX, 1 + (height - left) * SHADE_GAIN));
      const k = (iy * w + ix) * 4;
      data[k] = rgb[0] * shade;
      data[k + 1] = rgb[1] * shade;
      data[k + 2] = rgb[2] * shade;
      data[k + 3] = OPAQUE;
    }
  }
}
