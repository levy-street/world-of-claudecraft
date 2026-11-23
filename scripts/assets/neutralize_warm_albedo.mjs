// Neutralise the yellow cast in a Tripo character's base-colour atlas before it is compressed.
//
// The art-guide skeletons were concepted as "aged, yellowed ivory" bone and Tripo baked that
// (plus its own warm shading) into every texel: the shipped bone read yellow-brown in game.
// This pulls ONLY the yellow-orange band toward neutral bone (hue about 15 to 70 degrees,
// feathered at both edges), so violet robes, soul-green glows, blue rime and grey iron keep
// their colour. Saturation in the band drops by `--strength` (default 0.6) and lightness lifts
// a touch so the bone reads pale rather than muddy.
//
// Usage (run from the repo root, on the rigged source GLB the asset spec compresses):
//   node scripts/assets/neutralize_warm_albedo.mjs <in.glb> <out.glb> [--strength 0.6]

import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const sharp = require('sharp');

const args = process.argv.slice(2);
const [input, output] = args;
const strengthAt = args.indexOf('--strength');
const STRENGTH = strengthAt >= 0 ? Number(args[strengthAt + 1]) : 0.6;
if (!input || !output || !(STRENGTH >= 0 && STRENGTH <= 1)) {
  throw new Error('usage: neutralize_warm_albedo.mjs <in.glb> <out.glb> [--strength 0..1]');
}

/** 0..1 membership of a hue (degrees) in the warm band, feathered 10 degrees each side. */
function warmWeight(hue) {
  if (hue < 5 || hue > 80) return 0;
  if (hue < 15) return (hue - 5) / 10;
  if (hue > 70) return (80 - hue) / 10;
  return 1;
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hue2rgb(p, q, t) {
  let u = t;
  if (u < 0) u += 1;
  if (u > 1) u -= 1;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const t = h / 360;
  return [hue2rgb(p, q, t + 1 / 3), hue2rgb(p, q, t), hue2rgb(p, q, t - 1 / 3)];
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const baseColorTextures = new Set();
for (const mat of doc.getRoot().listMaterials()) {
  const tex = mat.getBaseColorTexture();
  if (tex) baseColorTextures.add(tex);
}
for (const tex of baseColorTextures) {
  const image = tex.getImage();
  if (!image) continue;
  const src = sharp(Buffer.from(image));
  const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let i = 0; i < data.length; i += ch) {
    const [h, s, l] = rgbToHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    const w = warmWeight(h) * STRENGTH;
    if (w <= 0) continue;
    const [r, g, b] = hslToRgb(h, s * (1 - w), l + 0.06 * w * (1 - l));
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
  }
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: ch } })
    .png()
    .toBuffer();
  tex.setImage(new Uint8Array(png)).setMimeType('image/png');
}
await io.write(output, doc);
console.log(
  `${output}: ${baseColorTextures.size} base-colour texture(s) neutralised at strength ${STRENGTH}`,
);
