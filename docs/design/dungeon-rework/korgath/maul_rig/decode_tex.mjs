// The body as Blender can read it: KTX2 textures decoded to PNG, meshopt and
// quantization off (review and authoring only, never shipped).
//   node decode_tex.mjs <body.glb> <out.glb>

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.readBinary(
  new Uint8Array(
    readFileSync(process.argv[2] ?? 'public/models/creatures/woc_sanctum_korgath.glb'),
  ),
);
// KTX-Software's `ktx` tool (4.3+): on PATH, or KTX_BIN.
const KTX = process.env.KTX_BIN ?? 'ktx';
let i = 0;
for (const t of doc.getRoot().listTextures()) {
  const f = `${process.argv[3]}.tex${i}.ktx2`;
  const p = `${process.argv[3]}.tex${i}.png`;
  writeFileSync(f, t.getImage());
  execFileSync(KTX, ['extract', '--transcode', 'rgba8', f, p]);
  t.setImage(new Uint8Array(readFileSync(p))).setMimeType('image/png');
  console.log('tex', i, t.getName(), t.getMimeType());
  i++;
}
for (const e of doc.getRoot().listExtensionsUsed())
  if (/meshopt|basisu|quantization/.test(e.extensionName)) e.dispose();
await doc.transform(dequantize());
writeFileSync(process.argv[3] ?? 'tmp/korgath_aaa/korgath_tex.glb', await io.writeBinary(doc));
console.log('ok');
