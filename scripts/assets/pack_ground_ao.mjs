#!/usr/bin/env node

// Packs the splat ground layers' relief channels into one RGBA texture
// (public/textures/terrain/GroundAO_Packed.png, 512x512 lossless PNG):
//
//   R  Grass001_AmbientOcclusion   G  Ground023_AmbientOcclusion (dirt)
//   B  rock height blend           A  Ground080_AmbientOcclusion (sand)
//
// One sampler instead of four keeps buildSplatMaterial (src/render/terrain.ts)
// under the 16-sampler fragment limit; the shader centres each channel on its
// measured mean, so this script prints the means it bakes and the
// GROUND_RELIEF_GLSL constants must be updated whenever they move.
//
// B is deliberately NOT an AO map. The rock layer's cavity/height signal is a
// 50/50 blend of Rock026_Displacement (fractured cliff plates: strong macro
// structure, but its authored AO is near-white) and Rock060_Displacement
// (isotropic granite grain with real dynamic range). Each source is rescaled
// to full range before blending so neither dominates by contrast alone, and
// blending two isotropic-ish fields kills any residual directionality: the
// whole point is that mountainsides shade as plates and pockets, never as
// stripes.
//
// Contract style mirrors eastbrook_town/build_surface_pbr.mjs, flattened:
// --check rebuilds in memory and byte-compares against the shipped file,
// --write regenerates it. No spec JSON; the media manifest carries the hash.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TERRAIN_DIR = 'public/textures/terrain';
const OUT_PATH = path.join(ROOT, TERRAIN_DIR, 'GroundAO_Packed.png');
const SIZE = 512;

const AO_SOURCES = {
  r: 'Grass001_AmbientOcclusion.jpg',
  g: 'Ground023_AmbientOcclusion.jpg',
  a: 'Ground080_AmbientOcclusion.jpg',
};
const ROCK_DISPLACEMENT_SOURCES = ['Rock026_Displacement.jpg', 'Rock060_Displacement.jpg'];

function parseMode(args) {
  const modes = args.filter((arg) => arg === '--check' || arg === '--write');
  const unknown = args.filter((arg) => arg !== '--check' && arg !== '--write');
  if (unknown.length > 0 || modes.length > 1) {
    throw new Error('usage: node pack_ground_ao.mjs [--check|--write]');
  }
  return modes[0] ?? '--check';
}

/** One grayscale channel at the packed resolution. */
async function grayChannel(file) {
  const { data, info } = await sharp(path.join(ROOT, TERRAIN_DIR, file))
    .resize(SIZE, SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || info.width !== SIZE || info.height !== SIZE) {
    throw new Error(`${file} decoded to ${info.width}x${info.height}x${info.channels}`);
  }
  return data;
}

/** Stretch a channel to the full 0..255 range in place (min/max from the
 *  resized data itself, so the contract is stable against source re-encodes
 *  only insofar as their extremes survive; the printed mean is the check). */
function rescaledFullRange(channel) {
  let min = 255;
  let max = 0;
  for (const v of channel) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = Math.max(1, max - min);
  const out = Buffer.alloc(channel.length);
  for (let i = 0; i < channel.length; i += 1) {
    out[i] = Math.round(((channel[i] - min) / range) * 255);
  }
  return out;
}

function channelMean(channel) {
  let sum = 0;
  for (const v of channel) sum += v;
  return sum / channel.length;
}

export async function buildGroundAoPacked() {
  const [red, green, alpha] = await Promise.all(
    [AO_SOURCES.r, AO_SOURCES.g, AO_SOURCES.a].map(grayChannel),
  );
  const [rockA, rockB] = await Promise.all(
    ROCK_DISPLACEMENT_SOURCES.map(async (file) => rescaledFullRange(await grayChannel(file))),
  );
  const blue = Buffer.alloc(SIZE * SIZE);
  for (let i = 0; i < blue.length; i += 1) {
    blue[i] = Math.round((rockA[i] + rockB[i]) / 2);
  }

  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    rgba[i * 4] = red[i];
    rgba[i * 4 + 1] = green[i];
    rgba[i * 4 + 2] = blue[i];
    rgba[i * 4 + 3] = alpha[i];
  }
  const png = await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { png, means: { r: red, g: green, b: blue, a: alpha } };
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const { png, means } = await buildGroundAoPacked();

  for (const [name, channel] of Object.entries(means)) {
    const mean = channelMean(channel);
    console.log(
      `[ground-ao] channel ${name.toUpperCase()}: mean ${mean.toFixed(2)} ` +
        `(${(mean / 255).toFixed(3)} normalized, the shader centring constant)`,
    );
  }

  if (mode === '--write') {
    mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, png);
  } else {
    if (!existsSync(OUT_PATH)) throw new Error(`${path.relative(ROOT, OUT_PATH)} is missing`);
    if (!readFileSync(OUT_PATH).equals(png)) {
      throw new Error(`${path.relative(ROOT, OUT_PATH)} is stale; run with --write`);
    }
  }
  console.log(
    `[ground-ao] ${mode.slice(2)} passed: ${png.length} bytes (${SIZE}x${SIZE} lossless png)`,
  );
}

main().catch((error) => {
  console.error('[ground-ao] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
