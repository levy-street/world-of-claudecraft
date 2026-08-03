// Pure relief painter for the Thornhollow battleground field's two map
// backgrounds: the M-key field plan (battleground_map_painter) and the cached
// minimap raster (minimap_painter). Host-agnostic (no DOM, no canvas, no i18n):
// it writes straight into the flat RGBA buffer an `ImageData` exposes, which is
// the same contract map_terrain.ts holds for the overworld map, so the heavy
// per-pixel work is unit-testable in Node and the two surfaces cannot drift.
//
// Heights come from `bgFieldHeightLocal`, the ONE surface the sim, the server
// and the renderer all sample, so a shaded rise on the map is a rise a fighter
// really walks. The tinting is a hypsometric ramp over the authored field (the
// sunken Ruin Courtyard, the ravine floor the flag run crosses, the chamber
// swells, then the two keep terraces) under a hillshade lit from the northwest.
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
//
// ONE STYLE, TWO SURFACES. `paintBgFieldAtlas` is the hand-drawn fantasy atlas
// plate the overworld map paints (src/ui/map_terrain.ts): the field's AUTHORED
// ground paint as the base colour (plus the two graveyard plots, stamped over
// it as their own surface family), hypsometric tinting through the shared ramp,
// fbm vegetation mottling, contour banding, inked edges where one authored
// surface meets another, and two-axis hillshade lit from the northwest. BOTH
// map backgrounds rasterize it, each once per session at its own scale: the
// M-map's plate at several pixels per yard, the minimap's cached sheet at 2.5.
// It replaced the second, cheaper one-axis wash the minimap used to blit, which
// described the same field a different way for no read a player gains; the
// hillshade gain here is per YARD and scaled by pxPerYard at use, so the same
// ground shades the same at both scales rather than flattening out on the
// coarser one.

import {
  BG_PAINT_CELL,
  BG_PAINT_COLS,
  BG_PAINT_ORIGIN_X,
  BG_PAINT_ORIGIN_Z,
  BG_PAINT_ROWS,
  bgFieldHeightLocal,
  bgFieldPaintCells,
} from '../sim/battleground_field';
import { fbm2 } from '../sim/rng';
import { TH_GRAVEYARDS, TH_PAINT_SWATCHES, TH_SEED } from '../sim/thornhollow_field.generated';

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

// ---------------------------------------------------------------------------
// The atlas plate (the field surface BOTH map backgrounds rasterize).
// ---------------------------------------------------------------------------

/** The authored surface a cell was painted with, reduced to the families the
 *  plate draws differently. Ordered so the value doubles as a palette index. */
export const BG_SURFACE_GRASS = 0;
export const BG_SURFACE_FLAGSTONE = 1;
export const BG_SURFACE_DIRT = 2;
/** The two graveyard plots. Not an authored swatch: the 3D field dresses them
 *  with the same worn ground as its lanes, and on the plate they have to read as
 *  their own place, so they are STAMPED over the paint grid from the authored
 *  plot rectangles below. Being a surface family rather than an overlay is the
 *  point: the plot then takes the hypsometric tint, the mottle, the contours,
 *  the hillshade and the inked boundary every other surface gets, instead of
 *  sitting on the finished plate as a flat rectangle of colour. */
export const BG_SURFACE_GRAVE = 3;

// Which family an authored swatch belongs to, read off the swatch's TEXTURE
// name rather than its numeric id, so a re-authored map that swaps one grass
// for another keeps painting grass instead of silently falling back. The three
// prefixes are the whole authored set (pinned in tests/bg_field_relief_core.test.ts);
// anything the map grows later reads as grass, the field's default ground.
function surfaceFamilyOf(texture: string): number {
  if (texture.startsWith('Cobblestone')) return BG_SURFACE_FLAGSTONE;
  if (texture.startsWith('Ground')) return BG_SURFACE_DIRT;
  return BG_SURFACE_GRASS;
}

