// Size the ChatGPT paintings and grade the Tripo builds' base colours for the Breath
// vein's painted kit (docs/design/raid/kit/build_smith_heart_breath_env_kit.py). The
// stacks fill the skyline at 1024; the standing stone, the cliff and the masonry take
// 512; nothing is over 1024.
//
//   node scripts/assets/smith_heart_breath_env_kit/prepare_sources.mjs <paintings> <jobs> <out>
//
// <paintings> holds bv_<name> (docs/design/raid/kit/breath_env_src/paintings, or the PNGs
// ChatGPT handed over), <jobs> holds <name>/raw.glb (the Tripo P2 builds), <out> gets
// tex/<name>.png and models/<name>.glb.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const [paintings, jobs, out] = process.argv.slice(2);
if (!paintings || !jobs || !out)
  throw new Error('usage: prepare_sources.mjs <paintings> <jobs> <out>');

/** A painting's file: the PNG as ChatGPT handed it over, or the checked-in WebP. */
const painting = (name) => {
  const png = path.join(paintings, `bv_${name}.png`);
  return existsSync(png) ? png : path.join(paintings, `bv_${name}.webp`);
};

/** The storm granite by value (sRGB): deep slate-violet shade, blue-grey body, a dull
 *  silver where the wind scours it (never white: under the summit's cold key a paler
 *  light read as the Quench's ice). The Tripo builds came back a washed lavender; this
 *  puts their stone on the sheets' palette and keeps the strokes, which live in value. */
export const STORM_RAMP = [
  [0, [26, 27, 46]],
  [70, [62, 65, 92]],
  [125, [100, 105, 132]],
  [178, [140, 145, 166]],
  [238, [186, 190, 204]],
];

function rampAt(ramp, v) {
  for (let i = 1; i < ramp.length; i++) {
    if (v > ramp[i][0]) continue;
    const [a, ca] = ramp[i - 1];
    const [b, cb] = ramp[i];
    const t = (v - a) / (b - a);
    return [0, 1, 2].map((k) => ca[k] + (cb[k] - ca[k]) * t);
  }
  return ramp[ramp.length - 1][1];
}

/** How much of a texel is the painted crystal (a saturated sky-blue well past its red
 *  and green) and how much the pale lichen (green at or past blue). Neither takes the
 *  ramp: the ramp would turn both to rock. */
export function crystalShare(r, g, b) {
  const lift = b - Math.max(r, g);
  return Math.min(1, Math.max(0, (lift - 50) / 50)) * Math.min(1, Math.max(0, (b - 150) / 40));
}
export function lichenShare(_r, g, b) {
  return Math.min(1, Math.max(0, (g - b + 8) / 26));
}

/** Put raw RGB stone on the ramp by `amount`, after a stretch of its value (the builds
 *  came back flat); crystal and lichen left to their own colour. */
export function gradeStorm(px, amount, stretch = 1.35) {
  for (let i = 0; i < px.length; i += 3) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const spare = Math.max(crystalShare(r, g, b), lichenShare(r, g, b));
    const luma = 0.3 * r + 0.59 * g + 0.11 * b;
    const v = Math.max(0, Math.min(238, (luma - 128) * stretch + 128));
    const c = rampAt(STORM_RAMP, v);
    const k = amount * (1 - spare);
    px[i] = r + (c[0] - r) * k;
    px[i + 1] = g + (c[1] - g) * k;
    px[i + 2] = b + (c[2] - b) * k;
    // The lichen pulled from a minty green toward the sheets' pale sea-green.
    const lichen = lichenShare(r, g, b) * (1 - crystalShare(r, g, b));
    if (lichen > 0) {
      const grey = (r + g + b) / 3;
      px[i] += (grey * 0.86 - px[i]) * lichen * 0.5;
      px[i + 1] += (grey * 1.02 - px[i + 1]) * lichen * 0.5;
      px[i + 2] += (grey * 0.94 - px[i + 2]) * lichen * 0.5;
    }
  }
}

