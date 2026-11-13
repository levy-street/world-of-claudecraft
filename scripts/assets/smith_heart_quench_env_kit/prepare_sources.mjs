// Size the ChatGPT paintings and grade the Tripo builds' base colours for the Quench
// vein's painted kit (docs/design/raid/kit/build_smith_heart_quench_env_kit.py). The
// floors the raid stands on, the fight's sword and the glacier round the lake take 1024;
// the cliff, the masonry, the snow, the falls and the small props 512, the floors' relief
// 256; nothing is over 1024.
//
//   node scripts/assets/smith_heart_quench_env_kit/prepare_sources.mjs <paintings> <jobs> <out>
//
// <paintings> holds qv_<name> (docs/design/raid/kit/quench_env_src/paintings, or the PNGs
// ChatGPT handed over), <jobs> holds <name>/raw.glb (the Tripo P2 builds), <out> gets
// tex/<name>.png and models/<name>.glb.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { gradePainting, gradeQuench } from './quench_grade.mjs';

const [paintings, jobs, out] = process.argv.slice(2);
if (!paintings || !jobs || !out)
  throw new Error('usage: prepare_sources.mjs <paintings> <jobs> <out>');

/** A painting's file: the PNG as ChatGPT handed it over, or the checked-in WebP. */
const painting = (name) => {
  const png = path.join(paintings, `qv_${name}.png`);
  return existsSync(png) ? png : path.join(paintings, `qv_${name}.webp`);
};

/** The paintings' sizes (the floors what the eye stands on, the rest backgrounds) and how
 *  far each is taken toward the slate (quench_grade.mjs gradePainting: the share of its
 *  chroma removed, its value): the stone was painted a saturated cobalt; the lake's ice
 *  keeps its teal. */
const PAINTINGS = {
  lake: { size: 1024, grade: [0, 1] },
  rime: { size: 1024, grade: [0.55, 0.86] },
  cliff: { size: 512, grade: [0.45, 0.84] },
  block: { size: 512, grade: [0.55, 0.86] },
  snow: { size: 512, grade: [0.3, 1] },
};
/** The Tripo builds' atlas sizes and how far each takes the grade (quench_grade.mjs): the
 *  rock-built pieces the whole way, the pieces of ice a little (their pale facets are ice,
 *  and the rock's ramp would turn them to slate). */
const TRIPO = {
  ice_sword: { job: 'sword', size: 1024, grade: 0.3 },
  glacier_tall: { job: 'glacier_tall', size: 1024, grade: 1 },
  glacier_wide: { job: 'glacier_wide', size: 1024, grade: 1 },
  ice_spires: { job: 'spires', size: 512, grade: 0.5 },
  frozen_fall: { job: 'fall', size: 512, grade: 0.85 },
  ice_plates: { job: 'plates', size: 512, grade: 0.45 },
  fire_bowl: { job: 'bowl', size: 512, grade: 0.8 },
  chevron_stone: { job: 'stone', size: 512, grade: 1 },
};

mkdirSync(path.join(out, 'tex'), { recursive: true });
mkdirSync(path.join(out, 'models'), { recursive: true });

for (const [name, p] of Object.entries(PAINTINGS)) {
  const { data, info } = await sharp(painting(name))
    .removeAlpha()
    .resize(p.size, p.size)
    .raw()
    .toBuffer({ resolveWithObject: true });
  gradePainting(data, p.grade[0], p.grade[1]);
  await sharp(data, { raw: info })
    .png()
    .toFile(path.join(out, 'tex', `${name}.png`));
}

/** Relief from a painting's own value: the dark cracks and joints sink, the body stands
 *  up. Wrapped at its edges, as the painting tiles. */
async function relief(name, strength) {
  const size = 256;
  const { data } = await sharp(path.join(out, 'tex', `${name}.png`))
    .resize(size, size)
    .greyscale()
    .blur(1.2)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x, y) => data[((y + size) % size) * size + ((x + size) % size)];
  const px = Buffer.alloc(size * size * 3);
  // The slope per texel of the 512 relief this was tuned at, kept at the smaller size.
  const k = (strength / 255) * 512 * 0.012 * (size / 512);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * k;
      const ny = (at(x, y - 1) - at(x, y + 1)) * k;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 3;
      px[i] = (nx / l) * 127.5 + 127.5;
      px[i + 1] = (ny / l) * 127.5 + 127.5;
      px[i + 2] = (1 / l) * 127.5 + 127.5;
    }
  }
  await sharp(px, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toFile(path.join(out, 'tex', `${name}_n.png`));
}
await relief('rime', 2.6);
// The lake's polish keeps only a hint of its cracks' relief.
await relief('lake', 1.2);

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

// Two small swatches the pieces draw: the vents' dark throat (deep blue-black, a breath
// of the vein's light at its heart) and the fuller strips' white (the fight lights them).
{
  const size = 64;
  const px = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const core = Math.max(0, 1 - d * 2.2);
      const i = (y * size + x) * 3;
      px[i] = 8 + 30 * core;
      px[i + 1] = 12 + 52 * core;
      px[i + 2] = 22 + 70 * core;
    }
  }
  await sharp(px, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toFile(path.join(out, 'tex', 'throat.png'));
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } })
    .png()
    .toFile(path.join(out, 'tex', 'glow.png'));
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
  gradeQuench(atlas.data, t.grade);
  await sharp(atlas.data, { raw: atlas.info })
    .png()
    .toFile(path.join(out, 'tex', `${name}.png`));
}
console.log(`prepared ${out}`);
