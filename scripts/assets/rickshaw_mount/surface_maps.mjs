// Procedural PBR map sets for the Bonebound Rickshaw, rastered in Node with
// sharp. Sibling to scripts/assets/terrorspark_groundshaker/surface_maps.mjs
// (the tank mount's look-dev pass) and deliberately built the same way:
// three independent fields per material (albedo detail, tangent normal,
// packed occlusion/roughness/metalness), all derived from the shared
// periodic noise in terrorspark_groundshaker/surface_shading.mjs so the
// tiling maps and the baked vertex pass (shadeSurfaceInto, wired into
// model.js's shadeAllParts) agree. Deterministic: integer hashes only, no
// Math.random, so a re-export is byte-reproducible.
//
// Four material families instead of the tank's two. Bronze reuses the
// tank's own `buildMetalAlbedo`/`buildMetalRelief` directly (a rivet is a
// rivet; only the tuning numbers and tint differ) and the crest banner
// reuses `buildFabricAlbedo`/`buildFabricRelief` the same way: both are
// exported from that file already, imported below. Wood and leather have no
// analog there and are authored fresh in this file.
//
// Why this file also duplicates a handful of small private helpers
// (blurWrapped, normalFromHeight, buildOrm, albedoBytes, encodeGray/Rgb,
// toByte, clamp01, lerp, smoothstep, wrapPixel, stampBlob) instead of
// importing them: `surface_maps.mjs` is, like `surface_shading.mjs`, a
// pinned source-fingerprint input for the TANK's own export
// (source_fingerprint.mjs's TANK_SOURCE_FILES). Those helpers aren't
// exported from that file, and adding `export` to them would still edit a
// pinned file byte-for-byte, forcing an unrelated tank re-export just to
// build the rickshaw's textures. The functions actually exported
// (buildMetalAlbedo/buildMetalRelief/buildFabricAlbedo/buildFabricRelief/
// NORMAL_SCALE) ARE imported, not duplicated, since importing them costs
// nothing on the tank's side.

import sharp from 'sharp';
import {
  buildFabricAlbedo,
  buildFabricRelief,
  buildMetalAlbedo,
  buildMetalRelief,
  NORMAL_SCALE,
} from '../terrorspark_groundshaker/surface_maps.mjs';
import {
  hash2,
  ORM_CENTER,
  periodicFbm2,
  periodicNoise2,
} from '../terrorspark_groundshaker/surface_shading.mjs';

export { NORMAL_SCALE };

// Resolution is per MAP, not per material, same reasoning as the tank: the
// world-space box projection (boxProjectUvInto) fixes texel density in
// yards, so each channel only needs the resolution its own highest useful
// band asks for.
export const RICKSHAW_MAP_SPECS = Object.freeze({
  wood: Object.freeze({
    albedoSize: 1024,
    reliefSize: 512,
    // Board width as a fraction of one UV tile (boxProjectUvInto repeats
    // every 1 world yard at this material's uvScale, see model.js's
    // RICKSHAW_MATERIAL_CONTRACT): a real plank runs 4-6 per yard-wide panel.
    boardsPerTile: 5,
    knots: 14,
  }),
  bronze: Object.freeze({ albedoSize: 1024, reliefSize: 512, scratches: 70, chips: 40 }),
  leather: Object.freeze({ albedoSize: 1024, reliefSize: 512, tuftsPerTile: 3 }),
  fabric: Object.freeze({ albedoSize: 512, reliefSize: 256, pebblePeriod: 9, weavePeriod: 15 }),
});

