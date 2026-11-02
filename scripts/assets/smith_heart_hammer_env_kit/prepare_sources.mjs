// Size the ChatGPT paintings and pull the Tripo builds' base colours for the
// Hammer vein's painted kit (docs/design/raid/kit/build_smith_heart_hammer_env_kit.py).
// Backgrounds take smaller textures; nothing is over 1024.
//
//   node scripts/assets/smith_heart_hammer_env_kit/prepare_sources.mjs <paintings> <jobs> <out>
//
// <paintings> holds hv_<name> (docs/design/raid/kit/hammer_env_src/paintings), <jobs> holds <name>/raw.glb, <out> gets
// tex/<name>.png and models/<name>.glb.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const [paintings, jobs, out] = process.argv.slice(2);

/** A painting's file: the checked-in WebP, or the PNG as ChatGPT handed it over. */
const painting = (name) => {
  const png = path.join(paintings, `hv_${name}.png`);
  return existsSync(png) ? png : path.join(paintings, `hv_${name}.webp`);
};

/** The style guide's stone by value: slate shadows, taupe mids, warm sand lights.
 *  The paintings came back violet; this puts every stone on the guide's palette and
 *  keeps the strokes, which live in the value. */
const STONE_RAMP = [
  [0, [34, 37, 50]],
  [70, [76, 79, 92]],
  [125, [122, 116, 116]],
  [178, [176, 155, 134]],
  [238, [232, 203, 162]],
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

/** Put raw RGB stone on a ramp by `amount`. Moss (green over blue) is left to its
 *  own grade: the ramp would turn it to rock. Returns each pixel's moss share. */
function gradeStone(px, ramp, amount) {
  for (let i = 0; i < px.length; i += 3) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const mossy = Math.min(1, Math.max(0, (Math.min(r, g) - b) / 48));
    // A stretch of the value first: the guide's stone runs from deep shade to bright sand.
    const luma = 0.3 * r + 0.59 * g + 0.11 * b;
    const v = Math.max(0, Math.min(238, (luma - 118) * 1.3 + 128));
    const c = rampAt(ramp, v);
    const k = amount * (1 - mossy);
    px[i] = r + (c[0] - r) * k;
    px[i + 1] = g + (c[1] - g) * k;
    px[i + 2] = b + (c[2] - b) * k;
  }
}

/** Hue and saturation pulled so the floors and masonry sit cool behind the warm
 *  ochre mobs, and each texture's size (the far things the smallest). */
const PAINTINGS = {
  paving: { size: 1024, ramp: 0.8 },
  arena: { size: 1024, ramp: 0.8 },
  block: { size: 512, ramp: 0.88 },
  cliff: { size: 512, ramp: 0.95 },
  moss: { size: 256, saturation: 0.78, brightness: 0.92 },
  iron: { size: 256 },
};
const TRIPO = {
  cliff_tall: 1024,
  cliff_wide: 1024,
  arcade: 1024,
  outcrop: 512,
};

mkdirSync(path.join(out, 'tex'), { recursive: true });
mkdirSync(path.join(out, 'models'), { recursive: true });

for (const [name, p] of Object.entries(PAINTINGS)) {
  let img = sharp(painting(name)).removeAlpha().resize(p.size, p.size);
  if (p.saturation || p.hue || p.brightness) {
    img = img.modulate({
      saturation: p.saturation ?? 1,
      hue: p.hue ?? 0,
      brightness: p.brightness ?? 1,
    });
  }
  if (p.ramp) {
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    gradeStone(data, STONE_RAMP, p.ramp);
    await sharp(data, { raw: info })
      .png()
      .toFile(path.join(out, 'tex', `${name}.png`));
    continue;
  }
  await img.png().toFile(path.join(out, 'tex', `${name}.png`));
}

// Relief for the floors, from each painting's own value: the dark joints sink, a flag's
// body stands up. Wrapped at its edges, as the painting tiles.
for (const name of ['paving', 'arena']) {
  const size = 512;
  const { data } = await sharp(path.join(out, 'tex', `${name}.png`))
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
    .toFile(path.join(out, 'tex', `${name}_n.png`));
}

// The sky wraps a dome: 1024 by 512.
await sharp(painting('sky'))
  .removeAlpha()
  .resize(1024, 512)
  .png()
  .toFile(path.join(out, 'tex', 'sky.png'));

// The banner's magenta keyed out: its tatters are the cut edge.
{
  const { data, info } = await sharp(painting('banner'))
    .removeAlpha()
    .resize(256, 512, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    const magenta = r > 150 && b > 150 && g < 110;
    rgba[i * 4] = magenta ? 90 : r;
    rgba[i * 4 + 1] = magenta ? 12 : g;
    rgba[i * 4 + 2] = magenta ? 16 : b;
    rgba[i * 4 + 3] = magenta ? 0 : 255;
  }
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(path.join(out, 'tex', 'banner.png'));
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [name, size] of Object.entries(TRIPO)) {
  const raw = path.join(jobs, name, 'raw.glb');
  copyFileSync(raw, path.join(out, 'models', `${name}.glb`));
  const doc = await io.read(raw);
  const material = doc.getRoot().listMaterials()[0];
  const bytes = material.getBaseColorTexture()?.getImage();
  if (!bytes) throw new Error(`${name}: no base colour`);
  const atlas = await sharp(Buffer.from(bytes))
    .removeAlpha()
    .resize(size, size)
    .raw()
    .toBuffer({ resolveWithObject: true });
  // The moss caps pulled from a loud yellow to the style guide's olive: under the
  // low sun they clipped, and a build's big top facets turned to flat yellow.
  const px = atlas.data;
  gradeStone(px, STONE_RAMP, name === 'arcade' ? 0.75 : 0.95);
  for (let i = 0; i < px.length; i += 3) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const mossy = Math.min(1, Math.max(0, (Math.min(r, g) - b) / 48));
    if (mossy <= 0) continue;
    const grey = (r + g + b) / 3;
    px[i] = r + (grey * 0.62 + 8 - r) * mossy * 0.9;
    px[i + 1] = g + (grey * 0.74 + 8 - g) * mossy * 0.9;
    px[i + 2] = b + (grey * 0.36 - b) * mossy * 0.9;
  }
  await sharp(px, { raw: atlas.info })
    .png()
    .toFile(path.join(out, 'tex', `${name}.png`));
}
console.log(`prepared ${out}`);
