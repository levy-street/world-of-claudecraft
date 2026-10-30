#!/usr/bin/env node
// Painted ground: converts the hand-painted ground sources into the terrain
// splat layers src/render/terrain.ts loads.
//
// Sources: scripts/assets/painted_ground/src/{grass,dirt,rock,cobble,leaves}.png
// (square, any size).
// ChatGPT image generation (project-generated), prompts recorded in
// scripts/assets/painted_ground/PROMPTS.md.
//
// Usage (repo root):
//   npx tsx scripts/assets/painted_ground/build_painted_ground.mjs [--only grass,dirt] [--no-ktx] [--dry-run]
//   node scripts/build_media_manifest.mjs generate
// Replacing a painting is: drop the new PNG over src/<name>.png, run both.
//
// Per layer (the table is src/render/terrain_painted_ground_core.ts
// PAINTED_GROUND_LAYERS, the processing is lib/painted_ground_core.mjs
// PAINTED_GROUND_RECIPES):
//   1. resize to the 1024 layer size (lanczos3), decode to linear light;
//   2. seam heal: Moisan's periodic component, so the tile repeats with no
//      seam and no cross (an offset-and-feather heal would ghost two parts of
//      the painting into each other);
//   3. de-light: divide out each channel's lowest frequencies (baked
//      gradients, vignettes, one big blotch that would mark every repeat);
//   4. isotropize: even out directional spectral energy, which is what the
//      generator's faint diagonal banding and same-way strokes are;
//   5. colour: land the mean on what the splat shader's tint expects (grass
//      goes tint-neutral, dirt and rock sit on the photo layers' means);
//   6. write public/textures/terrain/<stem>_Color.jpg (1024, the albedo pack
//      source: deliberately NOT KTX2, see terrain.ts prepareTerrainTex),
//      <stem>_Height.webp (512 lossless grey, packed into the albedo layer's
//      alpha) and,
//      for layers with a normal slot, <stem>_NormalGL.jpg (1024, gentle,
//      OpenGL convention) plus its .ktx2 through
//      `node scripts/assets/compress_standalone_textures.mjs --flip <files>`
//      (the terrain consumes them flipY, so the flip MUST be baked);
//   7. rebuild GroundAO_Packed.png: R grass cavity, G dirt cavity, B rock
//      height from the painted layers (fitted to the shader's centring
//      constants), A the unchanged Ground080 sand AO.
// Everything is deterministic: the same sources give the same bytes.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  PAINTED_GROUND_LAYERS,
  PAINTED_HEIGHT_SIZE,
  paintedGroundFiles,
} from '../../../src/render/terrain_painted_ground_core.ts';
import {
  deriveHeight,
  deriveNormal,
  downsample2x,
  GROUND_AO_PACK,
  grey8FromPlane,
  groundAoChannel,
  PAINTED_GROUND_RECIPES,
  planeStats,
  planesFromSrgb8,
  processPaintedLayer,
  srgb8FromPlanes,
} from './lib/painted_ground_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC_DIR = path.join(ROOT, 'scripts', 'assets', 'painted_ground', 'src');
const PUBLIC = path.join(ROOT, 'public');
const TERRAIN_DIR = path.join(PUBLIC, 'textures', 'terrain');
const SIZE = 1024;

