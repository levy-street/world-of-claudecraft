// Ship the Blender-authored reward chest. Never flatten or join: the runtime
// drives Chest_Lid on its hinge and tints the Glow / InnerGlow materials.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const SOURCE = 'docs/design/reward-chest/chest_components.glb';
export const TARGET = 'public/models/props/hoard_reward_chest.glb';
export const NODES = [
  'Chest_Base',
  'Chest_InnerGlow',
  'Chest_Lid',
  'Chest_Lock',
  'ClueRewardChest_ROOT',
];
export const MATERIALS = ['Glow', 'InnerGlow', 'Metal', 'MetalLight', 'Wood', 'WoodDark'];

export function sourceFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  for (const file of [SOURCE, 'scripts/assets/reward_chest/build.mjs', 'pnpm-lock.yaml']) {
    hash
      .update(file)
      .update('\0')
      .update(readFileSync(path.join(root, file)))
      .update('\0');
  }
  return hash.digest('hex');
}

export async function buildChest(root = ROOT) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const doc = await io.read(path.join(root, SOURCE));
  const asset = doc.getRoot();
  const names = asset
    .listNodes()
    .map((node) => node.getName())
    .sort();
  if (JSON.stringify(names) !== JSON.stringify(NODES)) {
    throw new Error(`Unexpected Blender nodes: ${names.join(', ')}`);
  }
  const materials = asset
    .listMaterials()
    .map((material) => material.getName())
    .sort();
  if (JSON.stringify(materials) !== JSON.stringify(MATERIALS)) {
    throw new Error(`Unexpected Blender materials: ${materials.join(', ')}`);
  }
  if (asset.listAnimations().length || asset.listCameras().length || asset.listTextures().length) {
    throw new Error('Only static texture-free geometry may ship');
  }
  asset.setExtras({ sourceFingerprint: sourceFingerprint(root), authoring: 'Blender' });
  await doc.transform(
    prune({ keepExtras: true }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return io.writeBinary(doc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bytes = await buildChest();
  mkdirSync(path.dirname(path.join(ROOT, TARGET)), { recursive: true });
  writeFileSync(path.join(ROOT, TARGET), bytes);
  console.log(
    `chest: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
  );
}