const SEEDS = Object.freeze({
  woodMacro: 60_121,
  woodGrain: 60_427,
  woodRings: 60_733,
  woodSpeckle: 61_039,
  woodKnot: 61_349,
  woodHeightGrain: 62_143,
  woodHeightMicro: 62_449,
  leatherGrain: 70_151,
  leatherPore: 70_457,
  leatherTuft: 70_763,
});

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function encodeSrgb(linear) {
  const value = clamp01(linear);
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function toByte(unit) {
  return Math.max(0, Math.min(255, Math.round(clamp01(unit) * 255)));
}

function wrapPixel(value, size) {
  return ((value % size) + size) % size;
}

function stampBlob(field, size, centerX, centerY, radius, amount) {
  const span = Math.ceil(radius);
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;
      const falloff = 1 - smoothstep(0, radius, distance);
      const x = wrapPixel(Math.round(centerX) + dx, size);
      const y = wrapPixel(Math.round(centerY) + dy, size);
      const index = y * size + x;
      field[index] = Math.max(field[index], falloff * amount);
    }
  }
}

function blurWrapped(field, size, radius) {
  const horizontal = new Float32Array(size * size);
  const window = radius * 2 + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        sum += field[y * size + wrapPixel(x + offset, size)];
      }
      horizontal[y * size + x] = sum / window;
    }
  }
  const blurred = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        sum += horizontal[wrapPixel(y + offset, size) * size + x];
      }
      blurred[y * size + x] = sum / window;
    }
  }
  return blurred;
}

function normalFromHeight(height, size, slope) {
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = height[y * size + wrapPixel(x - 1, size)];
      const right = height[y * size + wrapPixel(x + 1, size)];
      const down = height[wrapPixel(y - 1, size) * size + x];
      const up = height[wrapPixel(y + 1, size) * size + x];
      const dx = (right - left) * slope;
      const dy = (up - down) * slope;
      const length = Math.hypot(dx, dy, 1);
      const offset = (y * size + x) * 3;
      rgb[offset] = toByte((-dx / length) * 0.5 + 0.5);
      rgb[offset + 1] = toByte((-dy / length) * 0.5 + 0.5);
      rgb[offset + 2] = toByte((1 / length) * 0.5 + 0.5);
    }
  }
  return rgb;
}

async function encodeGray(pixels, size, quality) {
  return sharp(pixels, { raw: { width: size, height: size, channels: 1 } })
    .webp({ quality, effort: 6, alphaQuality: 100 })
    .toBuffer();
}

async function encodeRgb(pixels, size, quality) {
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
    .webp({ quality, effort: 6, alphaQuality: 100 })
    .toBuffer();
}

function buildOrm(height, size, options) {
  const mean = blurWrapped(height, size, options.cavityRadius);
  const rgb = Buffer.alloc(size * size * 3);
  for (let index = 0; index < height.length; index++) {
    const concavity = clamp01((mean[index] - height[index]) * options.cavityGain);
    const convexity = clamp01((height[index] - mean[index]) * options.cavityGain);
    const wear = options.wear ? clamp01(options.wear[index]) : 0;
    const occlusion = 1 - options.occlusionDepth * concavity;
    const roughness =
      ORM_CENTER * (1 + options.roughCavity * concavity - options.roughWear * (convexity + wear));
    const metalness = ORM_CENTER * (1 + (options.metalWear ?? 0) * wear);
    const offset = index * 3;
    rgb[offset] = toByte(occlusion);
    rgb[offset + 1] = toByte(roughness);
    rgb[offset + 2] = toByte(metalness);
  }
  return rgb;
}

function albedoBytes(albedo, size) {
  const gray = Buffer.alloc(size * size);
  for (let index = 0; index < albedo.length; index++) {
    gray[index] = toByte(encodeSrgb(albedo[index]));
  }
  return gray;
}

// ---------------------------------------------------------------------------
// Wood: frame, seat structure, wheel spokes, shafts.
// ---------------------------------------------------------------------------

/** Distance in [0, 0.5] to the nearest board seam along u, given `boardsPerTile`
 *  boards per UV tile. Board widths are jittered per-board (real planks aren't
 *  perfectly even), so the seam grid isn't a perfect comb. */
function woodSeamDistance(u, count) {
  const raw = u * count;
  const board = Math.floor(raw);
  const jitterA = hash2(board, 0, SEEDS.woodGrain) * 0.18 - 0.09;
  const jitterB = hash2(board + 1, 0, SEEDS.woodGrain) * 0.18 - 0.09;
  const frac = raw - board;
  const localSeam = Math.min(frac - jitterA, 1 - frac + jitterB, frac, 1 - frac);
  return Math.max(0, localSeam);
}