// The plate samples the paint grid at every SECOND authored cell (0.5yd). The
// plate's finest pixel is about 0.6yd across at the sizes the map window uses,
// so a full-resolution copy would buy nothing a reader can see and would retain
// four times the bytes for the whole session.
const SURFACE_STRIDE = 2;
const SURFACE_COLS = Math.ceil(BG_PAINT_COLS / SURFACE_STRIDE);
const SURFACE_ROWS = Math.ceil(BG_PAINT_ROWS / SURFACE_STRIDE);
const SURFACE_PITCH = BG_PAINT_CELL * SURFACE_STRIDE;

let surfaceGrid: Uint8Array | null = null;

function buildSurfaceGrid(): Uint8Array {
  const byId = new Map<number, number>();
  for (const swatch of TH_PAINT_SWATCHES) byId.set(swatch.id, surfaceFamilyOf(swatch.texture));
  const dense = bgFieldPaintCells((id) => byId.get(id));
  const out = new Uint8Array(SURFACE_COLS * SURFACE_ROWS);
  for (let r = 0; r < SURFACE_ROWS; r++) {
    const src = Math.min(BG_PAINT_ROWS - 1, r * SURFACE_STRIDE) * BG_PAINT_COLS;
    for (let c = 0; c < SURFACE_COLS; c++) {
      const cell = dense[src + Math.min(BG_PAINT_COLS - 1, c * SURFACE_STRIDE)];
      // An unpainted cell (the 255 sentinel, which the authored map never
      // emits) reads as the field's default ground rather than as a hole.
      out[r * SURFACE_COLS + c] = cell <= BG_SURFACE_DIRT ? cell : BG_SURFACE_GRASS;
    }
  }
  // The graveyard plots, stamped over whatever the map painted under them. The
  // plots are point-mirrored and the grid's cell centres are symmetric about the
  // field origin, so the stamp is symmetric cell for cell: the away team's plate
  // gets the identical ground (the fairness invariant the whole plate rests on).
  for (const plot of TH_GRAVEYARDS) {
    const c0 = Math.max(0, Math.ceil((plot.x - plot.hw - BG_PAINT_ORIGIN_X) / SURFACE_PITCH));
    const c1 = Math.min(
      SURFACE_COLS - 1,
      Math.floor((plot.x + plot.hw - BG_PAINT_ORIGIN_X) / SURFACE_PITCH),
    );
    const r0 = Math.max(0, Math.ceil((plot.z - plot.hd - BG_PAINT_ORIGIN_Z) / SURFACE_PITCH));
    const r1 = Math.min(
      SURFACE_ROWS - 1,
      Math.floor((plot.z + plot.hd - BG_PAINT_ORIGIN_Z) / SURFACE_PITCH),
    );
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) out[r * SURFACE_COLS + c] = BG_SURFACE_GRAVE;
    }
  }
  return out;
}

/** The authored surface family at a field-local point, clamped to the grid. */
export function bgFieldSurfaceAt(lx: number, lz: number): number {
  if (!surfaceGrid) surfaceGrid = buildSurfaceGrid();
  const c = Math.max(
    0,
    Math.min(SURFACE_COLS - 1, Math.round((lx - BG_PAINT_ORIGIN_X) / SURFACE_PITCH)),
  );
  const r = Math.max(
    0,
    Math.min(SURFACE_ROWS - 1, Math.round((lz - BG_PAINT_ORIGIN_Z) / SURFACE_PITCH)),
  );
  return surfaceGrid[r * SURFACE_COLS + c];
}

// The plate's base palette, one entry per authored surface family, sampled from
// the field's own dressing the way RELIEF_RAMP is. Same rationale as the ramp:
// a plate palette is sampled terrain, not themeable HUD chrome, and a CSS var
// cannot be read from a raw pixel buffer.
const FAMILY_RGB: readonly (readonly [number, number, number])[] = [
  [100, 126, 74], // grass: the hollow's turf
  [154, 151, 144], // flagstone: the cobbled keeps, courts and gate aprons
  [146, 118, 82], // dirt: the worn lanes
  [112, 100, 84], // grave: the turned ash-grey earth of the two plots
];

