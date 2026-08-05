#!/usr/bin/env node

// Bakes the Eastbrook town PBR companion atlases (tangent-space normal +
// roughness) from the shipping grayscale surface atlas. Both outputs share the
// color atlas's 4x4 x 128px cell layout, so the synthesized per-cell UVs in
// src/render/eastbrook_surface_atlas.ts address all three textures at once.
//
// Height comes from the color atlas's high-key luminance (192..255 per cell by
// construction, see surface_atlas.mjs). Normals are central differences taken
// WITHIN each 128px cell (neighbor lookups wrap inside the cell, never across
// cells) and the derivatives fade to flat across the 4px border band that the
// renderer's CELL_PADDING_PIXELS inset never samples directly, so mip bleed at
// cell seams stays neutral. Roughness is a per-cell base value (spec "cells"
// table) modulated by the same luminance so surfaces break up.
//
// Contract mirror of build_surface_atlas.mjs: a spec JSON pins source/output
// sha256 + dimensions + byte ceilings; --check recomputes and compares,
// --write regenerates the files under public/textures.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SPEC_PATH = path.join(ROOT, 'scripts/assets/specs/eastbrook_town_surface_pbr.json');

const ATLAS_PIXELS = 512;
const GRID_SIZE = 4;
const CELL_PIXELS = ATLAS_PIXELS / GRID_SIZE;
const CELL_PADDING_PIXELS = 4;
// The base atlas normalizes every cell into this high-key luminance band.
const HEIGHT_LUMINANCE_MIN = 192;
const HEIGHT_LUMINANCE_MAX = 255;
const ROUGHNESS_LUMINANCE_SWING = 0.08;
// Photographic grain in the source atlas turns into per-pixel derivative
// speckle that both looks noisy under light and defeats lossless webp. A 3x3
// tent blur of the height field (wrapped within the cell) plus channel
// quantization keeps the relief shapes while landing under the byte ceiling.
const NORMAL_QUANT_STEP = 6;
// Same integer luma weights the color-atlas builder uses (surface_atlas.mjs).
const LUMINANCE_RED = 54;
const LUMINANCE_GREEN = 183;
const LUMINANCE_BLUE = 19;
const LUMINANCE_DIVISOR = 256;

