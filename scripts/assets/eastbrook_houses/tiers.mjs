// Writes the texture-tier files beside every painted town building: <name>.half.glb and
// <name>.quarter.glb, the same model with every map at half and at a quarter of its size.
// A profile that cannot afford the full maps loads one of those instead
// (src/render/placed_texture_tier_core.ts); geometry, nodes and bounds are untouched.
//
//   node scripts/assets/eastbrook_houses/tiers.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TOWN = path.join(ROOT, 'public/models/tidehold');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
function shipped(file) {
  const bytes = readFileSync(file);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  return (json.extensionsUsed ?? []).includes('EXT_meshopt_compression');
}

const TIERS = [
  ['half', 2],
  ['quarter', 4],
];
let written = 0;
for (const look of readdirSync(TOWN).filter((name) => name.startsWith('harbour'))) {
  const dir = path.join(TOWN, look);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.glb') || /\.(half|quarter|lod|parts)\.glb$/.test(file)) continue;
    // A file optimise.mjs has already shipped (meshopt, KTX2 maps) keeps the tiers cut from
    // it before that pass: only a fresh build's WebP maps can be resized here, so a rebuild
    // of one lot cuts that lot's tiers and leaves the rest alone.
    if (shipped(path.join(dir, file))) continue;
    for (const [tier, divide] of TIERS) {
      const doc = await io.read(path.join(dir, file));
      for (const texture of doc.getRoot().listTextures()) {
        const image = texture.getImage();
        if (!image) continue;
        const meta = await sharp(image).metadata();
        const width = Math.max(4, Math.round((meta.width ?? 4) / divide));
        const height = Math.max(4, Math.round((meta.height ?? 4) / divide));
        const pipeline = sharp(image).resize(width, height, { kernel: 'lanczos3' });
        // every map keeps the format it shipped in, so a tier is never heavier than the full file
        const mime = texture.getMimeType();
        const out =
          mime === 'image/webp'
            ? await pipeline.webp({ quality: 88, alphaQuality: 100 }).toBuffer()
            : mime === 'image/jpeg'
              ? await pipeline.jpeg({ quality: 88 }).toBuffer()
              : await pipeline.png().toBuffer();
        texture.setImage(new Uint8Array(out));
      }
      await io.write(path.join(dir, file.replace(/\.glb$/, `.${tier}.glb`)), doc);
      written++;
    }
  }
}
console.log(`wrote ${written} texture-tier files`);
