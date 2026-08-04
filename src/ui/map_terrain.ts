// Pure terrain painter for the world-map / minimap background. Kept
// host-agnostic (no DOM, no canvas) so it can be unit-tested directly and so
// the heavy per-pixel work can be time-sliced across idle callbacks by the HUD
// without forking the pixel math. It writes straight into a flat RGBA buffer
// (the same `Uint8ClampedArray` an `ImageData.data` exposes).
//
// The colours sample the SAME `terrainHeight`/`roadDistance` the renderer and
// sim use, so the map always matches the real world, do not diverge them.
//
// The style is a hand-drawn fantasy atlas plate: the landmass sits on the
// sea like a carved slab (an inked cliff edge on its shadow side and a cast
// shadow in the water), mountains are drawn caret glyphs with lit faces and
// snow caps, forests are clumped painted crowns, and beneath those the
// relief work remains: two-axis hillshade lit from the northwest, contour
// lines, depth-graded water with shallow foam, wet and dry sand shorelines,
// hypsometric tinting, fbm vegetation mottling, rock exposure on steep
// slopes, and worn dirt tracks with wobbling width and inked edges.
import {
  COLUMN_ZONES,
  columnBlendAt,
  STRIP_MAX_X,
  STRIP_MIN_X,
  STRIP_ZONES,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
} from '../sim/data';
import { fbm2, hash2 } from '../sim/rng';
import type { BiomeId, ZoneDef } from '../sim/types';
import {
  inGardenMazeWall,
  inHollowOpenSea,
  roadDistance,
  terrainHeight,
  WATER_LEVEL,
  zoneBiomeAt,
} from '../sim/world';
import { openSeaNearness } from './map_open_sea_edge_core';

