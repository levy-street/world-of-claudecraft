// Ship a Blender-built Balgath GLB (build.py): dedup and prune, resample the baked
// per-frame animation down to the keys that matter, then meshopt-compress geometry
// and animation (quantized attributes; the runtime loader carries the meshopt
// decoder, src/render/assets/loader.ts). Textures stay as baked; the repo's KTX2
// pass (scripts/assets/compress_glb_textures.mjs) is the integration step's job.
//
//   node scripts/assets/balgath_cyclops/optimize.mjs <in.glb> <out.glb>
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: optimize.mjs <in.glb> <out.glb>');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
await doc.transform(
  dedup(),
  prune(),
  resample({ tolerance: 1e-4 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(output, doc);
console.log('OPTIMIZED', input, statSync(input).size, '->', output, statSync(output).size);
