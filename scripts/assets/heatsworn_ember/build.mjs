// Assemble heatsworn_ember.glb: the Emberkin GLB with its base colour swapped for the
// recoloured map and the red glow added as its emissive map. Both go in as PNG;
// scripts/assets/compress_glb_textures.mjs then turns them into KTX2.
// node build.mjs <emberkin.glb> <color_red.png> <emissive_red.png> <out.glb>
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [, , src, colorPng, emissivePng, out] = process.argv;
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.readBinary(fs.readFileSync(src));
const mats = doc.getRoot().listMaterials();
if (mats.length !== 1) throw new Error(`expected one material, got ${mats.length}`);
const mat = mats[0];
mat.getBaseColorTexture().setImage(fs.readFileSync(colorPng)).setMimeType('image/png');
const glow = doc
  .createTexture('glow_emissive')
  .setImage(fs.readFileSync(emissivePng))
  .setMimeType('image/png');
mat.setEmissiveTexture(glow).setEmissiveFactor([1, 1, 1]);
mat.getEmissiveTextureInfo().setTexCoord(mat.getBaseColorTextureInfo().getTexCoord());
// The source's accessors are quantized as read (KHR_mesh_quantization stays), so the
// FILTER method only re-compresses them.
doc
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
fs.writeFileSync(out, Buffer.from(await io.writeBinary(doc)));
console.log('wrote', out, fs.statSync(out).size);