function parseArgs(argv) {
  const opts = { only: null, ktx: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') opts.only = new Set(String(argv[++i] ?? '').split(','));
    else if (a === '--no-ktx') opts.ktx = false;
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

async function readSource(name) {
  const file = path.join(SRC_DIR, `${name}.png`);
  if (!fs.existsSync(file)) throw new Error(`missing painted source ${path.relative(ROOT, file)}`);
  const meta = await sharp(file).metadata();
  if (meta.width !== meta.height) {
    throw new Error(`${name}.png is ${meta.width}x${meta.height}; painted sources must be square`);
  }
  const { data, info } = await sharp(file)
    .resize(SIZE, SIZE, { kernel: 'lanczos3', fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return planesFromSrgb8(data, SIZE, SIZE, info.channels);
}

const fmt = (v) => v.toFixed(3);

async function write(rel, buffer, dryRun) {
  const abs = path.join(PUBLIC, rel);
  if (!dryRun) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
  }
  return `${rel} ${(buffer.length / 1024).toFixed(0)} KB`;
}

async function buildLayer(layer, dryRun) {
  const recipe = PAINTED_GROUND_RECIPES[layer.source];
  if (!recipe) throw new Error(`no recipe for painted layer ${layer.source}`);
  const files = paintedGroundFiles(layer);
  const src = await readSource(layer.source);
  const { planes, report } = processPaintedLayer(src, SIZE, SIZE, recipe);
  const written = [];

  const rgb = srgb8FromPlanes(planes, SIZE, SIZE);
  const colorJpg = await sharp(Buffer.from(rgb), {
    raw: { width: SIZE, height: SIZE, channels: 3 },
  })
    .jpeg({ quality: 86, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer();
  written.push(await write(files.color, colorJpg, dryRun));

  const height = deriveHeight(planes, SIZE, SIZE, recipe.height);
  const height512 = downsample2x(height, SIZE, SIZE);
  if (PAINTED_HEIGHT_SIZE !== SIZE / 2) throw new Error('height size must be half the layer size');
  // lossless WebP: exact data at half the PNG's bytes (the albedo pack
  // drawImages it like the colour JPEG, so it must stay a plain image)
  const heightWebp = await sharp(Buffer.from(grey8FromPlane(height512)), {
    raw: { width: PAINTED_HEIGHT_SIZE, height: PAINTED_HEIGHT_SIZE, channels: 1 },
  })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  written.push(await write(files.height, heightWebp, dryRun));

  if (files.normal) {
    if (!recipe.normal) throw new Error(`${layer.source} has a normal slot but no normal recipe`);
    const n = deriveNormal(height, SIZE, SIZE, recipe.normal);
    const nrgb = new Uint8Array(SIZE * SIZE * 3);
    for (let i = 0; i < SIZE * SIZE; i++) {
      for (let c = 0; c < 3; c++) nrgb[i * 3 + c] = Math.round(n[c][i] * 255);
    }
    const normalJpg = await sharp(Buffer.from(nrgb), {
      raw: { width: SIZE, height: SIZE, channels: 3 },
    })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer();
    written.push(await write(files.normal, normalJpg, dryRun));
  }

  console.log(
    `[painted-ground] ${layer.source}: seam ${fmt(report.seamBefore.x)}/${fmt(report.seamBefore.y)}` +
      ` -> ${fmt(report.seamAfter.x)}/${fmt(report.seamAfter.y)}, anisotropy` +
      ` ${fmt(report.anisotropyBefore)} -> ${fmt(report.anisotropyAfter)},` +
      ` linear mean ${report.mean.map(fmt).join(', ')}`,
  );
  for (const w of written) console.log(`  ${w}`);
  return { layer, height512, normal: files.normal };
}

async function packGroundAo(heights, dryRun) {
  const size = GROUND_AO_PACK.size;
  const bySource = new Map(heights.map((h) => [h.layer.source, h.height512]));
  const channel = (spec) => {
    const height = bySource.get(spec.source);
    if (!height) throw new Error(`GroundAO channel needs the ${spec.source} layer in this run`);
    const fit = groundAoChannel(height, size, size, spec);
    console.log(
      `[painted-ground] GroundAO ${spec.source} ${spec.kind}: mean ${fit.mean.toFixed(4)}` +
        ` sd ${fit.sd.toFixed(4)} (shader expects ${spec.mean} / ${spec.sd})`,
    );
    return grey8FromPlane(fit.plane);
  };
  const r = channel(GROUND_AO_PACK.r);
  const g = channel(GROUND_AO_PACK.g);
  const b = channel(GROUND_AO_PACK.b);
  const { data: a } = await sharp(path.join(TERRAIN_DIR, GROUND_AO_PACK.a.photo))
    .resize(size, size, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = r[i];
    rgba[i * 4 + 1] = g[i];
    rgba[i * 4 + 2] = b[i];
    rgba[i * 4 + 3] = a[i];
  }
  const aStats = planeStats(Float32Array.from(a, (v) => v / 255));
  console.log(
    `[painted-ground] GroundAO sand AO (unchanged source): mean ${aStats.mean.toFixed(4)}`,
  );
  const png = await sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  console.log(`  ${await write('textures/terrain/GroundAO_Packed.png', png, dryRun)}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const layers = PAINTED_GROUND_LAYERS.filter((l) => !opts.only || opts.only.has(l.source));
  if (layers.length === 0) throw new Error('no painted layer selected');
  const built = [];
  for (const layer of layers) built.push(await buildLayer(layer, opts.dryRun));
  const aoSources = [GROUND_AO_PACK.r, GROUND_AO_PACK.g, GROUND_AO_PACK.b].map((c) => c.source);
  if (aoSources.every((s) => built.some((b) => b.layer.source === s))) {
    await packGroundAo(built, opts.dryRun);
  } else {
    console.log(
      '[painted-ground] GroundAO_Packed.png left as is (run without --only to rebuild it)',
    );
  }
  const normals = built.filter((b) => b.normal).map((b) => path.join(PUBLIC, b.normal));
  if (opts.ktx && !opts.dryRun && normals.length > 0) {
    const res = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'assets', 'compress_standalone_textures.mjs'),
        '--flip',
        ...normals,
      ],
      { cwd: ROOT, stdio: 'inherit' },
    );
    if (res.status !== 0) throw new Error('compress_standalone_textures.mjs --flip failed');
  }
  console.log(
    opts.dryRun
      ? '[painted-ground] dry run: nothing written'
      : '[painted-ground] done; next: node scripts/build_media_manifest.mjs generate',
  );
}

main().catch((err) => {
  console.error('[painted-ground] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
