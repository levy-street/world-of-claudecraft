// Deterministic derived scenery. Existing KTX2 images are copied unchanged.
// Usage: node scripts/assets/build_scenery_lod.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { addSceneryLod, SCENERY_LOD_ASSETS } from './scenery_lod_build.mjs';
import { WocLodExtension } from './woc_character/woc_lod_extension.mjs';

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions([...ALL_EXTENSIONS, WocLodExtension])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const publicPath = (path) => fileURLToPath(new URL(`../../public/${path}`, import.meta.url));
for (const asset of SCENERY_LOD_ASSETS) {
  // This entry lives in scripts/assets, so public is two directories above it.
  const source = publicPath(asset.source);
  if (createHash('sha256').update(readFileSync(source)).digest('hex') !== asset.sha256) {
    throw Error(`Unrecognized source: ${asset.source}`);
  }
  const document = await io.read(source);
  const report = await addSceneryLod(document, asset);
  await io.write(publicPath(asset.output), document);
  console.log(asset.output, JSON.stringify(report));
}