/** The paintings' sizes (the floor what the eye stands on, the rest backgrounds). */
const PAINTINGS = {
  slab: { size: 1024 },
  cliff: { size: 512 },
  block: { size: 512 },
};
/** The Tripo builds' atlas sizes and how far each takes the ramp. */
const TRIPO = {
  storm_spire: { job: 'spire', size: 1024, ramp: 0.85 },
  storm_bluff: { job: 'bluff', size: 1024, ramp: 0.85 },
  storm_arch: { job: 'arch', size: 1024, ramp: 0.85 },
  storm_stone: { job: 'stone', size: 512, ramp: 0.75 },
};

mkdirSync(path.join(out, 'tex'), { recursive: true });
mkdirSync(path.join(out, 'models'), { recursive: true });

for (const [name, p] of Object.entries(PAINTINGS)) {
  await sharp(painting(name))
    .removeAlpha()
    .resize(p.size, p.size)
    .png()
    .toFile(path.join(out, 'tex', `${name}.png`));
}

// Relief for the floor, from the painting's own value: the dark cracks sink, a slab's
// body stands up. Wrapped at its edges, as the painting tiles.
{
  const size = 512;
  const { data } = await sharp(path.join(out, 'tex', 'slab.png'))
    .resize(size, size)
    .greyscale()
    .blur(1.2)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x, y) => data[((y + size) % size) * size + ((x + size) % size)];
  const px = Buffer.alloc(size * size * 3);
  const strength = 2.6 / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength * size * 0.012;
      const ny = (at(x, y - 1) - at(x, y + 1)) * strength * size * 0.012;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 3;
      px[i] = (nx / l) * 127.5 + 127.5;
      px[i + 1] = (ny / l) * 127.5 + 127.5;
      px[i + 2] = (1 / l) * 127.5 + 127.5;
    }
  }
  await sharp(px, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toFile(path.join(out, 'tex', 'slab_n.png'));
}

// The sky wraps a dome: 1024 by 512. ChatGPT's left and right edges nearly meet; the
// last `band` columns are folded over the first, a cross-fade from the right edge into
// the left, so the wrap is continuous both at the dome's seam and where the fold ends.
{
  const { data, info } = await sharp(painting('sky'))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const band = Math.round(W * 0.08);
  const w2 = W - band;
  const px = Buffer.alloc(w2 * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < w2; x++) {
      const o = (y * w2 + x) * 3;
      const own = (y * W + x) * 3;
      if (x >= band) {
        data.copy(px, o, own, own + 3);
        continue;
      }
      const t = (x + 0.5) / band;
      const k = t * t * (3 - 2 * t);
      const right = (y * W + (W - band + x)) * 3;
      for (let c = 0; c < 3; c++) px[o + c] = data[right + c] * (1 - k) + data[own + c] * k;
    }
  }
  await sharp(px, { raw: { width: w2, height: H, channels: 3 } })
    .resize(1024, 512, { fit: 'fill' })
    .png()
    .toFile(path.join(out, 'tex', 'sky.png'));
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [name, t] of Object.entries(TRIPO)) {
  const raw = path.join(jobs, t.job, 'raw.glb');
  copyFileSync(raw, path.join(out, 'models', `${name}.glb`));
  const doc = await io.read(raw);
  const material = doc.getRoot().listMaterials()[0];
  const bytes = material.getBaseColorTexture()?.getImage();
  if (!bytes) throw new Error(`${name}: no base colour`);
  const atlas = await sharp(Buffer.from(bytes))
    .removeAlpha()
    .resize(t.size, t.size)
    .raw()
    .toBuffer({ resolveWithObject: true });
  gradeStorm(atlas.data, t.ramp);
  await sharp(atlas.data, { raw: atlas.info })
    .png()
    .toFile(path.join(out, 'tex', `${name}.png`));
}
console.log(`prepared ${out}`);
