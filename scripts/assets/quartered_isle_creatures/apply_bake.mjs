// Put a baked base colour and glow map on a rigged creature GLB, both resized to the
// 512 px creature norm and written as PNG (scripts/assets/compress_glb_textures.mjs
// then turns them into KTX2). Every other map is resized to 512 px as well.
// node apply_bake.mjs <rigged.glb> <base.png|-> <emissive.png|-> <out.glb>
// Pass - for both to keep Tripo's own texture and only resize the maps.
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [, , src, basePng, emPng, out] = process.argv;
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.readBinary(fs.readFileSync(src));
const mats = doc.getRoot().listMaterials();
if (mats.length !== 1) throw new Error(`expected one material, got ${mats.length}`);
const mat = mats[0];
const to512 = (buf) => sharp(buf).resize(512, 512, { kernel: 'lanczos3' }).png().toBuffer();
for (const t of doc.getRoot().listTextures()) {
  if (t.getMimeType() === 'image/ktx2') throw new Error('expected PNG/JPEG maps from Tripo');
  t.setImage(await to512(t.getImage())).setMimeType('image/png');
}
if (basePng !== '-') mat.getBaseColorTexture().setImage(await to512(fs.readFileSync(basePng)));
if (emPng !== '-') {
  const glow = doc
    .createTexture('glow_emissive')
    .setImage(await to512(fs.readFileSync(emPng)))
    .setMimeType('image/png');
  mat.setEmissiveTexture(glow).setEmissiveFactor([1, 1, 1]);
  mat.getEmissiveTextureInfo().setTexCoord(mat.getBaseColorTextureInfo().getTexCoord());
}
fs.writeFileSync(out, Buffer.from(await io.writeBinary(doc)));
console.log('wrote', out, fs.statSync(out).size);
