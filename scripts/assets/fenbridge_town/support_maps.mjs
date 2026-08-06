import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const FENBRIDGE_SUPPORT_MAP_SIZE = 512;
export const FENBRIDGE_SUPPORT_MAP_GRID = 4;
export const FENBRIDGE_SUPPORT_MAP_SOURCE_PATH =
  'docs/design/fenbridge-rebuild/materials/fenbridge-surface-atlas-source.png';
export const FENBRIDGE_SUPPORT_MAP_SOURCE_FILES = Object.freeze([
  FENBRIDGE_SUPPORT_MAP_SOURCE_PATH,
  'scripts/assets/fenbridge_town/support_maps.mjs',
  'scripts/assets/fenbridge_town/build_support_maps.mjs',
  'scripts/assets/fenbridge_town/support_maps.json',
  'pnpm-lock.yaml',
]);

const CELL_SIZE = FENBRIDGE_SUPPORT_MAP_SIZE / FENBRIDGE_SUPPORT_MAP_GRID;
const CELL_PADDING = 4;
const SOURCE_PIXELS = 1254;
const SOURCE_INSET_PIXELS = 3;
const QUANTIZATION = 2;
const NORMAL_QUANTIZATION = 6;
const LUMINANCE_RED = 54;
const LUMINANCE_GREEN = 183;
const LUMINANCE_BLUE = 19;
const LUMINANCE_DIVISOR = 256;

