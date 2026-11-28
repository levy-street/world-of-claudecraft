// Size the ChatGPT paintings and grade the Tripo builds' base colours for the Heat vein's
// painted kit (docs/design/raid/kit/build_smith_heart_heat_env_kit.py). The floor the raid
// stands on, the Hearth's mouth, the altar-stone and the basalt round the hall take 1024;
// the cliff, the masonry, the fall and the small props 512, the floor's relief 256;
// nothing is over 1024.
//
//   node scripts/assets/smith_heart_heat_env_kit/prepare_sources.mjs <paintings> <jobs> <out>
//
// <paintings> holds fv_<name> (docs/design/raid/kit/heat_env_src/paintings, or the PNGs
// ChatGPT handed over), <jobs> holds <name>/raw.glb (the Tripo P2 builds), <out> gets
// tex/<name>.png and models/<name>.glb.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { gradeHeat, gradePainting } from './heat_grade.mjs';

const [paintings, jobs, out] = process.argv.slice(2);
if (!paintings || !jobs || !out)
  throw new Error('usage: prepare_sources.mjs <paintings> <jobs> <out>');

/** A painting's file: the PNG as ChatGPT handed it over, or the checked-in WebP. */
const painting = (name) => {
  const png = path.join(paintings, `fv_${name}.png`);
  return existsSync(png) ? png : path.join(paintings, `fv_${name}.webp`);
};

/** The paintings' sizes (the floor what the eye stands on, the rest backgrounds) and how
 *  far each is taken toward the basalt (heat_grade.mjs gradePainting: the share of its
 *  chroma removed, its value): ChatGPT painted the stone a dusky violet-brown. */
const PAINTINGS = {
  floor: { size: 1024, grade: [0.6, 0.9] },
  cliff: { size: 512, grade: [0.55, 0.9] },
  block: { size: 512, grade: [0.55, 0.9] },
};
/** The Tripo builds' atlas sizes and how far each takes the grade (heat_grade.mjs): the
 *  rock-built pieces the whole way, the crystal cluster a little (its prisms are most of
 *  it, and the grade keeps them anyway). */
const TRIPO = {
  hearth_mouth: { job: 'hearth', size: 1024, grade: 0.9 },
  altar_stone: { job: 'altar', size: 1024, grade: 1 },
  fire_crystal: { job: 'crystal', size: 512, grade: 0.6 },
  ember_boulder: { job: 'boulder', size: 512, grade: 1 },
  column_bundle: { job: 'columns', size: 512, grade: 1 },
  basalt_tall: { job: 'cliff_tall', size: 1024, grade: 1 },
  basalt_wide: { job: 'cliff_wide', size: 1024, grade: 1 },
  // The dressed concept's pieces (2026-11-10): the seamed basalt and the thin fall, their
  // molten kept as thin seams and taken onto the deep orange.
  seam_tall: { job: 'seam_tall', size: 1024, grade: 1, seams: true, deep: true },
  seam_wide: { job: 'seam_wide', size: 1024, grade: 1, seams: true, deep: true },
  molten_fall: { job: 'fall_thin', size: 1024, grade: 1, seams: true, deep: true },
  // The concept's own backdrop (the owner's "make it like the reference"): its great fall
  // cliff, its tiered cliff wall with thin falls, the molten shore at the cliffs' feet.
  great_fall: { job: 'great_fall', size: 1024, grade: 1, seams: true, deep: true },
  cliff_wall: { job: 'cliff_wall', size: 1024, grade: 1, seams: true, deep: true },
  molten_shore: { job: 'molten_shore', size: 1024, grade: 1, seams: true, deep: true },
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

/** Relief from a painting's own value: the dark joints sink, the column heads stand up.
 *  Wrapped at its edges, as the painting tiles. */
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
await relief('floor', 2.6);

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
  gradeHeat(atlas.data, t.grade, atlas.info.width, atlas.info.height, t);
  await sharp(atlas.data, { raw: atlas.info })
    .png()
    .toFile(path.join(out, 'tex', `${name}.png`));
}
console.log(`prepared ${out}`);
