// Procedural PBR map sets for the Tank mount, rastered in Node with sharp.
//
// Two families, each authored as three INDEPENDENT fields (never one field
// aliased across channels, which the object-sculpt spec lists under mustAvoid):
//   - albedo detail: a high-key multiplier over the material base colour,
//     carrying macro paint breakup, brushed grain, micro speckle, scuffs, and
//     chipped paint. Written sRGB-encoded so it behaves as a LINEAR multiplier.
//   - tangent normal: derived from its own height field (dents, brushed
//     streaks, micro grain, scratch grooves, chip craters).
//   - occlusion + roughness + metalness packed R/G/B: cavity darkening and
//     roughness from the height field's own concavity, plus a metalness lift
//     where paint has worn through to bare steel.
//
// Every field comes from the shared periodic noise in surface_shading.mjs, so
// the tiling maps and the baked vertex pass agree, and every map tiles
// seamlessly (the lattices wrap on the same period the sampler repeats on).
// Deterministic: integer hashes only, no Math.random, so a re-export is
// byte-reproducible for the same sharp build.

import sharp from 'sharp';
import { hash2, ORM_CENTER, periodicFbm2, periodicNoise2 } from './surface_shading.mjs';

/** Material-level normalTexture scale the exporter stamps. */
export const NORMAL_SCALE = 0.85;

// Resolution is per MAP, not per material: the world-space box projection fixes
// texel density in yards, so each channel only needs the resolution its own
// highest useful band asks for. Albedo carries the scratch and chip detail and
// costs almost nothing to store; the normal and ORM fields are the expensive
// ones and are band-limited well below their Nyquist frequency, so half
// resolution there is free quality-wise and pays for itself in bytes.
export const TANK_MAP_SPECS = Object.freeze({
  metal: Object.freeze({
    albedoSize: 1024,
    reliefSize: 512,
    scratches: 150,
    chips: 90,
  }),
  fabric: Object.freeze({
    albedoSize: 512,
    reliefSize: 256,
    pebblePeriod: 11,
    weavePeriod: 17,
  }),
});

