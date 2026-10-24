// Prepare the Drakemaw Raptor's unrigged source for Blender's glTF importer.
//
//   node scripts/assets/drakemaw_raptor/prep.mjs <source glb> <out blender glb>
//
// Blender refuses a file that declares KHR_texture_basisu, and it cannot decode
// meshopt, so the meshopt buffers are decoded on read, the quantized attributes
// expanded to float, the node's dequantization transform baked into the
// vertices, and the KTX2 texture transcoded to PNG through Khronos's `ktx` CLI
// (KTX-Software 4.3+ on PATH, or KTX_BIN; the same tool the repo's texture
// compression needs). The output is a THROWAWAY: ship.mjs puts the source's
// original KTX2 bytes back, so the Blender round trip never re-encodes the paint.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, transformMesh } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export async function prepForBlender(input, output) {
  if (process.env.KTX_BIN) {
    process.env.PATH = `${process.env.PATH ?? ''}${path.delimiter}${process.env.KTX_BIN}`;
  }
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });
  const doc = await io.readBinary(fs.readFileSync(input));
  const root = doc.getRoot();

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'drakemaw-ktx-'));
  try {
    for (const [i, tex] of root.listTextures().entries()) {
      if (tex.getMimeType() !== 'image/ktx2') continue;
      const ktx = path.join(work, `t${i}.ktx2`);
      const png = path.join(work, `t${i}.png`);
      fs.writeFileSync(ktx, tex.getImage());
      execFileSync('ktx', ['extract', '--level', '0', '--transcode', 'rgba8', ktx, png], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      tex.setImage(fs.readFileSync(png)).setMimeType('image/png').setURI(`raptor_tex${i}.png`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  await doc.transform(dequantize());
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    transformMesh(mesh, node.getWorldMatrix());
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
  for (const ext of root.listExtensionsUsed()) ext.dispose();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await io.write(output, doc);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error('usage: prep.mjs <source glb> <out blender glb>');
    process.exit(1);
  }
  await prepForBlender(input, output);
  console.log('wrote', output);
}