// How much of the hypsometric ramp shows through the surface colour. High
// enough that the courtyard bowl reads darker than the keep terraces on every
// surface, low enough that turf still reads green and a cobbled lane still
// reads as stone (the ramp is a warm sand and would grey both out).
const HYPSO_MIX = 0.28;

// Vegetation mottling, per family: broad moisture patches plus a fine grain,
// the thing that stops real ground ever being one flat colour (map_terrain.ts).
// Paving barely mottles; turf mottles most, and turned grave earth nearly as
// much, which is what keeps a plot from reading as a flat printed rectangle.
const MOTTLE_GAIN: readonly number[] = [1, 0.3, 0.6, 0.8];
const MOTTLE_BROAD_FREQ = 0.09;
const MOTTLE_GRAIN_FREQ = 0.55;
const MOTTLE_BROAD_GAIN = 0.3;
const MOTTLE_GREEN_GAIN = 0.38; // moisture reads mostly in the greens
const MOTTLE_GRAIN_GAIN = 0.16;
// The map's OWN seed drives the mottle, so the plate is a deterministic
// function of the authored field (never Math.random, the sim rule, and the
// plate is compared byte for byte in tests/bg_field_relief_core.test.ts).
const MOTTLE_SEED = TH_SEED;
const MOTTLE_OCTAVES = 2;

// Contour banding. The field's whole relief is about five yards, so the step is
// a half yard rather than the overworld's six units. The band WIDTH tracks the
// local per-pixel height change, which keeps a line about a pixel and a third
// wide at any plate scale and leaves genuinely flat ground (a keep terrace
// shelf) unbanded instead of flooding it.
const CONTOUR_STEP_YD = 0.5;
const CONTOUR_LINE_PX = 1.3;
const CONTOUR_MAX_BAND = CONTOUR_STEP_YD * 0.4;
const CONTOUR_DARKEN = 0.9;

// The inked edge where one authored surface meets another: the atlas road
// verge, drawn from the paint grid instead of a road distance field.
const SURFACE_EDGE_INK = 0.74;

// Two-axis hillshade lit from the northwest. The gain is per YARD of slope and
// is scaled by the plate's pxPerYard at use, so a bigger map window shades the
// same, rather than flattening out the way a per-pixel gain would.
const ATLAS_SHADE_GAIN = 0.9;
const ATLAS_SHADE_MIN = 0.62;
const ATLAS_SHADE_MAX = 1.34;

/**
 * Paint a `w` by `h` RGBA buffer with the field's ATLAS plate.
 *
 * The pixel grid follows the map convention BOTH consumers draw in: the world's
 * east is -x, so +x runs toward column 0 (map-left), and +z runs toward row 0
 * (map-up). `originX` / `originZ` are therefore the field-local yards at the
 * buffer's top-left corner, and one pixel is `1 / pxPerYard` yards.
 *
 * `axis` is the one extra degree of freedom: +1 for the world orientation (the
 * minimap always, and the home-at-the-bottom view of team 0) and -1 for team
 * 1's M-map, which walks the point-symmetric field the other way round and so
 * produces the 180-degree-rotated plate directly. Rotating the finished raster
 * instead would carry the light around with it and leave the plate lit from the
 * southeast for one of the two teams.
 */
