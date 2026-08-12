// Deterministic procedural PBR maps for the Goblin Rocket Sled. Three surface
// families each receive independent albedo, tangent-normal, and packed ORM
// fields. The AI concept supplies palette and construction cues only; painted
// highlights and shadows are never copied into shipping albedo.
import sharp from 'sharp';
import {
  buildMetalAlbedo,
  buildMetalRelief,
  NORMAL_SCALE,
} from '../terrorspark_groundshaker/surface_maps.mjs';
import {
  ORM_CENTER,
  periodicFbm2,
  periodicNoise2,
} from '../terrorspark_groundshaker/surface_shading.mjs';

export { NORMAL_SCALE };

export const SLED_MAP_SIZE = 1024;

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function toByte(value) {
  return Math.round(clamp01(value) * 255);
}

function encodeSrgb(linear) {
  const value = clamp01(linear);
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function wrap(value, size) {
  return ((value % size) + size) % size;
}

function blurWrapped(field, size, radius) {
  const horizontal = new Float32Array(field.length);
  const output = new Float32Array(field.length);
  const width = radius * 2 + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        sum += field[y * size + wrap(x + offset, size)];
      }
      horizontal[y * size + x] = sum / width;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        sum += horizontal[wrap(y + offset, size) * size + x];
      }
      output[y * size + x] = sum / width;
    }
  }
  return output;
}

function normalFromHeight(height, size, slope) {
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        (height[y * size + wrap(x + 1, size)] - height[y * size + wrap(x - 1, size)]) * slope;
      const dy =
        (height[wrap(y + 1, size) * size + x] - height[wrap(y - 1, size) * size + x]) * slope;
      const length = Math.hypot(dx, dy, 1);
      const offset = (y * size + x) * 3;
      rgb[offset] = toByte((-dx / length) * 0.5 + 0.5);
      rgb[offset + 1] = toByte((-dy / length) * 0.5 + 0.5);
      rgb[offset + 2] = toByte((1 / length) * 0.5 + 0.5);
    }
  }
  return rgb;
}

function ormFromHeight(height, size, { roughness, metalness, wear = null }) {
  const mean = blurWrapped(height, size, 3);
  const rgb = Buffer.alloc(size * size * 3);
  for (let index = 0; index < height.length; index++) {
    const cavity = clamp01((mean[index] - height[index]) * 5.5);
    const crest = clamp01((height[index] - mean[index]) * 4.5);
    const worn = wear ? wear[index] : 0;
    const offset = index * 3;
    rgb[offset] = toByte(1 - cavity * 0.34);
    rgb[offset + 1] = toByte(ORM_CENTER * (roughness + cavity * 0.22 - crest * 0.1 - worn * 0.08));
    rgb[offset + 2] = toByte(ORM_CENTER * (metalness + worn * 0.18));
  }
  return rgb;
}

function albedoBytes(field) {
  const gray = Buffer.alloc(field.length);
  for (let index = 0; index < field.length; index++) {
    gray[index] = toByte(encodeSrgb(field[index]));
  }
  return gray;
}

function woodFields(size) {
  const albedo = new Float32Array(size * size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const index = y * size + x;
      const grain = periodicFbm2(u, v, 14, 4, 60_427, 10) - 0.5;
      const rings = periodicFbm2(u, v, 4, 3, 60_733, 0.35) - 0.5;
      const macro = periodicFbm2(u, v, 3, 3, 60_121) - 0.5;
      const micro = periodicNoise2(u * 72, v * 72, 72, 72, 61_039) - 0.5;
      const board = Math.min((u * 5) % 1, 1 - ((u * 5) % 1));
      const seam = 1 - smoothstep(0, 0.025, board);
      albedo[index] = clamp01(0.96 + macro * 0.12 + grain * 0.22 + rings * 0.05 - seam * 0.34);
      // Independent height seed/bands: no albedo-to-normal aliasing.
      const relief = periodicFbm2(u, v, 17, 4, 62_143, 11) - 0.5;
      const fibers = periodicNoise2(u * 96, v * 96, 96, 96, 62_449) - 0.5;
      height[index] = clamp01(0.55 + relief * 0.34 + fibers * 0.08 - seam * 0.38);
    }
  }
  return { albedo, height };
}

function leatherFields(size) {
  const albedo = new Float32Array(size * size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const index = y * size + x;
      const cellX = ((u * 4) % 1) - 0.5;
      const cellY = ((v * 4) % 1) - 0.5;
      const diamond = Math.abs(cellX) + Math.abs(cellY);
      const seam = smoothstep(0.38, 0.5, diamond);
      const button = 1 - smoothstep(0.02, 0.12, Math.hypot(cellX, cellY));
      const grain = periodicFbm2(u, v, 48, 3, 70_151) - 0.5;
      const pores = periodicNoise2(u * 112, v * 112, 112, 112, 70_457) - 0.5;
      albedo[index] = clamp01(0.97 + grain * 0.1 + pores * 0.035 - seam * 0.12 - button * 0.14);
      const relief = periodicFbm2(u, v, 56, 3, 70_763) - 0.5;
      height[index] = clamp01(0.56 + relief * 0.1 + (1 - seam) * 0.2 - button * 0.32);
    }
  }
  return { albedo, height };
}

async function encodeGray(field, size) {
  return sharp(albedoBytes(field), { raw: { width: size, height: size, channels: 1 } })
    .webp({ quality: 82, effort: 6 })
    .toBuffer();
}

async function encodeRgb(rgb, size) {
  return sharp(rgb, { raw: { width: size, height: size, channels: 3 } })
    .webp({ quality: 86, effort: 6 })
    .toBuffer();
}

async function encodeFamily(albedo, height, options) {
  return {
    albedo: await encodeGray(albedo, SLED_MAP_SIZE),
    normal: await encodeRgb(
      normalFromHeight(height, SLED_MAP_SIZE, options.normalSlope),
      SLED_MAP_SIZE,
    ),
    orm: await encodeRgb(ormFromHeight(height, SLED_MAP_SIZE, options), SLED_MAP_SIZE),
  };
}

async function previewSheet(families) {
  const composites = [];
  let row = 0;
  for (const family of ['metal', 'wood', 'leather']) {
    let column = 0;
    for (const channel of ['albedo', 'normal', 'orm']) {
      const input = await sharp(families[family][channel]).resize(256, 256).png().toBuffer();
      composites.push({ input, left: column * 256, top: row * 256 });
      column++;
    }
    row++;
  }
  return sharp({ create: { width: 768, height: 768, channels: 3, background: '#20242b' } })
    .composite(composites)
    .png()
    .toBuffer();
}

export async function buildSledSurfaceMaps() {
  const size = SLED_MAP_SIZE;
  const metalAlbedo = buildMetalAlbedo(size, { scratches: 130, chips: 72 });
  const metalRelief = buildMetalRelief(size, { scratches: 130, chips: 72 });
  const wood = woodFields(size);
  const leather = leatherFields(size);
  const families = {
    metal: await encodeFamily(metalAlbedo, metalRelief.height, {
      normalSlope: 2.6,
      roughness: 1,
      metalness: 1,
      wear: metalRelief.wear,
    }),
    wood: await encodeFamily(wood.albedo, wood.height, {
      normalSlope: 2.2,
      roughness: 1.08,
      metalness: 0,
    }),
    leather: await encodeFamily(leather.albedo, leather.height, {
      normalSlope: 1.7,
      roughness: 1.02,
      metalness: 0,
    }),
  };
  return { ...families, preview: await previewSheet(families), size };
}
