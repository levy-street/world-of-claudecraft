// Ship one of the Smith's Heart's painted kits (the Hammer's, the Breath's and the Quench's
// smith_heart_<vein>_env_kit/build.mjs): never flatten or join, the runtime bakes each
// Env_* node on its own (src/render/smith_heart/env_kit_bake.ts). Every map a painted
// piece's material does not read is dropped (the paint carries the light), then prune,
// dedup and meshopt. The textures go to KTX2 afterwards through the shared step
// (scripts/assets/compress_glb_textures.mjs).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Read `source` (the Blender build, repo-relative) and write the shipping GLB to `target`
 *  (repo-relative); prints and returns its size and sha256. */
export async function shipEnvKit({ source, target }) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const doc = await io.read(path.join(ROOT, source));
  const gltf = doc.getRoot();
  if (gltf.listAnimations().length || gltf.listCameras().length) {
    throw new Error('Only static geometry may ship');
  }
  for (const material of gltf.listMaterials()) {
    material.setNormalTexture(null);
    material.setOcclusionTexture(null);
    material.setMetallicRoughnessTexture(null);
  }
  gltf.setExtras({ authoring: 'Blender, Tripo P2 and ChatGPT paintings' });
  await doc.transform(
    prune({ keepExtras: true }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const bytes = await io.writeBinary(doc);
  mkdirSync(path.dirname(path.join(ROOT, target)), { recursive: true });
  writeFileSync(path.join(ROOT, target), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  console.log(`${target}: ${bytes.length} bytes, sha256 ${sha256}`);
  return { bytes: bytes.length, sha256 };
}
