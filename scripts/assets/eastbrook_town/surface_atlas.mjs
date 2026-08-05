import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const EASTBROOK_SURFACE_ATLAS_REPO_ROOT = path.resolve(HERE, '..', '..', '..');
export const EASTBROOK_SURFACE_ATLAS_SOURCE_FILES = Object.freeze([
  'docs/screenshots/eastbrook-vale-rebuild/materials/eastbrook-surface-atlas-source.png',
  'scripts/assets/eastbrook_town/surface_atlas.mjs',
  'scripts/assets/eastbrook_town/build_surface_atlas.mjs',
  'scripts/assets/specs/eastbrook_town_surface_atlas.json',
  'pnpm-lock.yaml',
]);

const SOURCE_PIXELS = 1254;
const GRID_SIZE = 4;
const SOURCE_INSET_PIXELS = 2;
const OUTPUT_CELL_PIXELS = 128;
const OUTPUT_PIXELS = GRID_SIZE * OUTPUT_CELL_PIXELS;
const LUMINANCE_RED = 54;
const LUMINANCE_GREEN = 183;
const LUMINANCE_BLUE = 19;
const LUMINANCE_DIVISOR = 256;
const LOW_PERCENTILE = 0.02;
const HIGH_PERCENTILE = 0.98;
const OUTPUT_MIN = 192;
const OUTPUT_MAX = 255;
const PREVIEW_MARGIN = 16;
const PREVIEW_GUTTER = 16;
const PREVIEW_WIDTH = PREVIEW_MARGIN * 2 + OUTPUT_PIXELS * 2 + PREVIEW_GUTTER;
const PREVIEW_HEIGHT = PREVIEW_MARGIN * 2 + OUTPUT_PIXELS;

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function eastbrookSurfaceAtlasFingerprint(repoRoot = EASTBROOK_SURFACE_ATLAS_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of EASTBROOK_SURFACE_ATLAS_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}

function percentileFromHistogram(histogram, pixelCount, percentile) {
  const threshold = Math.max(1, Math.ceil(pixelCount * percentile));
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= threshold) return value;
  }
  return 255;
}

function highKeyCell(rgb, pixelCount) {
  const luminance = Buffer.alloc(pixelCount);
  const histogram = new Uint32Array(256);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 3;
    const value = Math.min(
      255,
      Math.max(
        0,
        Math.floor(
          (LUMINANCE_RED * rgb[offset] +
            LUMINANCE_GREEN * rgb[offset + 1] +
            LUMINANCE_BLUE * rgb[offset + 2] +
            LUMINANCE_DIVISOR / 2) /
            LUMINANCE_DIVISOR,
        ),
      ),
    );
    luminance[pixel] = value;
    histogram[value] += 1;
  }

  const low = percentileFromHistogram(histogram, pixelCount, LOW_PERCENTILE);
  const high = percentileFromHistogram(histogram, pixelCount, HIGH_PERCENTILE);
  const range = Math.max(1, high - low);
  const out = Buffer.alloc(pixelCount * 3);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const clamped = Math.min(high, Math.max(low, luminance[pixel]));
    const normalized =
      OUTPUT_MIN + Math.round(((clamped - low) * (OUTPUT_MAX - OUTPUT_MIN)) / range);
    const offset = pixel * 3;
    out[offset] = normalized;
    out[offset + 1] = normalized;
    out[offset + 2] = normalized;
  }
  return { pixels: out, low, high };
}

function copyCellIntoAtlas(atlas, cell, row, column) {
  for (let y = 0; y < OUTPUT_CELL_PIXELS; y += 1) {
    const sourceStart = y * OUTPUT_CELL_PIXELS * 3;
    const targetStart =
      ((row * OUTPUT_CELL_PIXELS + y) * OUTPUT_PIXELS + column * OUTPUT_CELL_PIXELS) * 3;
    cell.copy(atlas, targetStart, sourceStart, sourceStart + OUTPUT_CELL_PIXELS * 3);
  }
}

async function sourceCellRgb(sourceBytes, row, column) {
  const leftBoundary = Math.round((column * SOURCE_PIXELS) / GRID_SIZE);
  const rightBoundary = Math.round(((column + 1) * SOURCE_PIXELS) / GRID_SIZE);
  const topBoundary = Math.round((row * SOURCE_PIXELS) / GRID_SIZE);
  const bottomBoundary = Math.round(((row + 1) * SOURCE_PIXELS) / GRID_SIZE);
  const left = leftBoundary + SOURCE_INSET_PIXELS;
  const top = topBoundary + SOURCE_INSET_PIXELS;
  const width = rightBoundary - leftBoundary - SOURCE_INSET_PIXELS * 2;
  const height = bottomBoundary - topBoundary - SOURCE_INSET_PIXELS * 2;
  const { data, info } = await sharp(sourceBytes)
    .extract({ left, top, width, height })
    .resize(OUTPUT_CELL_PIXELS, OUTPUT_CELL_PIXELS, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.channels !== 3 ||
    info.width !== OUTPUT_CELL_PIXELS ||
    info.height !== OUTPUT_CELL_PIXELS
  ) {
    throw new Error(
      `unexpected Eastbrook atlas cell shape ${info.width}x${info.height}x${info.channels}`,
    );
  }
  return data;
}

export async function buildEastbrookSurfaceAtlas(sourceBytes) {
  const metadata = await sharp(sourceBytes).metadata();
  if (
    metadata.format !== 'png' ||
    metadata.width !== SOURCE_PIXELS ||
    metadata.height !== SOURCE_PIXELS
  ) {
    throw new Error(
      `Eastbrook atlas source must be ${SOURCE_PIXELS}x${SOURCE_PIXELS} PNG; got ` +
        `${metadata.width ?? '?'}x${metadata.height ?? '?'} ${metadata.format ?? 'unknown'}`,
    );
  }

  const atlasPixels = Buffer.alloc(OUTPUT_PIXELS * OUTPUT_PIXELS * 3);
  const cellStats = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      const rgb = await sourceCellRgb(sourceBytes, row, column);
      const normalized = highKeyCell(rgb, OUTPUT_CELL_PIXELS * OUTPUT_CELL_PIXELS);
      copyCellIntoAtlas(atlasPixels, normalized.pixels, row, column);
      cellStats.push({
        index: row * GRID_SIZE + column,
        row,
        column,
        sourceLowLuminance: normalized.low,
        sourceHighLuminance: normalized.high,
      });
    }
  }

  const atlas = await sharp(atlasPixels, {
    raw: { width: OUTPUT_PIXELS, height: OUTPUT_PIXELS, channels: 3 },
  })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  const sourcePanel = await sharp(sourceBytes)
    .resize(OUTPUT_PIXELS, OUTPUT_PIXELS, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const shippingPanel = await sharp(atlas)
    .png({
      compressionLevel: 9,
      adaptiveFiltering: false,
    })
    .toBuffer();
  const preview = await sharp({
    create: {
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      channels: 3,
      background: { r: 24, g: 29, b: 36 },
    },
  })
    .composite([
      { input: sourcePanel, left: PREVIEW_MARGIN, top: PREVIEW_MARGIN },
      {
        input: shippingPanel,
        left: PREVIEW_MARGIN + OUTPUT_PIXELS + PREVIEW_GUTTER,
        top: PREVIEW_MARGIN,
      },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();

  return { atlas, preview, cellStats };
}