function woodKnotField(size, count) {
  const field = new Float32Array(size * size);
  for (let index = 0; index < count; index++) {
    const centerX = hash2(index, 1, SEEDS.woodKnot) * size;
    const centerY = hash2(index, 2, SEEDS.woodKnot) * size;
    const radius = lerp(size * 0.012, size * 0.026, hash2(index, 3, SEEDS.woodKnot));
    stampBlob(field, size, centerX, centerY, radius, 1);
  }
  return field;
}

/** Grain runs long and mostly straight along v (the board's length): high
 *  `aspect` in periodicFbm2 stretches the noise band that direction, the
 *  same technique the tank uses for brushed-metal streaks. Growth rings cut
 *  across the grain at a much lower frequency and a gentle opposite stretch,
 *  which is what keeps them reading as rings instead of a second grain. */
// 2026-08-08: grain amplitude raised (albedo 0.12->0.24, relief 0.22->0.36)
// and tightened (period 9->12, aspect 8->11) after a live look asked for more
// visible wood grain; macro's own amplitude pulled back a little (0.14->0.09)
// so the broad board-to-board tone variation doesn't wash the grain lines
// back out now that they're stronger.
function woodBands(u, v) {
  const grain = periodicFbm2(u, v, 12, 4, SEEDS.woodGrain, 11) - 0.5;
  const rings = periodicFbm2(u, v, 4, 3, SEEDS.woodRings, 0.35) - 0.5;
  const macro = periodicFbm2(u, v, 3, 3, SEEDS.woodMacro) - 0.5;
  const speckle = periodicNoise2(u * 90, v * 90, 90, 90, SEEDS.woodSpeckle) - 0.5;
  return { grain, rings, macro, speckle };
}

export function buildWoodAlbedo(size, spec) {
  const knot = woodKnotField(size, spec.knots);
  const albedo = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const index = y * size + x;
      const { grain, rings, macro, speckle } = woodBands(u, v);
      const seamDist = woodSeamDistance(u, spec.boardsPerTile);
      const seam = 1 - smoothstep(0, 0.012, seamDist);
      const knotCore = smoothstep(0.5, 1, knot[index]);
      const knotRing = knot[index] - knotCore;
      const base = 0.97 + macro * 0.09 + grain * 0.24 + rings * 0.05 + speckle * 0.04;
      albedo[index] = clamp01(base - seam * 0.4 - knotCore * 0.3 + knotRing * 0.12);
    }
  }
  return albedo;
}

export function buildWoodRelief(size, spec) {
  const knot = woodKnotField(size, spec.knots);
  const height = new Float32Array(size * size);
  const wear = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const index = y * size + x;
      const grainRidge = periodicFbm2(u, v, 12, 4, SEEDS.woodHeightGrain, 11) - 0.5;
      const micro = periodicFbm2(u, v, 60, 2, SEEDS.woodHeightMicro) - 0.5;
      const seamDist = woodSeamDistance(u, spec.boardsPerTile);
      const seamGroove = 1 - smoothstep(0, 0.02, seamDist);
      height[index] = clamp01(
        0.55 + grainRidge * 0.36 + micro * 0.08 - seamGroove * 0.4 - knot[index] * 0.22,
      );
      wear[index] = seamGroove * 0.5;
    }
  }
  return { height, wear };
}

// ---------------------------------------------------------------------------
// Leather: the tufted seat cushion.
// ---------------------------------------------------------------------------

/** Diamond-quilt tuft grid: buttons sit at the grid intersections (a
 *  jittered-grid F1 distance, same shape as the tank's fabricPebble but at a
 *  much coarser period, one "cell" per tuft rather than per grain), the
 *  leather bulges gently between them (a smooth 2D wave peaking at each cell
 *  center) and is pinched sharply AT each intersection (a narrow stampBlob
 *  dip), which is what actually reads as "tufted" rather than just bumpy. */