export function paintBgFieldAtlas(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  pxPerYard: number,
  originX: number,
  originZ: number,
  axis: 1 | -1,
): void {
  const hypso: [number, number, number] = [0, 0, 0];
  let prevH = new Float64Array(w);
  let curH = new Float64Array(w);
  const prevFamily = new Uint8Array(w);
  const shadeGain = ATLAS_SHADE_GAIN * pxPerYard;
  for (let iy = 0; iy < h; iy++) {
    const lz = originZ - axis * ((iy + 0.5) / pxPerYard);
    let leftH = 0;
    let leftFamily = 0;
    for (let ix = 0; ix < w; ix++) {
      const lx = originX - axis * ((ix + 0.5) / pxPerYard);
      const height = bgFieldHeightLocal(lx, lz);
      curH[ix] = height;
      const left = ix === 0 ? height : leftH;
      const up = iy === 0 ? height : prevH[ix];
      leftH = height;
      const family = bgFieldSurfaceAt(lx, lz);
      const familyLeft = ix === 0 ? family : leftFamily;
      const familyUp = iy === 0 ? family : prevFamily[ix];
      leftFamily = family;
      prevFamily[ix] = family;

      // Base: the authored surface, hypsometrically tinted through the shared
      // ramp so the bowl still reads deep and the terraces still read high.
      const base = FAMILY_RGB[family];
      rampRgb(height, hypso);
      let r = base[0] + (hypso[0] - base[0]) * HYPSO_MIX;
      let g = base[1] + (hypso[1] - base[1]) * HYPSO_MIX;
      let b = base[2] + (hypso[2] - base[2]) * HYPSO_MIX;

      const mottle = MOTTLE_GAIN[family];
      if (mottle > 0) {
        // The mottle is the one thing on the plate that is not point-symmetric
        // by construction: fbm is a function of the coordinates, and the
        // field's mirror negates them. Sampling it at the canonical half makes
        // it symmetric too, so both teams are handed literally the same plate
        // (the fairness invariant the walls, the paint and the heightfield all
        // already hold to) rather than two differently freckled ones.
        const fold = lz < 0 || (lz === 0 && lx < 0) ? -1 : 1;
        const mx = lx * fold;
        const mz = lz * fold;
        const broad =
          fbm2(mx * MOTTLE_BROAD_FREQ, mz * MOTTLE_BROAD_FREQ, MOTTLE_SEED, MOTTLE_OCTAVES) - 0.5;
        const grain =
          fbm2(mx * MOTTLE_GRAIN_FREQ, mz * MOTTLE_GRAIN_FREQ, MOTTLE_SEED + 1, MOTTLE_OCTAVES) -
          0.5;
        const flat = 1 + (broad * MOTTLE_BROAD_GAIN + grain * MOTTLE_GRAIN_GAIN) * mottle;
        r *= flat;
        g *= 1 + (broad * MOTTLE_GREEN_GAIN + grain * MOTTLE_GRAIN_GAIN) * mottle;
        b *= flat;
      }

      // Contours: paved ground carries none (a courtyard is cut level, and the
      // overworld plate skips its beaches for the same reason).
      if (family !== BG_SURFACE_FLAGSTONE) {
        const step = Math.max(Math.abs(height - left), Math.abs(height - up));
        const band = Math.min(step * CONTOUR_LINE_PX, CONTOUR_MAX_BAND);
        if (band > 0 && ((height % CONTOUR_STEP_YD) + CONTOUR_STEP_YD) % CONTOUR_STEP_YD < band) {
          r *= CONTOUR_DARKEN;
          g *= CONTOUR_DARKEN;
          b *= CONTOUR_DARKEN;
        }
      }

      // The inked verge: every boundary between two authored surfaces, which is
      // what turns the cobbled lanes and gate aprons into drawn roads.
      if (family !== familyLeft || family !== familyUp) {
        r *= SURFACE_EDGE_INK;
        g *= SURFACE_EDGE_INK;
        b *= SURFACE_EDGE_INK;
      }

      const shade = Math.max(
        ATLAS_SHADE_MIN,
        Math.min(ATLAS_SHADE_MAX, 1 + (height - left) * shadeGain + (height - up) * shadeGain),
      );
      const k = (iy * w + ix) * 4;
      data[k] = r * shade;
      data[k + 1] = g * shade;
      data[k + 2] = b * shade;
      data[k + 3] = OPAQUE;
    }
    const swap = prevH;
    prevH = curH;
    curH = swap;
  }
}