// Must match EASTBROOK_SURFACE_CELLS in src/render/eastbrook_surface_atlas.ts
// (index order). The surface class per cell is read straight off those semantic
// names; the spec "cells" table is validated against this list.
const EXPECTED_CELL_IDS = Object.freeze([
  'darkStoneBlocks',
  'lightStoneBlocks',
  'warmPlaster',
  'verticalDarkTimber',
  'cobaltRoofShingles',
  'darkForgedMetal',
  'warmGoldMetal',
  'horizontalWarmTimber',
  'blueCreamCanvas',
  'redCreamCanvas',
  'darkBrownLeather',
  'irregularDarkStone',
  'cyanCrystal',
  'cobaltPaintedPlanks',
  'lightGrayStone',
  'mediumGrayStone',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseMode(args) {
  const modes = args.filter((arg) => arg === '--check' || arg === '--write');
  const unknown = args.filter((arg) => arg !== '--check' && arg !== '--write');
  if (unknown.length > 0 || modes.length > 1) {
    throw new Error('usage: node build_surface_pbr.mjs [--check|--write]');
  }
  return modes[0] ?? '--check';
}

async function expectImageContract(bytes, contract, allowUnpinned = false) {
  const metadata = await sharp(bytes).metadata();
  if (
    metadata.format !== contract.format ||
    metadata.width !== contract.width ||
    metadata.height !== contract.height
  ) {
    throw new Error(
      `${contract.path} expected ${contract.width}x${contract.height} ${contract.format}, got ` +
        `${metadata.width ?? '?'}x${metadata.height ?? '?'} ${metadata.format ?? 'unknown'}`,
    );
  }
  const actualSha = sha256(bytes);
  if (contract.sha256 === 'PENDING' && allowUnpinned) {
    console.warn(`[eastbrook-pbr] ${contract.path} requires SHA-256 pin ${actualSha}`);
  } else if (actualSha !== contract.sha256) {
    throw new Error(`${contract.path} SHA-256 ${actualSha}; expected ${contract.sha256}`);
  }
  if (contract.byteCeiling && bytes.length > contract.byteCeiling) {
    throw new Error(`${contract.path} is ${bytes.length} bytes; ceiling ${contract.byteCeiling}`);
  }
}

function validatedCells(spec) {
  const cells = spec.cells;
  if (!Array.isArray(cells) || cells.length !== GRID_SIZE * GRID_SIZE) {
    throw new Error(`spec.cells must list all ${GRID_SIZE * GRID_SIZE} atlas cells`);
  }
  return cells.map((cell, index) => {
    if (cell.index !== index || cell.id !== EXPECTED_CELL_IDS[index]) {
      throw new Error(
        `spec.cells[${index}] must describe "${EXPECTED_CELL_IDS[index]}" ` +
          `(EASTBROOK_SURFACE_CELLS order); got "${cell.id}" at index ${cell.index}`,
      );
    }
    const [strengthX, strengthY] = cell.normalStrength;
    const roughnessBase = cell.roughnessBase;
    if (!(strengthX > 0) || !(strengthY > 0) || !(roughnessBase >= 0) || !(roughnessBase <= 1)) {
      throw new Error(`spec.cells[${index}] has out-of-range normalStrength/roughnessBase`);
    }
    return { index, id: cell.id, surface: cell.surface, strengthX, strengthY, roughnessBase };
  });
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function cellHeightField(rgb, row, column) {
  const heights = new Float64Array(CELL_PIXELS * CELL_PIXELS);
  const range = HEIGHT_LUMINANCE_MAX - HEIGHT_LUMINANCE_MIN;
  for (let y = 0; y < CELL_PIXELS; y += 1) {
    const atlasY = row * CELL_PIXELS + y;
    for (let x = 0; x < CELL_PIXELS; x += 1) {
      const atlasX = column * CELL_PIXELS + x;
      const offset = (atlasY * ATLAS_PIXELS + atlasX) * 3;
      const luminance = Math.floor(
        (LUMINANCE_RED * rgb[offset] +
          LUMINANCE_GREEN * rgb[offset + 1] +
          LUMINANCE_BLUE * rgb[offset + 2] +
          LUMINANCE_DIVISOR / 2) /
          LUMINANCE_DIVISOR,
      );
      heights[y * CELL_PIXELS + x] = clamp01((luminance - HEIGHT_LUMINANCE_MIN) / range);
    }
  }
  return heights;
}

/** 3x3 tent blur, neighbor lookups wrapped WITHIN the cell. */
function blurredHeightField(heights) {
  const blurred = new Float64Array(CELL_PIXELS * CELL_PIXELS);
  const weights = [1, 2, 1];
  for (let y = 0; y < CELL_PIXELS; y += 1) {
    for (let x = 0; x < CELL_PIXELS; x += 1) {
      let sum = 0;
      let weightSum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const sampleY = (y + dy + CELL_PIXELS) % CELL_PIXELS;
        for (let dx = -1; dx <= 1; dx += 1) {
          const sampleX = (x + dx + CELL_PIXELS) % CELL_PIXELS;
          const weight = weights[dy + 1] * weights[dx + 1];
          sum += heights[sampleY * CELL_PIXELS + sampleX] * weight;
          weightSum += weight;
        }
      }
      blurred[y * CELL_PIXELS + x] = sum / weightSum;
    }
  }
  return blurred;
}

function quantized(byte) {
  return Math.min(255, Math.round(byte / NORMAL_QUANT_STEP) * NORMAL_QUANT_STEP);
}

/** 0 at the cell edge, 1 once CELL_PADDING_PIXELS in: fades derivatives flat
 *  across the padding band so mips never smear one cell's relief into the next. */
function borderFade(x, y) {
  const edgeDistance = Math.min(x, y, CELL_PIXELS - 1 - x, CELL_PIXELS - 1 - y);
  return Math.min(1, edgeDistance / CELL_PADDING_PIXELS);
}

function bakeCell(heights, cell, normalPixels, roughPixels, row, column) {
  const smoothed = blurredHeightField(heights);
  for (let y = 0; y < CELL_PIXELS; y += 1) {
    // Neighbor rows wrap WITHIN the cell, never across cells.
    const yUp = (y + CELL_PIXELS - 1) % CELL_PIXELS;
    const yDown = (y + 1) % CELL_PIXELS;
    for (let x = 0; x < CELL_PIXELS; x += 1) {
      const xLeft = (x + CELL_PIXELS - 1) % CELL_PIXELS;
      const xRight = (x + 1) % CELL_PIXELS;
      const height = heights[y * CELL_PIXELS + x];
      const fade = borderFade(x, y);
      const dx =
        (smoothed[y * CELL_PIXELS + xRight] - smoothed[y * CELL_PIXELS + xLeft]) *
        0.5 *
        cell.strengthX *
        fade;
      const dy =
        (smoothed[yDown * CELL_PIXELS + x] - smoothed[yUp * CELL_PIXELS + x]) *
        0.5 *
        cell.strengthY *
        fade;
      // Tangent-space heightfield normal, OpenGL convention (+Y = up in UV
      // space). Pixel y grows downward while v grows upward, so the green
      // channel takes +dHeight/dPixelY.
      const nx = -dx;
      const ny = dy;
      const nz = 1;
      const inverseLength = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const atlasOffset = ((row * CELL_PIXELS + y) * ATLAS_PIXELS + column * CELL_PIXELS + x) * 3;
      normalPixels[atlasOffset] = quantized(clamp01(0.5 + 0.5 * nx * inverseLength) * 255);
      normalPixels[atlasOffset + 1] = quantized(clamp01(0.5 + 0.5 * ny * inverseLength) * 255);
      // Constant blue plane: three.js renormalizes the TBN-transformed vector,
      // so a unit z with the encoded xy slopes is equivalent, and the flat
      // plane costs near-zero bytes in lossless webp.
      normalPixels[atlasOffset + 2] = 255;

      // Darker luminance reads as crevice: rougher. Bright raised faces: smoother.
      const roughness = clamp01(
        cell.roughnessBase + (0.5 - height) * 2 * ROUGHNESS_LUMINANCE_SWING,
      );
      const value = Math.round(roughness * 255);
      roughPixels[atlasOffset] = value;
      roughPixels[atlasOffset + 1] = value;
      roughPixels[atlasOffset + 2] = value;
    }
  }
}

export async function buildEastbrookSurfacePbr(sourceBytes, cells) {
  const { data, info } = await sharp(sourceBytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 || info.width !== ATLAS_PIXELS || info.height !== ATLAS_PIXELS) {
    throw new Error(
      `Eastbrook PBR source must decode to ${ATLAS_PIXELS}x${ATLAS_PIXELS}x3; got ` +
        `${info.width}x${info.height}x${info.channels}`,
    );
  }

  const normalPixels = Buffer.alloc(ATLAS_PIXELS * ATLAS_PIXELS * 3);
  const roughPixels = Buffer.alloc(ATLAS_PIXELS * ATLAS_PIXELS * 3);
  for (const cell of cells) {
    const row = Math.floor(cell.index / GRID_SIZE);
    const column = cell.index % GRID_SIZE;
    const heights = cellHeightField(data, row, column);
    bakeCell(heights, cell, normalPixels, roughPixels, row, column);
  }

  const raw = { width: ATLAS_PIXELS, height: ATLAS_PIXELS, channels: 3 };
  const normal = await sharp(normalPixels, { raw }).webp({ lossless: true, effort: 6 }).toBuffer();
  const rough = await sharp(roughPixels, { raw }).webp({ lossless: true, effort: 6 }).toBuffer();
  return { normal, rough };
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
  const cells = validatedCells(spec);
  const sourcePath = path.join(ROOT, spec.source.path);
  const normalPath = path.join(ROOT, spec.normal.path);
  const roughPath = path.join(ROOT, spec.rough.path);
  const sourceBytes = readFileSync(sourcePath);
  await expectImageContract(sourceBytes, spec.source);

  const built = await buildEastbrookSurfacePbr(sourceBytes, cells);
  await expectImageContract(built.normal, spec.normal, mode === '--write');
  await expectImageContract(built.rough, spec.rough, mode === '--write');

  if (mode === '--write') {
    mkdirSync(path.dirname(normalPath), { recursive: true });
    mkdirSync(path.dirname(roughPath), { recursive: true });
    writeFileSync(normalPath, built.normal);
    writeFileSync(roughPath, built.rough);
  } else {
    for (const [assetPath, expected] of [
      [normalPath, built.normal],
      [roughPath, built.rough],
    ]) {
      if (!existsSync(assetPath)) throw new Error(`${path.relative(ROOT, assetPath)} is missing`);
      const current = readFileSync(assetPath);
      if (!current.equals(expected)) {
        throw new Error(`${path.relative(ROOT, assetPath)} is stale; run with --write`);
      }
    }
  }

  console.log(
    `[eastbrook-pbr] ${mode.slice(2)} passed: normal ${built.normal.length} bytes, ` +
      `rough ${built.rough.length} bytes (${ATLAS_PIXELS}x${ATLAS_PIXELS} lossless webp)`,
  );
  console.log(
    `[eastbrook-pbr] cells: ` +
      cells
        .map(
          (cell) =>
            `${cell.index}:${cell.id}(${cell.surface} nx${cell.strengthX} ny${cell.strengthY} ` +
            `r${cell.roughnessBase})`,
        )
        .join(', '),
  );
}

main().catch((error) => {
  console.error('[eastbrook-pbr] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