const SEEDS = Object.freeze({
  metalAlbedoMacro: 10_301,
  metalAlbedoGrain: 10_607,
  metalAlbedoSpeckle: 10_909,
  metalAlbedoRuns: 11_213,
  metalHeightDent: 20_231,
  metalHeightStreak: 20_533,
  metalHeightMicro: 20_837,
  metalScratch: 30_161,
  metalChip: 30_467,
  fabricPebble: 40_193,
  fabricFiber: 40_499,
  fabricWeave: 40_801,
  fabricAlbedo: 50_119,
  fabricHeight: 50_423,
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

/** sRGB transfer function, so an albedo multiplier authored in linear space
 *  survives the loader's sRGB decode unchanged. */
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

/** Stamp a radially falling-off value into a wrapping scalar field. */
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

/** Walk a line segment across the wrapping field, stamping a narrow ridge.
 *  Cheaper and more controllable than testing every pixel against every line. */
function stampScratch(field, size, startX, startY, angle, length, width, amount) {
  const steps = Math.ceil(length);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    // Taper the ends so a scratch fades in and out instead of stopping dead.
    const taper = Math.sin(Math.PI * t) ** 0.35;
    stampBlob(
      field,
      size,
      startX + dirX * length * t,
      startY + dirY * length * t,
      width,
      amount * taper,
    );
  }
}

function metalScratchMask(size, count) {
  const field = new Float32Array(size * size);
  for (let index = 0; index < count; index++) {
    const startX = hash2(index, 1, SEEDS.metalScratch) * size;
    const startY = hash2(index, 2, SEEDS.metalScratch) * size;
    // Mostly horizontal: a tracked vehicle scrapes along its length.
    const angle = (hash2(index, 3, SEEDS.metalScratch) - 0.5) * 1.1;
    const length = lerp(size * 0.02, size * 0.16, hash2(index, 4, SEEDS.metalScratch));
    const width = lerp(0.6, 1.7, hash2(index, 5, SEEDS.metalScratch));
    const amount = lerp(0.45, 1, hash2(index, 6, SEEDS.metalScratch));
    stampScratch(field, size, startX, startY, angle, length, width, amount);
  }
  return field;
}

function metalChipMask(size, count) {
  const field = new Float32Array(size * size);
  for (let index = 0; index < count; index++) {
    const centerX = hash2(index, 1, SEEDS.metalChip) * size;
    const centerY = hash2(index, 2, SEEDS.metalChip) * size;
    const radius = lerp(size * 0.0035, size * 0.011, hash2(index, 3, SEEDS.metalChip));
    const amount = lerp(0.5, 1, hash2(index, 4, SEEDS.metalChip));
    stampBlob(field, size, centerX, centerY, radius, amount);
  }
  return field;
}

/** Separable box blur with wrap, used to get each field's local mean so
 *  concavity (and therefore cavity AO) can be read off it. */
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

/** Grime runs: noise stretched hard along v. The box projection puts world Y in
 *  v on every side-facing triangle, so these read as weather and dirt running
 *  DOWN the hull, which is the cue that most separates a painted vehicle from
 *  flat plastic. On the up-facing triangles v is world Z and the same field
 *  reads as flow along the hull, which is equally plausible. Returned as a
 *  darkening-only mask, because dirt never brightens paint. */
function metalRunMask(u, v) {
  return clamp01(0.5 - periodicFbm2(u, v, 14, 3, SEEDS.metalAlbedoRuns, 0.18)) * 2;
}

/** Metal albedo multiplier field: four independent bands of paint breakup plus
 *  the scuff and chip masks. Exported so the tiling contract can be asserted on
 *  the authored field: once a field is webp-encoded, the codec's own macroblock
 *  edge sits on the wrap seam and swamps the signal. */
export function buildMetalAlbedo(size, spec) {
  const scratch = metalScratchMask(size, spec.scratches);
  const chip = metalChipMask(size, spec.chips);
  const albedo = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const index = y * size + x;
      const macro = periodicFbm2(u, v, 4, 4, SEEDS.metalAlbedoMacro) - 0.5;
      const grain = periodicFbm2(u, v, 12, 3, SEEDS.metalAlbedoGrain, 5) - 0.5;
      const speckle = periodicFbm2(u, v, 48, 2, SEEDS.metalAlbedoSpeckle) - 0.5;
      const paint =
        0.975 + macro * 0.17 + grain * 0.09 + speckle * 0.028 - metalRunMask(u, v) * 0.085;
      // Worn paint reads lighter; a chip is a dark rim around a brighter
      // bare-steel core.
      const chipCore = smoothstep(0.55, 1, chip[index]);
      const chipRim = chip[index] - chipCore;
      albedo[index] = clamp01(paint + scratch[index] * 0.075 + chipCore * 0.08 - chipRim * 0.2);
    }
  }
  return albedo;
}

/** Metal height field (independent of the albedo bands) plus the wear mask the
 *  ORM pass lifts metalness on. */
export function buildMetalRelief(size, spec) {
  const scratch = metalScratchMask(size, spec.scratches);
  const chip = metalChipMask(size, spec.chips);
  const height = new Float32Array(size * size);
  const wear = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const index = y * size + x;
      const dent = periodicFbm2(u, v, 6, 3, SEEDS.metalHeightDent) - 0.5;
      const streak = periodicFbm2(u, v, 20, 3, SEEDS.metalHeightStreak, 7) - 0.5;
      const micro = periodicFbm2(u, v, 48, 2, SEEDS.metalHeightMicro) - 0.5;
      height[index] =
        0.5 +
        dent * 0.5 +
        streak * 0.28 +
        micro * 0.14 -
        scratch[index] * 0.24 -
        chip[index] * 0.32;
      wear[index] = clamp01(scratch[index] * 0.7 + chip[index]);
    }
  }
  return { height, wear };
}

