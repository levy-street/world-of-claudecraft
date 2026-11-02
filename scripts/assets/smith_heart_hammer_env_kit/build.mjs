// Ship the Hammer vein's painted kit (docs/design/raid/kit/
// build_smith_heart_hammer_env_kit.py): never flatten or join, the runtime bakes
// each Env_* node on its own. The textures then go to KTX2 through the shared
// step (scripts/assets/compress_glb_textures.mjs).
//
//   "<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_hammer_env_kit.py -- --src tmp/hammer_env --out tmp/hammer_env/smith_heart_hammer_env_kit_components.glb
//   node scripts/assets/smith_heart_hammer_env_kit/build.mjs
//   node scripts/assets/compress_glb_textures.mjs --file public/models/props/smith_heart_hammer_env_kit.glb
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const ASSET = {
  source: 'tmp/hammer_env/smith_heart_hammer_env_kit_components.glb',
  target: 'public/models/props/smith_heart_hammer_env_kit.glb',
};

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});
const doc = await io.read(path.join(ROOT, ASSET.source));
const gltf = doc.getRoot();
if (gltf.listAnimations().length || gltf.listCameras().length) {
  throw new Error('Only static geometry may ship');
}
// Nothing a painted piece's material does not read: the paint carries the light.
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
mkdirSync(path.dirname(path.join(ROOT, ASSET.target)), { recursive: true });
writeFileSync(path.join(ROOT, ASSET.target), bytes);
console.log(
  `${ASSET.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
);
