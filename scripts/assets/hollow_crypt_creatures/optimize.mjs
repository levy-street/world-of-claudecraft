// Ship a Blender-built Hollow Crypt hero creature GLB (build_bone_drake.py,
// build_stone_gargoyle.py): dedup and prune, then meshopt-compress the geometry
// and the animation (quantized attributes; the runtime loader carries the
// meshopt decoder, src/render/assets/loader.ts). Textures stay as baked.
//
//   node scripts/assets/hollow_crypt_creatures/optimize.mjs public/models/creatures/crypt_drake.glb [...]
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: optimize.mjs <file.glb> [...]');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
for (const file of files) {
  const before = statSync(file).size;
  const doc = await io.read(file);
  await doc.transform(
    dedup(),
    prune(),
    resample(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(file, doc);
  console.log('OPTIMIZED', file, before, '->', statSync(file).size);
}