/** Jittered-grid F1 distance: pebbled leather grain that also reads as coarse
 *  weave nubs at the finer UV scale the textile parts use. */
function fabricPebble(u, v, period) {
  const cellX = Math.floor(u * period);
  const cellY = Math.floor(v * period);
  let nearest = 8;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const wrappedX = (((cellX + dx) % period) + period) % period;
      const wrappedY = (((cellY + dy) % period) + period) % period;
      const siteU = (cellX + dx + hash2(wrappedX, wrappedY, SEEDS.fabricPebble)) / period;
      const siteV = (cellY + dy + hash2(wrappedX, wrappedY, SEEDS.fabricPebble + 7)) / period;
      const distance = Math.hypot((u - siteU) * period, (v - siteV) * period);
      if (distance < nearest) nearest = distance;
    }
  }
  return 1 - smoothstep(0, 0.62, nearest);
}

/** Over-under weave, deliberately coarse so it survives the fabric UV scale. */
function fabricWeave(u, v, period) {
  return Math.sin(u * Math.PI * 2 * period) * Math.sin(v * Math.PI * 2 * period) * 0.5 + 0.5;
}

export function buildFabricAlbedo(size, spec) {
  const albedo = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const pebble = fabricPebble(u, v, spec.pebblePeriod);
      const weave = fabricWeave(u, v, spec.weavePeriod);
      const fiber = periodicNoise2(u * 128, v * 22, 128, 22, SEEDS.fabricFiber);
      const tone = periodicFbm2(u, v, 5, 3, SEEDS.fabricAlbedo) - 0.5;
      albedo[y * size + x] = clamp01(
        0.955 + tone * 0.1 + (pebble - 0.4) * 0.11 + (weave - 0.5) * 0.035 + (fiber - 0.5) * 0.045,
      );
    }
  }
  return albedo;
}

export function buildFabricRelief(size, spec) {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const pebble = fabricPebble(u, v, spec.pebblePeriod);
      const weave = fabricWeave(u, v, spec.weavePeriod);
      const fiber = periodicNoise2(u * 96, v * 18, 96, 18, SEEDS.fabricHeight);
      height[y * size + x] = clamp01(0.38 + pebble * 0.46 + weave * 0.06 + (fiber - 0.5) * 0.14);
    }
  }
  return height;
}

/** Pack occlusion (R), roughness scale (G), and metalness scale (B) from a
 *  height field's concavity plus the wear masks. */
