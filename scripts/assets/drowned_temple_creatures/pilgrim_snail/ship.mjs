// Ship the Blender-built Tide Pilgrim (the Balgath kit ship.mjs):
// the raw build.py export in, the game file out.
//
//   KTX_BIN=<KTX-Software bin> node ship.mjs <raw glb> <out glb>
//
// 1. OPTIMIZE: dedup, prune, resample the baked per-frame clips, meshopt with
//    quantization (the runtime loader carries the decoder).
// 2. KTX2: the repo's codec choice (normal map UASTC, the rest ETC1S); the normal
//    map is resized to 1024 first (UASTC is about a byte a texel).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Mode, toktx } from '@gltf-transform/cli';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const rootRequire = createRequire(import.meta.url);
const cliRequire = createRequire(rootRequire.resolve('@gltf-transform/cli'));
const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
if (process.env.KTX_BIN) {
  process.env.PATH = `${process.env.PATH ?? ''}${path.delimiter}${process.env.KTX_BIN}`;
}

export const TEXEL_BUDGET = Object.freeze({ normal: 1024, other: 2048 });

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: ship.mjs <raw glb> <out glb>');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });
const doc = await io.readBinary(fs.readFileSync(input));
const budget = TEXEL_BUDGET;
await doc.transform(
  dedup(),
  prune(),
  resample({ tolerance: 1e-4 }),
  textureCompress({
    encoder: sharp,
    targetFormat: 'png',
    slots: /^normalTexture$/,
    resize: [budget.normal, budget.normal],
  }),
  textureCompress({
    encoder: sharp,
    targetFormat: 'png',
    slots: /^(baseColorTexture|metallicRoughnessTexture|emissiveTexture)$/,
    resize: [budget.other, budget.other],
  }),
  toktx({ mode: Mode.UASTC, slots: /^normalTexture$/, jobs: 1, encoder: sharp }),
  toktx({ mode: Mode.ETC1S, jobs: 1, encoder: sharp }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
const buf = Buffer.from(await io.writeBinary(doc));
const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
const left = (json.images ?? []).filter((i) => i.mimeType !== 'image/ktx2');
if (left.length) throw new Error(`${input}: ${left.length} textures were not converted`);
fs.writeFileSync(output, buf);
const images = (json.images ?? [])
  .map((i) => `${i.name}=${json.bufferViews[i.bufferView].byteLength}`)
  .join(' ');
const meshes = (json.meshes ?? []).map((m) => m.name).join(',');
const anims = (json.animations ?? []).map((a) => a.name).join(',');
console.log(path.basename(output), 'total', buf.length, 'meshes', meshes, 'anims', anims, images);