// Roughness / metalness bases mirror FENBRIDGE_SURFACE_CELLS order.
const CELL_ROUGHNESS_BASE = Object.freeze([
  0.92, // mossStone
  0.86, // cleanStone
  0.84, // darkTimber
  0.78, // warmTimber
  0.74, // tealShingles
  0.52, // forgedIron
  0.42, // agedBrass
  0.88, // rope
  0.82, // tealCanvas
  0.9, // parchment
  0.8, // curedHide
  0.95, // packedMud
  0.28, // tealFenlight
  0.22, // potionGlass
  0.82, // rawBoard
  0.4, // redWax
]);
const CELL_METALNESS_BASE = Object.freeze([
  0, 0, 0, 0, 0, 0.72, 0.78, 0, 0, 0, 0, 0, 0.08, 0.18, 0, 0.05,
]);
const CELL_NORMAL_STRENGTH = Object.freeze([
  7.2, 6.4, 6.8, 6.2, 7.0, 5.4, 5.0, 5.8, 4.4, 3.6, 5.2, 6.6, 3.2, 3.8, 6.0, 4.0,
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function fenbridgeSupportMapFingerprint(repoRoot) {
  const hash = createHash('sha256');
  for (const relativePath of FENBRIDGE_SUPPORT_MAP_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function quantize(value, step) {
  return Math.round(value / step) * step;
}

function luminance(r, g, b) {
  return Math.floor(
    (LUMINANCE_RED * r + LUMINANCE_GREEN * g + LUMINANCE_BLUE * b + LUMINANCE_DIVISOR / 2) /
      LUMINANCE_DIVISOR,
  );
}

function sampleWithinCell(heights, atlasX, atlasY, dx, dy) {
  const cellLeft = Math.floor(atlasX / CELL_SIZE) * CELL_SIZE;
  const cellTop = Math.floor(atlasY / CELL_SIZE) * CELL_SIZE;
  const x = (atlasX - cellLeft + dx + CELL_SIZE) % CELL_SIZE;
  const y = (atlasY - cellTop + dy + CELL_SIZE) % CELL_SIZE;
  return heights[(cellTop + y) * FENBRIDGE_SUPPORT_MAP_SIZE + cellLeft + x] / 255;
}

async function sourceCellRgb(sourceBytes, row, column) {
  const leftBoundary = Math.round((column * SOURCE_PIXELS) / FENBRIDGE_SUPPORT_MAP_GRID);
  const rightBoundary = Math.round(((column + 1) * SOURCE_PIXELS) / FENBRIDGE_SUPPORT_MAP_GRID);
  const topBoundary = Math.round((row * SOURCE_PIXELS) / FENBRIDGE_SUPPORT_MAP_GRID);
  const bottomBoundary = Math.round(((row + 1) * SOURCE_PIXELS) / FENBRIDGE_SUPPORT_MAP_GRID);
  const left = leftBoundary + SOURCE_INSET_PIXELS;
  const top = topBoundary + SOURCE_INSET_PIXELS;
  const width = rightBoundary - leftBoundary - SOURCE_INSET_PIXELS * 2;
  const height = bottomBoundary - topBoundary - SOURCE_INSET_PIXELS * 2;
  const { data, info } = await sharp(sourceBytes)
    .extract({ left, top, width, height })
    .resize(CELL_SIZE, CELL_SIZE, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 || info.width !== CELL_SIZE || info.height !== CELL_SIZE) {
    throw new Error(
      `unexpected Fenbridge atlas cell shape ${info.width}x${info.height}x${info.channels}`,
    );
  }
  return data;
}

function copyCellIntoAtlas(atlas, cell, row, column) {
  for (let y = 0; y < CELL_SIZE; y += 1) {
    const sourceStart = y * CELL_SIZE * 3;
    const targetStart =
      ((row * CELL_SIZE + y) * FENBRIDGE_SUPPORT_MAP_SIZE + column * CELL_SIZE) * 3;
    cell.copy(atlas, targetStart, sourceStart, sourceStart + CELL_SIZE * 3);
  }
}

function blurHeightCell(heights, cellLeft, cellTop) {
  const blurred = new Uint8Array(CELL_SIZE * CELL_SIZE);
  for (let y = 0; y < CELL_SIZE; y += 1) {
    for (let x = 0; x < CELL_SIZE; x += 1) {
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = (x + dx + CELL_SIZE) % CELL_SIZE;
          const sy = (y + dy + CELL_SIZE) % CELL_SIZE;
          const w = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          sum += heights[(cellTop + sy) * FENBRIDGE_SUPPORT_MAP_SIZE + cellLeft + sx] * w;
          weight += w;
        }
      }
      blurred[y * CELL_SIZE + x] = Math.round(sum / weight);
    }
  }
  for (let y = 0; y < CELL_SIZE; y += 1) {
    for (let x = 0; x < CELL_SIZE; x += 1) {
      heights[(cellTop + y) * FENBRIDGE_SUPPORT_MAP_SIZE + cellLeft + x] =
        blurred[y * CELL_SIZE + x];
    }
  }
}

export async function buildFenbridgeSupportMaps(
  repoRoot = path.resolve(import.meta.dirname, '../../..'),
) {
  const sourcePath = path.join(repoRoot, FENBRIDGE_SUPPORT_MAP_SOURCE_PATH);
  const sourceBytes = readFileSync(sourcePath);
  const metadata = await sharp(sourceBytes).metadata();
  if (
    metadata.format !== 'png' ||
    metadata.width !== SOURCE_PIXELS ||
    metadata.height !== SOURCE_PIXELS
  ) {
    throw new Error(
      `Fenbridge atlas source must be ${SOURCE_PIXELS}x${SOURCE_PIXELS} PNG; got ` +
        `${metadata.width ?? '?'}x${metadata.height ?? '?'} ${metadata.format ?? 'unknown'}`,
    );
  }

  const basePixels = Buffer.alloc(FENBRIDGE_SUPPORT_MAP_SIZE * FENBRIDGE_SUPPORT_MAP_SIZE * 3);
  const heights = new Uint8Array(FENBRIDGE_SUPPORT_MAP_SIZE * FENBRIDGE_SUPPORT_MAP_SIZE);
  const roughnessValues = new Float32Array(FENBRIDGE_SUPPORT_MAP_SIZE * FENBRIDGE_SUPPORT_MAP_SIZE);
  const metalnessValues = new Float32Array(FENBRIDGE_SUPPORT_MAP_SIZE * FENBRIDGE_SUPPORT_MAP_SIZE);

  for (let row = 0; row < FENBRIDGE_SUPPORT_MAP_GRID; row += 1) {
    for (let column = 0; column < FENBRIDGE_SUPPORT_MAP_GRID; column += 1) {
      const cell = row * FENBRIDGE_SUPPORT_MAP_GRID + column;
      const rgb = await sourceCellRgb(sourceBytes, row, column);
      copyCellIntoAtlas(basePixels, rgb, row, column);
      const cellLeft = column * CELL_SIZE;
      const cellTop = row * CELL_SIZE;
      let lumaMin = 255;
      let lumaMax = 0;
      for (let y = 0; y < CELL_SIZE; y += 1) {
        for (let x = 0; x < CELL_SIZE; x += 1) {
          const offset = (y * CELL_SIZE + x) * 3;
          const luma = luminance(rgb[offset], rgb[offset + 1], rgb[offset + 2]);
          lumaMin = Math.min(lumaMin, luma);
          lumaMax = Math.max(lumaMax, luma);
        }
      }
      const range = Math.max(18, lumaMax - lumaMin);
      for (let y = 0; y < CELL_SIZE; y += 1) {
        for (let x = 0; x < CELL_SIZE; x += 1) {
          const offset = (y * CELL_SIZE + x) * 3;
          const pixel = (cellTop + y) * FENBRIDGE_SUPPORT_MAP_SIZE + cellLeft + x;
          const luma = luminance(rgb[offset], rgb[offset + 1], rgb[offset + 2]);
          const normalized = (luma - lumaMin) / range;
          heights[pixel] = Math.round(clamp(48 + normalized * 180, 40, 232));
          const roughSwing = (0.5 - normalized) * 0.12;
          roughnessValues[pixel] = clamp(CELL_ROUGHNESS_BASE[cell] + roughSwing, 0.18, 0.98);
          metalnessValues[pixel] = clamp(
            CELL_METALNESS_BASE[cell] + (normalized - 0.5) * 0.05,
            0,
            1,
          );
          // Quantize albedo slightly for deterministic lossless webp.
          for (let channel = 0; channel < 3; channel += 1) {
            basePixels[pixel * 3 + channel] = quantize(rgb[offset + channel], QUANTIZATION);
          }
        }
      }
      blurHeightCell(heights, cellLeft, cellTop);
    }
  }

  const normalPixels = Buffer.alloc(basePixels.length);
  const roughnessPixels = Buffer.alloc(basePixels.length);
  for (let y = 0; y < FENBRIDGE_SUPPORT_MAP_SIZE; y += 1) {
    for (let x = 0; x < FENBRIDGE_SUPPORT_MAP_SIZE; x += 1) {
      const pixel = y * FENBRIDGE_SUPPORT_MAP_SIZE + x;
      const offset = pixel * 3;
      const cell =
        Math.floor(y / CELL_SIZE) * FENBRIDGE_SUPPORT_MAP_GRID + Math.floor(x / CELL_SIZE);
      const localX = x % CELL_SIZE;
      const localY = y % CELL_SIZE;
      const borderDistance = Math.min(
        localX,
        localY,
        CELL_SIZE - 1 - localX,
        CELL_SIZE - 1 - localY,
      );
      const fade = Math.min(1, borderDistance / CELL_PADDING);
      const strength = CELL_NORMAL_STRENGTH[cell];
      const dx =
        (sampleWithinCell(heights, x, y, 1, 0) - sampleWithinCell(heights, x, y, -1, 0)) *
        strength *
        fade;
      const dy =
        (sampleWithinCell(heights, x, y, 0, 1) - sampleWithinCell(heights, x, y, 0, -1)) *
        strength *
        fade;
      const inverseLength = 1 / Math.hypot(dx, dy, 1);
      normalPixels[offset] = quantize(
        clamp(0.5 - dx * inverseLength * 0.5, 0, 1) * 255,
        NORMAL_QUANTIZATION,
      );
      normalPixels[offset + 1] = quantize(
        clamp(0.5 + dy * inverseLength * 0.5, 0, 1) * 255,
        NORMAL_QUANTIZATION,
      );
      normalPixels[offset + 2] = 255;

      const roughByte = quantize(roughnessValues[pixel] * 255, 4);
      roughnessPixels[offset] = roughByte;
      roughnessPixels[offset + 1] = roughByte;
      roughnessPixels[offset + 2] = quantize(metalnessValues[pixel] * 255, 4);
    }
  }

  const raw = {
    width: FENBRIDGE_SUPPORT_MAP_SIZE,
    height: FENBRIDGE_SUPPORT_MAP_SIZE,
    channels: 3,
  };
  // Concept-authored albedo needs color fidelity; PBR companions compress well
  // with lossy webp and stay under the 448 KiB support-map wave ceiling.
  const encodeBase = (pixels) =>
    sharp(pixels, { raw }).webp({ quality: 92, effort: 6, smartSubsample: true }).toBuffer();
  const encodeData = (pixels) =>
    sharp(pixels, { raw }).webp({ quality: 88, effort: 6, smartSubsample: true }).toBuffer();
  const [base, normal, roughness] = await Promise.all([
    encodeBase(basePixels),
    encodeData(normalPixels),
    encodeData(roughnessPixels),
  ]);
  return { base, normal, roughness };
}