function buildOrm(height, size, options) {
  const mean = blurWrapped(height, size, options.cavityRadius);
  const rgb = Buffer.alloc(size * size * 3);
  for (let index = 0; index < height.length; index++) {
    const runs = options.runs ? options.runs[index] : 0;
    const concavity = clamp01((mean[index] - height[index]) * options.cavityGain);
    const convexity = clamp01((height[index] - mean[index]) * options.cavityGain);
    const wear = options.wear ? clamp01(options.wear[index]) : 0;
    const occlusion = 1 - options.occlusionDepth * concavity;
    // Cavities silt up and go rough; worn high spots polish.
    const roughness =
      ORM_CENTER *
      (1 +
        options.roughCavity * concavity +
        options.roughRuns * runs -
        options.roughWear * (convexity + wear));
    const metalness = ORM_CENTER * (1 + options.metalWear * wear - options.metalCavity * concavity);
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

/**
 * Build both map families.
 *
 * @returns {Promise<{ metal: { albedo: Buffer, normal: Buffer, orm: Buffer, size: number },
 *                     fabric: { albedo: Buffer, normal: Buffer, orm: Buffer, size: number },
 *                     preview: Buffer }>}
 */
export async function buildTankSurfaceMaps() {
  const metalSpec = TANK_MAP_SPECS.metal;
  const fabricSpec = TANK_MAP_SPECS.fabric;
  const metalRelief = buildMetalRelief(metalSpec.reliefSize, metalSpec);
  const metalRuns = new Float32Array(metalSpec.reliefSize * metalSpec.reliefSize);
  for (let y = 0; y < metalSpec.reliefSize; y++) {
    for (let x = 0; x < metalSpec.reliefSize; x++) {
      metalRuns[y * metalSpec.reliefSize + x] = metalRunMask(
        x / metalSpec.reliefSize,
        y / metalSpec.reliefSize,
      );
    }
  }
  const fabricHeight = buildFabricRelief(fabricSpec.reliefSize, fabricSpec);

  const raw = {
    metalAlbedo: albedoBytes(
      buildMetalAlbedo(metalSpec.albedoSize, metalSpec),
      metalSpec.albedoSize,
    ),
    metalNormal: normalFromHeight(metalRelief.height, metalSpec.reliefSize, 3.4),
    metalOrm: buildOrm(metalRelief.height, metalSpec.reliefSize, {
      cavityRadius: 4,
      cavityGain: 5.5,
      occlusionDepth: 0.3,
      roughCavity: 0.18,
      roughRuns: 0.12,
      roughWear: 0.2,
      runs: metalRuns,
      metalWear: 0.11,
      metalCavity: 0.06,
      wear: metalRelief.wear,
    }),
    fabricAlbedo: albedoBytes(
      buildFabricAlbedo(fabricSpec.albedoSize, fabricSpec),
      fabricSpec.albedoSize,
    ),
    fabricNormal: normalFromHeight(fabricHeight, fabricSpec.reliefSize, 2.6),
    fabricOrm: buildOrm(fabricHeight, fabricSpec.reliefSize, {
      cavityRadius: 3,
      cavityGain: 4.5,
      occlusionDepth: 0.26,
      roughCavity: 0.09,
      roughRuns: 0,
      roughWear: 0.07,
      runs: null,
      metalWear: 0,
      metalCavity: 0,
      wear: null,
    }),
  };

  return {
    metal: {
      albedoSize: metalSpec.albedoSize,
      reliefSize: metalSpec.reliefSize,
      albedo: await encodeGray(raw.metalAlbedo, metalSpec.albedoSize, 88),
      normal: await encodeRgb(raw.metalNormal, metalSpec.reliefSize, 90),
      orm: await encodeRgb(raw.metalOrm, metalSpec.reliefSize, 88),
    },
    fabric: {
      albedoSize: fabricSpec.albedoSize,
      reliefSize: fabricSpec.reliefSize,
      albedo: await encodeGray(raw.fabricAlbedo, fabricSpec.albedoSize, 88),
      normal: await encodeRgb(raw.fabricNormal, fabricSpec.reliefSize, 90),
      orm: await encodeRgb(raw.fabricOrm, fabricSpec.reliefSize, 88),
    },
    preview: await buildPreviewSheet(
      [
        { pixels: raw.metalAlbedo, size: metalSpec.albedoSize, channels: 1 },
        { pixels: raw.metalNormal, size: metalSpec.reliefSize, channels: 3 },
        { pixels: raw.metalOrm, size: metalSpec.reliefSize, channels: 3 },
        { pixels: raw.fabricAlbedo, size: fabricSpec.albedoSize, channels: 1 },
        { pixels: raw.fabricNormal, size: fabricSpec.reliefSize, channels: 3 },
        { pixels: raw.fabricOrm, size: fabricSpec.reliefSize, channels: 3 },
      ],
      256,
    ),
  };
}

const PREVIEW_MARGIN = 12;
const PREVIEW_GUTTER = 12;
const PREVIEW_COLUMNS = 3;

/** Contact sheet of the six maps (metal albedo/normal/orm on the top row,
 *  fabric below) for the authoring evidence directory. */
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
