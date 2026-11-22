// Write a single-material GLB's base colour map out as PNG (KTX2 maps are transcoded
// with KTX-Software's `ktx`). node extract_color.mjs <in.glb> <out.png>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [, , src, out] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.readBinary(fs.readFileSync(src));
const tex = doc.getRoot().listMaterials()[0].getBaseColorTexture();
if (tex.getMimeType() === 'image/ktx2') {
  const k = `${out}.ktx2`;
  fs.writeFileSync(k, tex.getImage());
  execFileSync('ktx', ['extract', '--transcode', 'rgba8', k, out]);
  fs.unlinkSync(k);
} else {
  fs.writeFileSync(out, tex.getImage());
}
console.log('wrote', out);