export interface MapRegion {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Plate detail, in pixels per world yard. The value the 480px plates carried
 *  over a zone's 360yd width before they were squared, kept so squaring the
 *  plate widened the world it covers WITHOUT thinning the detail inside it. */
export const MAP_PLATE_PX_PER_YD = 480 / 360;

/** The pixel width a region's plate bakes at: the ONE definition the bake, the
 *  manifest and the freshness guard share, now that a plate's width follows its
 *  region rather than a single constant for every zone. */
export function mapPlateWidth(region: MapRegion): number {
  return Math.round((region.maxX - region.minX) * MAP_PLATE_PX_PER_YD);
}

// Pixel height of a W-wide terrain canvas covering `region` (square-pixel).
export function mapCanvasHeight(W: number, region: MapRegion): number {
  return Math.round((W * (region.maxZ - region.minZ)) / (region.maxX - region.minX));
}

/** The band a world-map plate covers. ONE definition shared by the HUD painter,
 *  the build-time plate bake (scripts/build_map_backgrounds.mjs), and the
 *  freshness guard, so they can never drift apart.
 *
 *  It covers the SQUARE the map window frames, not the zone's own rectangle. The
 *  window frames a square of the zone's longer side (map_window_view), so for
 *  every zone taller than it is wide the plate used to stop short of the view and
 *  the painter filled the rest with flat ocean: a hard-edged lighter box pasted
 *  on a flat sea, showing open water where the neighbouring zone's land actually
 *  continues. Squaring the plate paints that margin with the real world instead. */
export function mapZoneRegion(zone: ZoneDef): MapRegion {
  const minX = zone.xMin ?? STRIP_MIN_X;
  const maxX = zone.xMax ?? STRIP_MAX_X;
  const side = Math.max(maxX - minX, zone.zMax - zone.zMin);
  const cx = (minX + maxX) / 2;
  const cz = (zone.zMin + zone.zMax) / 2;
  // CLAMPED to the world. terrainHeight answers for any coordinate, including
  // past the world's edge, so an unclamped square paints unreachable generator
  // terrain as though it were a coastline the player could sail to (the
  // Wraithwood's square reaches 100 yd past WORLD_MAX_X). Beyond the edge the
  // painter's flat ocean fill is the honest answer, and it is seamless now that
  // the fill matches the sea ramp's deep end.
  return {
    minX: Math.max(WORLD_MIN_X, cx - side / 2),
    maxX: Math.min(WORLD_MAX_X, cx + side / 2),
    minZ: Math.max(WORLD_MIN_Z, cz - side / 2),
    maxZ: Math.min(WORLD_MAX_Z, cz + side / 2),
  };
}

/** FNV-1a hash (hex) of the first `rows` painted rows of a zone plate: the
 *  cheap freshness fingerprint the bake stores and the guard test recomputes,
 *  so a world-generation change reddens CI until the plates are re-baked. */
export function hashPaintedRows(region: MapRegion, seed: number, W: number, rows: number): string {
  const H = mapCanvasHeight(W, region);
  const n = Math.min(rows, H);
  const data = new Uint8ClampedArray(W * H * 4);
  paintTerrainRows(data, W, H, region, seed, 0, n);
  let h = 0x811c9dc5;
  const end = W * n * 4;
  for (let i = 0; i < end; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// The sea's single shallow-to-deep ramp. One body of water instead of the two
// palettes that used to meet at the swim-fatigue predicate's straight rect
// edge. The deep end matches --color-map-ocean, the flat fill the painter puts
// beyond a plate, so a plate edge leaves no seam.
const SEA_SHALLOW_R = 100;
const SEA_SHALLOW_G = 164;
const SEA_SHALLOW_B = 200;
const SEA_DEEP_R = 26;
const SEA_DEEP_G = 58;
const SEA_DEEP_B = 100;
// Where the lethal open sea starts on that ramp: deep enough to read as open
// ocean at a glance, close enough that the two sides are one sea. Safe water
// approaching the limit climbs to meet it.
//
// The limit is NOT drawn on the map, and deliberately so. The sim already
// states it where it matters (src/sim/fatigue.ts): crossing raises an on-screen
// error toast repeated every 4s, a log line, and 8 seconds of grace before the
// first damage pulse, which is real time to turn around. A rule drawn across
// open water would restate that less well (the swimmer is looking at the world,
// not the map) at the cost of a straight line through the sea, so the map keeps
// only what a map is good at: water that deepens as the world does.
const OPEN_SEA_RAMP_FLOOR = 0.62;

// How thick the tree cover stipples per biome (chance per ~1.3yd hash cell).
const FOREST_STIPPLE: Partial<Record<ReturnType<typeof zoneBiomeAt>, number>> = {
  vale: 0.4,
  marsh: 0.26,
  peaks: 0.2,
  dusk: 0.3,
  ember: 0.22,
  frost: 0.14,
  amber: 0.44,
  fen: 0.24,
  night: 0.2,
  haunt: 0.55, // the canopy is the realm
  jungle: 0.6, // wall-to-wall green
  garden: 0.34,
  gale: 0.12, // near-treeless downs
};

const CONTOUR_STEP = 6; // height units between contour lines
const CONTOUR_WIDTH = 0.42; // how much height-band each line inks

// Paint rows [y0, y1) of a W×H RGBA buffer for `region`. Splitting by whole
// rows is what lets the prewarm chunk the work: the per-row state is the
// current and previous rows' heights, and a chunk's FIRST row recomputes its
// previous row explicitly (same math, same values), so a chunked render is
// byte-identical to a single-pass one (guarded by tests/map_terrain.test.ts).
// The per-biome base land colour. Flat for most biomes; ember and frost carry
// a position-graded tint (the same corridors the 3D map uses). Returned into
// the scratch triple to avoid per-pixel allocation.
function biomeBaseColor(biome: BiomeId, x: number, z: number, out: [number, number, number]): void {
  switch (biome) {
    case 'marsh':
      out[0] = 64;
      out[1] = 86;
      out[2] = 48;
      return;
    case 'peaks':
      out[0] = 92;
      out[1] = 100;
      out[2] = 82;
      return;
    case 'dusk':
      out[0] = 96;
      out[1] = 84;
      out[2] = 104;
      return;
    case 'amber':
      out[0] = 168;
      out[1] = 130;
      out[2] = 58;
      return;
    case 'night':
      out[0] = 118;
      out[1] = 106;
      out[2] = 168;
      return;
    case 'haunt':
      out[0] = 48;
      out[1] = 56;
      out[2] = 44;
      return;
    case 'garden':
      out[0] = 82;
      out[1] = 148;
      out[2] = 72;
      return;
    case 'gale':
      out[0] = 96;
      out[1] = 138;
      out[2] = 92;
      return;
    case 'ember': {
      const sandT = Math.max(0, Math.min(1, (z - 1925) / 145));
      let r = 74 + 76 * sandT;
      let g = 110 + 10 * sandT;
      let bb = 52 + 32 * sandT;
      const passT = 1 - Math.max(0, Math.min(1, (Math.abs(x - 404) - 26) / 26));
      const valley = passT * Math.max(0, Math.min(1, (z - 2310) / 80));
      const scorch = Math.max(0, Math.min(1, (z - 2260) / 100)) * (1 - valley);
      r = r * (1 - scorch * 0.35) - 60 * valley * (sandT > 0 ? 1 : 0);
      g = g * (1 - scorch * 0.45);
      bb = bb * (1 - scorch * 0.4) - 25 * valley;
      out[0] = r;
      out[1] = g;
      out[2] = bb;
      return;
    }
    case 'frost': {
      const passT = 1 - Math.max(0, Math.min(1, (Math.abs(z - 1890) - 26) / 26));
      const green = passT * Math.max(0, Math.min(1, (Math.abs(x) - 95) / 85));
      const snowline = 1 - green;
      out[0] = 74 + 140 * snowline;
      out[1] = 110 + 114 * snowline;
      out[2] = 52 + 184 * snowline;
      return;
    }
    default:
      out[0] = 58;
      out[1] = 105;
      out[2] = 48;
      return; // vale / fen / jungle
  }
}

// The blended land colour at a point: the same cross-border blend the 3D
// terrain uses (paletteAt), so adjacent maps' colours fade into each other
// (e.g. the Hollow's dusk purple slowly turning snowy toward the Frostveil)
// instead of meeting at a hard seam. Strip bands blend by z over the -30/+35
// window; columns blend in sideways via columnBlendAt.
const _lc: [number, number, number] = [0, 0, 0];
function landColorAt(x: number, z: number, out: [number, number, number]): void {
  biomeBaseColor(STRIP_ZONES[0].biome, x, z, out);
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const boundary = STRIP_ZONES[i].zMax;
    const tt = Math.max(0, Math.min(1, (z - (boundary - 30)) / 65));
    const t = tt * tt * (3 - 2 * tt);
    if (t <= 0) continue;
    biomeBaseColor(STRIP_ZONES[i + 1].biome, x, z, _lc);
    out[0] += (_lc[0] - out[0]) * t;
    out[1] += (_lc[1] - out[1]) * t;
    out[2] += (_lc[2] - out[2]) * t;
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t <= 0) continue;
    biomeBaseColor(col.biome, x, z, _lc);
    out[0] += (_lc[0] - out[0]) * t;
    out[1] += (_lc[1] - out[1]) * t;
    out[2] += (_lc[2] - out[2]) * t;
  }
}

const _land: [number, number, number] = [0, 0, 0];

export interface PaintRowCarry {
  // Heights of the row just above y0, saved by the previous chunk. When a
  // caller paints consecutive chunks (the HUD's sliced prewarm), threading
  // this through skips the chunk-start recompute of that row: with one-row
  // slices the recompute would otherwise DOUBLE the total work. The values
  // are the exact ones the recompute would produce, so output is unchanged.
  prevRow: Float64Array<ArrayBufferLike> | null;
}

export function paintTerrainRows(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  region: MapRegion,
  seed: number,
  y0: number,
  y1: number,
  carry?: PaintRowCarry,
): void {
  const spanX = region.maxX - region.minX;
  const spanZ = region.maxZ - region.minZ;
  const worldX = (ix: number) => region.maxX - (ix / W) * spanX;
  const worldZ = (iy: number) => region.maxZ - (iy / H) * spanZ;

  // Heights of the row ABOVE the one being painted, for the north-south
  // hillshade component and the coastline stroke. Seeded from the carry when
  // the caller threaded one through, else from a real sample pass at a
  // chunk's first row (same math, same values), so chunked output never
  // drifts from a single-pass render either way.
  let prevRow: Float64Array<ArrayBufferLike>;
  let curRow: Float64Array<ArrayBufferLike> = new Float64Array(W);
  if (y0 > 0 && carry?.prevRow && carry.prevRow.length === W) {
    prevRow = carry.prevRow;
  } else {
    prevRow = new Float64Array(W);
    if (y0 > 0) {
      const zUp = worldZ(y0 - 1);
      for (let ix = 0; ix < W; ix++) prevRow[ix] = terrainHeight(worldX(ix), zUp, seed);
    }
  }

  for (let iy = y0; iy < y1; iy++) {
    let leftH = 0; // height of the left-neighbour pixel
    for (let ix = 0; ix < W; ix++) {
      // +Z up, +X LEFT: facing 0 is +Z ("north") and turning right decreases
      // facing, so the world's east is -X, and drawing +X to the right
      // mirrored the whole map east-west
      const x = worldX(ix);
      const z = worldZ(iy);
      const h = terrainHeight(x, z, seed);
      curRow[ix] = h;
      const left = ix === 0 ? h : leftH;
      const up = iy === 0 ? h : prevRow[ix];
      leftH = h;
      const biome = zoneBiomeAt(x, z);
      let r = 58,
        g = 105,
        b = 48;

      if (h < WATER_LEVEL) {
        // -- water: ONE ocean ramp from shallow to deep, walked by two things:
        // the terrain's own depth, and how near the point is to the sim's
        // swim-fatigue limit (inHollowOpenSea), past which the ramp simply
        // starts deep. The two used to be separate palettes a stark distance
        // apart, meeting at that predicate's straight rect edge, which is what
        // made the map read as a lighter box pasted on a flat navy sea. The map
        // no longer marks that boundary at all (see OPEN_SEA_RAMP_FLOOR: the sim
        // states it far better, in the world, at the moment of crossing), so the
        // sea is one continuous body: nearer the open sea means deeper water,
        // which is what a chart says there anyway.
        const t = Math.min(1, (WATER_LEVEL - h) / 8);
        const depth = t * t * (3 - 2 * t);
        let ramp: number;
        if (inHollowOpenSea(x, z)) {
          ramp = OPEN_SEA_RAMP_FLOOR + (1 - OPEN_SEA_RAMP_FLOOR) * depth;
        } else {
          const near = openSeaNearness(x, z, inHollowOpenSea);
          const approach = near > 0 ? near * near * (3 - 2 * near) : 0;
          ramp = Math.max(depth * (1 - OPEN_SEA_RAMP_FLOOR), approach * OPEN_SEA_RAMP_FLOOR);
        }
        r = SEA_SHALLOW_R + (SEA_DEEP_R - SEA_SHALLOW_R) * ramp;
        g = SEA_SHALLOW_G + (SEA_DEEP_G - SEA_SHALLOW_G) * ramp;
        b = SEA_SHALLOW_B + (SEA_DEEP_B - SEA_SHALLOW_B) * ramp;
        const chop = (hash2(Math.round(x * 0.6), Math.round(z * 0.6), seed + 811) - 0.5) * 3.5;
        r += chop;
        g += chop;
        b += chop;
        // breaking foam on the shallowest fringe, just off the sand
        const foam = 1 - Math.min(1, (WATER_LEVEL - h) / 0.4);
        if (foam > 0) {
          r += (150 - r) * foam * 0.6;
          g += (188 - g) * foam * 0.6;
          b += (198 - b) * foam * 0.6;
        }
        // the land slab's cast shadow on the sea (light from screen
        // top-left; screen right/down = world -x/-z, so the caster sits at
        // world +x,+z)
        if (terrainHeight(x + 2.4, z + 2.4, seed) >= WATER_LEVEL) {
          r *= 0.66;
          g *= 0.66;
          b *= 0.7;
        } else if (terrainHeight(x + 4.8, z + 4.8, seed) >= WATER_LEVEL) {
          r *= 0.84;
          g *= 0.84;
          b *= 0.87;
        }
        if (left >= WATER_LEVEL || up >= WATER_LEVEL) {
          // the ink line where the sea meets the land
          r *= 0.45;
          g *= 0.45;
          b *= 0.5;
        }
        const k = (iy * W + ix) * 4;
        data[k] = r;
        data[k + 1] = g;
        data[k + 2] = b;
        data[k + 3] = 255;
        continue;
      }

      // -- land base colour: blended across borders so neighbouring maps'
      // palettes fade into each other (no hard colour seam) --
      landColorAt(x, z, _land);
      r = _land[0];
      g = _land[1];
      b = _land[2];

      // -- high ground overrides (crag/snow tints per biome, as before) --
      if (biome === 'dusk' && h > 26) {
        r = 60;
        g = 50;
        b = 72;
      } else if (biome === 'dusk' && h > 18) {
        r = 78;
        g = 68;
        b = 88;
      } else if (biome === 'ember' && h > 20) {
        r = 84;
        g = 58;
        b = 52;
      } else if (biome === 'frost' && h > 22) {
        r = 188;
        g = 199;
        b = 214;
      } else if (biome === 'amber' && h > 20) {
        r = 128;
        g = 92;
        b = 58;
      } else if (biome === 'night' && h > 20) {
        r = 154;
        g = 140;
        b = 190;
      } else if (biome === 'haunt' && h > 20) {
        r = 82;
        g = 86;
        b = 78;
      } else if (biome === 'jungle' && h > 20) {
        // vine-hung volcanic stone
        r = 96;
        g = 104;
        b = 84;
      } else if (biome === 'garden' && inGardenMazeWall(x, z)) {
        // the hedge walls: the Great Maze draws itself onto the map from
        // the exact wall bands movement blocks on (the walls are modeled
        // props over flat lawn now, not terrain)
        r = 40;
        g = 84;
        b = 42;
      } else if (biome === 'gale' && h > 20) {
        // salt-grey headland crags
        r = 118;
        g = 122;
        b = 126;
      } else if (biome === 'frost' && h > 6) {
        r = 202;
        g = 212;
        b = 226;
      } else if (h > 26) {
        // generic ridge / peak rock+snow
        r = 168;
        g = 172;
        b = 178;
      } else if (h > 11) {
        r = 112;
        g = 110;
        b = 102;
      } else if (h > 6) {
        r = 88;
        g = 102;
        b = 62;
      }

      const shore = h - WATER_LEVEL;
      const yardsPerPx = spanX / W;
      // slope in height-per-yard, resolution-independent, from the same
      // neighbours the hillshade uses
      const slope = Math.max(Math.abs(h - left), Math.abs(h - up)) / Math.max(yardsPerPx, 0.001);

      // -- hypsometric tint: valleys lush, high ground dry and pale --
      const lift = Math.max(0, Math.min(1, (h - 2) / 26));
      r += (30 - r * 0.06) * lift * 0.5;
      g += (16 - g * 0.05) * lift * 0.4;
      b *= 1 - lift * 0.08;

      // -- vegetation mottle: broad moisture patches + fine ground texture,
      // the thing that stops real land ever being one flat color --
      const veg = fbm2(x * 0.045, z * 0.045, seed + 601, 2) - 0.5;
      const grain = fbm2(x * 0.3, z * 0.3, seed + 613, 2) - 0.5;
      const mottle = 1 + veg * 0.16 + grain * 0.1;
      r *= mottle;
      g *= 1 + veg * 0.2 + grain * 0.1; // moisture reads mostly in the greens
      b *= mottle;

      // -- rock exposure: steep faces shed their vegetation --
      const rockT = Math.max(0, Math.min(1, (slope - 0.55) / 0.6));
      if (rockT > 0) {
        const rr = 122 + grain * 40;
        const rg = 116 + grain * 40;
        const rb = 106 + grain * 36;
        r += (rr - r) * rockT * 0.85;
        g += (rg - g) * rockT * 0.85;
        b += (rb - b) * rockT * 0.85;
      }

      // -- the carved slab edge: the coast facing away from the light is
      // cut as a dark cliff band, the lit coast gets a bright rim --
      if (shore < 4) {
        if (terrainHeight(x - 2.2, z - 2.2, seed) < WATER_LEVEL) {
          r *= 0.5;
          g *= 0.5;
          b *= 0.52;
        } else if (terrainHeight(x + 2.2, z + 2.2, seed) < WATER_LEVEL) {
          r = Math.min(255, r * 1.22 + 14);
          g = Math.min(255, g * 1.22 + 14);
          b = Math.min(255, b * 1.18 + 10);
        }
      }

      // -- the shoreline: a wet dark line at the waterline, dry pale sand above --
      if (shore < 1.6) {
        const t = 1 - shore / 1.6;
        if (shore < 0.5) {
          const wet = 1 - shore / 0.5;
          r += (128 - r) * wet * 0.8;
          g += (114 - g) * wet * 0.8;
          b += (88 - b) * wet * 0.8;
        } else {
          r += (176 - r) * t * 0.7;
          g += (160 - g) * t * 0.7;
          b += (122 - b) * t * 0.7;
        }
      }

      // -- forests: clumped painted crowns (round blobs with a lit rim on
      // the northwest, the hand-drawn-map read), kept off exposed rock --
      const density = FOREST_STIPPLE[biome] ?? 0.3;
      if (h < 22 && shore > 1.2 && rockT < 0.4) {
        const cx = Math.floor(x / 2.4);
        const cz = Math.floor(z / 2.4);
        const cell = hash2(cx, cz, seed + 271);
        if (cell < density) {
          const jx = (hash2(cx, cz, seed + 277) - 0.5) * 0.5;
          const jz = (hash2(cz, cx, seed + 283) - 0.5) * 0.5;
          const u = x / 2.4 - cx - 0.5 + jx;
          const v = z / 2.4 - cz - 0.5 + jz;
          const rad = 0.3 + cell * 0.45;
          const d = Math.sqrt(u * u + v * v);
          if (d < rad) {
            const crown = 0.62 + cell * 0.25;
            r *= crown;
            g *= crown * 1.1; // crowns keep a green cast
            b *= crown;
            // the lit rim toward the light (world +x,+z)
            if (u > rad * 0.25 && v > rad * 0.25) {
              r *= 1.3;
              g *= 1.3;
              b *= 1.25;
            }
          }
        }
      }

      // -- topographic contour lines (skip the beach so the coast stays
      // sand, and the high ground where the mountain glyphs take over) --
      if (shore > 1.6 && h <= 14) {
        const f = ((h % CONTOUR_STEP) + CONTOUR_STEP) % CONTOUR_STEP;
        if (f < CONTOUR_WIDTH) {
          r *= 0.78;
          g *= 0.78;
          b *= 0.78;
        }
      }

      // -- mountain glyphs: the hand-drawn caret marks every fantasy map
      // ranges its highlands with, inked with a lit northwest face (and a
      // snow-white one on frozen ground). The garden's hedge walls live in
      // the same height band and are hedges, not peaks: no carets there --
      // the dusk realm's low border humps read as land, not crags: only its
      // real peaks carry caret glyphs, so the mountain ring is sparse and
      // organic rather than a solid inked wall along the map edge
      const caretMin = biome === 'dusk' ? 21 : 14;
      if (h > caretMin && !(biome === 'garden' && h <= 26)) {
        const gx = Math.floor(x / 7);
        const gz = Math.floor(z / 7);
        if (hash2(gx, gz, seed + 431) < 0.85) {
          const jx = (hash2(gx, gz, seed + 433) - 0.5) * 0.24;
          const jz = (hash2(gz, gx, seed + 437) - 0.5) * 0.24;
          const u = x / 7 - gx - 0.5 + jx;
          const v = z / 7 - gz - 0.5 + jz;
          // the caret: apex up-screen (v positive is screen-up in world +z)
          const ridge = 0.2 - 1.3 * Math.abs(u);
          const strokeW = Math.max(0.06, (yardsPerPx / 7) * 1.2);
          if (Math.abs(u) < 0.34 && v > -0.26 && v < ridge + strokeW) {
            const snowy = biome === 'frost' || biome === 'peaks' || h > 26;
            if (v > ridge - strokeW) {
              // the inked ridge line
              r *= 0.4;
              g *= 0.4;
              b *= 0.42;
            } else if (u < 0) {
              // the shadowed southeast face
              r *= 0.62;
              g *= 0.62;
              b *= 0.64;
            } else if (snowy) {
              // the lit face carries the snow
              r = r * 0.3 + 205 * 0.7;
              g = g * 0.3 + 212 * 0.7;
              b = b * 0.3 + 222 * 0.7;
            } else {
              r *= 1.28;
              g *= 1.24;
              b *= 1.18;
            }
          }
        }
      }

      // -- settlements and roads over everything --
      let nearHub = false;
      let hubRing = false;
      for (const zn of ZONES) {
        const d = Math.hypot(x - zn.hub.x, z - zn.hub.z);
        if (d < 11) {
          nearHub = true;
          break;
        }
        if (d < 14) {
          hubRing = true;
          break;
        }
      }
      if (nearHub) {
        r = 146;
        g = 118;
        b = 80;
      } else if (hubRing) {
        r = 74;
        g = 58;
        b = 40;
      } else {
        const road = roadDistance(x, z);
        if (road < 4.2) {
          // a worn dirt track, not a painted band: the width wobbles like a
          // real path, the middle is packed pale by feet and wheels, and the
          // verge is inked so it reads against every ground color
          const wobble = (fbm2(x * 0.3, z * 0.3, seed + 911, 2) - 0.5) * 0.9;
          const core = 2.0 + wobble;
          if (road < core * 0.45) {
            r = 178;
            g = 152;
            b = 110;
          } else if (road < core) {
            r = 156;
            g = 128;
            b = 88;
          } else if (road < core + 1.0) {
            r *= 0.7;
            g *= 0.7;
            b *= 0.7;
          }
        }
      }

      // -- two-axis hillshade, lit from the northwest --
      const shade = Math.max(0.6, Math.min(1.42, 1 + (h - left) * 0.13 + (h - up) * 0.13));
      r = Math.min(255, r * shade);
      g = Math.min(255, g * shade);
      b = Math.min(255, b * shade);

      const k = (iy * W + ix) * 4;
      data[k] = r;
      data[k + 1] = g;
      data[k + 2] = b;
      data[k + 3] = 255;
    }
    // the just-painted row becomes the next row's "up" neighbours
    const swap = prevRow;
    prevRow = curRow;
    curRow = swap;
  }
  // hand the last painted row's heights to the caller's next chunk
  if (carry) carry.prevRow = prevRow;
}