function leatherTuftField(size, tuftsPerTile) {
  const bulge = new Float32Array(size * size);
  const pinch = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * tuftsPerTile;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * tuftsPerTile;
      const index = y * size + x;
      bulge[index] =
        Math.sin(u * Math.PI * 2 - Math.PI / 2) * Math.sin(v * Math.PI * 2 - Math.PI / 2) * 0.5 +
        0.5;
    }
  }
  for (let gy = 0; gy <= tuftsPerTile; gy++) {
    for (let gx = 0; gx <= tuftsPerTile; gx++) {
      const px = (gx / tuftsPerTile) * size;
      const py = (gy / tuftsPerTile) * size;
      const jitterRadius = size * 0.006;
      const jx = px + (hash2(gx, gy, SEEDS.leatherTuft) - 0.5) * jitterRadius;
      const jy = py + (hash2(gx, gy, SEEDS.leatherTuft + 3) - 0.5) * jitterRadius;
      stampBlob(pinch, size, jx, jy, size * 0.03, 1);
    }
  }
  return { bulge, pinch };
}

export function buildLeatherAlbedo(size, spec) {
  const { bulge, pinch } = leatherTuftField(size, spec.tuftsPerTile);
  const albedo = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const index = y * size + x;
      const grain = periodicFbm2(u, v, 26, 3, SEEDS.leatherGrain) - 0.5;
      const pore = periodicNoise2(u * 140, v * 140, 140, 140, SEEDS.leatherPore) - 0.5;
      const base = 0.97 + grain * 0.07 + pore * 0.035 + (bulge[index] - 0.5) * 0.05;
      albedo[index] = clamp01(base - pinch[index] * 0.32);
    }
  }
  return albedo;
}

export function buildLeatherRelief(size, spec) {
  const { bulge, pinch } = leatherTuftField(size, spec.tuftsPerTile);
  const height = new Float32Array(size * size);
  const wear = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const index = y * size + x;
      const grain = periodicFbm2(u, v, 26, 3, SEEDS.leatherGrain) - 0.5;
      const pore = periodicNoise2(u * 120, v * 120, 120, 120, SEEDS.leatherPore) - 0.5;
      height[index] = clamp01(
        0.5 + (bulge[index] - 0.5) * 0.3 + grain * 0.05 + pore * 0.03 - pinch[index] * 0.55,
      );
      wear[index] = pinch[index] * 0.4;
    }
  }
  return { height, wear };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{ wood, bronze, leather, fabric: { albedo: Buffer, normal: Buffer, orm: Buffer, size: number },
 *                     preview: Buffer }>}
 */
export async function buildRickshawSurfaceMaps() {
  const specs = RICKSHAW_MAP_SPECS;

  const woodRelief = buildWoodRelief(specs.wood.reliefSize, specs.wood);
  const bronzeRelief = buildMetalRelief(specs.bronze.reliefSize, specs.bronze);
  const leatherRelief = buildLeatherRelief(specs.leather.reliefSize, specs.leather);
  const fabricHeight = buildFabricRelief(specs.fabric.reliefSize, specs.fabric);

  const raw = {
    woodAlbedo: albedoBytes(
      buildWoodAlbedo(specs.wood.albedoSize, specs.wood),
      specs.wood.albedoSize,
    ),
    woodNormal: normalFromHeight(woodRelief.height, specs.wood.reliefSize, 3.0),
    woodOrm: buildOrm(woodRelief.height, specs.wood.reliefSize, {
      cavityRadius: 3,
      cavityGain: 5,
      occlusionDepth: 0.3,
      roughCavity: 0.14,
      roughWear: 0.08,
      wear: woodRelief.wear,
      metalWear: 0,
    }),
    bronzeAlbedo: albedoBytes(
      buildMetalAlbedo(specs.bronze.albedoSize, specs.bronze),
      specs.bronze.albedoSize,
    ),
    bronzeNormal: normalFromHeight(bronzeRelief.height, specs.bronze.reliefSize, 3.2),
    bronzeOrm: buildOrm(bronzeRelief.height, specs.bronze.reliefSize, {
      cavityRadius: 4,
      cavityGain: 5.5,
      occlusionDepth: 0.3,
      roughCavity: 0.16,
      roughWear: 0.18,
      wear: bronzeRelief.wear,
      metalWear: 0.13,
    }),
    leatherAlbedo: albedoBytes(
      buildLeatherAlbedo(specs.leather.albedoSize, specs.leather),
      specs.leather.albedoSize,
    ),
    leatherNormal: normalFromHeight(leatherRelief.height, specs.leather.reliefSize, 2.4),
    leatherOrm: buildOrm(leatherRelief.height, specs.leather.reliefSize, {
      cavityRadius: 3,
      cavityGain: 4.5,
      occlusionDepth: 0.28,
      roughCavity: 0.1,
      roughWear: 0.06,
      wear: leatherRelief.wear,
      metalWear: 0,
    }),
    fabricAlbedo: albedoBytes(
      buildFabricAlbedo(specs.fabric.albedoSize, specs.fabric),
      specs.fabric.albedoSize,
    ),
    fabricNormal: normalFromHeight(fabricHeight, specs.fabric.reliefSize, 2.6),
    fabricOrm: buildOrm(fabricHeight, specs.fabric.reliefSize, {
      cavityRadius: 3,
      cavityGain: 4.5,
      occlusionDepth: 0.26,
      roughCavity: 0.09,
      roughWear: 0.07,
      wear: null,
      metalWear: 0,
    }),
  };

  const families = ['wood', 'bronze', 'leather', 'fabric'];
  const out = {};
  for (const name of families) {
    const spec = specs[name];
    out[name] = {
      albedoSize: spec.albedoSize,
      reliefSize: spec.reliefSize,
      albedo: await encodeGray(raw[`${name}Albedo`], spec.albedoSize, 88),
      normal: await encodeRgb(raw[`${name}Normal`], spec.reliefSize, 90),
      orm: await encodeRgb(raw[`${name}Orm`], spec.reliefSize, 88),
    };
  }
  out.preview = await buildPreviewSheet(
    families.flatMap((name) => {
      const spec = specs[name];
      return [
        { pixels: raw[`${name}Albedo`], size: spec.albedoSize, channels: 1 },
        { pixels: raw[`${name}Normal`], size: spec.reliefSize, channels: 3 },
        { pixels: raw[`${name}Orm`], size: spec.reliefSize, channels: 3 },
      ];
    }),
    220,
  );
  return out;
}

const PREVIEW_MARGIN = 12;
const PREVIEW_GUTTER = 12;
const PREVIEW_COLUMNS = 3;

async function buildPreviewSheet(maps, tile) {
  const rows = Math.ceil(maps.length / PREVIEW_COLUMNS);
  const width =
    PREVIEW_MARGIN * 2 + tile * PREVIEW_COLUMNS + PREVIEW_GUTTER * (PREVIEW_COLUMNS - 1);
  const height = PREVIEW_MARGIN * 2 + tile * rows + PREVIEW_GUTTER * (rows - 1);
  const composite = [];
  for (let index = 0; index < maps.length; index++) {
    const map = maps[index];
    const column = index % PREVIEW_COLUMNS;
    const row = Math.floor(index / PREVIEW_COLUMNS);
    composite.push({
      input: await sharp(map.pixels, {
        raw: { width: map.size, height: map.size, channels: map.channels },
      })
        .resize(tile, tile, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .toColourspace('srgb')
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer(),
      left: PREVIEW_MARGIN + column * (tile + PREVIEW_GUTTER),
      top: PREVIEW_MARGIN + row * (tile + PREVIEW_GUTTER),
    });
  }
  return sharp({
    create: { width, height, channels: 3, background: { r: 24, g: 29, b: 36 } },
  })
    .composite(composite)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}
