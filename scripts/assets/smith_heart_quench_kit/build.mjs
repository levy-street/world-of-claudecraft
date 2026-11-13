// Ship the Blender-authored Quench kit of the Smith's Heart raid (phase 2H,
// docs/design/raid/kit/): the Quench Basin's fire bowls, the Smith's great
// blades of ice sunk in the Frozen Lake, the old ice heaped against the
// basin's walls, the steam vents, the Singing Ice's blades and cracks, the
// landings' standing stones, the low walls along every Quench walk over the
// void, the frozen falls on the vein's walls and the drifts of snow. Never
// flatten or join: the runtime bakes each Kit_* node on its own
// (src/render/smith_heart/heart_kit.ts) and places it over the Quench's plan
// (src/render/smith_heart/quench_kit_plan_core.ts).
//
//   "<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_quench_kit.py
//   node scripts/assets/smith_heart_quench_kit/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every piece of the kit (docs/design/raid/smith_heart.md, section 5.15). */
export const SMITH_HEART_QUENCH_KIT_PIECES = [
  // The Quench Basin: its fire bowls, steam vents and the old ice heaped
  // against its walls; the blades sunk in the Frozen Lake.
  'LakeBrazier',
  'SteamVent',
  'IceShelfA',
  'IceShelfB',
  'SunkBlade',
  // The Singing Ice: its blades and its cracks.
  'IceBlade',
  'IceCrackA',
  'IceCrackB',
  // The landings: their standing stones, the low walls over the void.
  'FrostStone',
  'QuenchWallA',
  'QuenchWallB',
  // The vein's walls and floors: the frozen falls, the drifts of snow.
  'FrozenFallA',
  'FrozenFallB',
  'SnowDriftA',
  'SnowDriftB',
];

export const ASSET = {
  source: 'docs/design/raid/kit/smith_heart_quench_kit_components.glb',
  target: 'public/models/props/smith_heart_quench_kit.glb',
  root: 'SmithHeartQuenchKit_ROOT',
  materials: ['KitGlow', 'KitIce', 'KitStone'],
};

export function sourceFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  // The Blender output itself is a local intermediate (reproducible from the
  // Python sources), so the fingerprint covers the sources, the shared
  // dungeon kit library included.
  for (const file of [
    'docs/design/dungeon-rework/kit/hckit.py',
    'docs/design/dungeon-rework/kit/gwkit.py',
    'docs/design/dungeon-rework/kit/jaguar_head_sculpt.py',
    'docs/design/dungeon-rework/kit/gravewyrm_sculpt.py',
    'docs/design/raid/kit/shkit.py',
    'docs/design/raid/kit/ring_sculpt.py',
    'docs/design/raid/kit/quench_pieces.py',
    'docs/design/raid/kit/build_smith_heart_quench_kit.py',
    'docs/design/raid/kit/build_smith_heart_hammer_kit.py',
    'scripts/assets/smith_heart_quench_kit/build.mjs',
  ]) {
    hash
      .update(file)
      .update('\0')
      .update(readFileSync(path.join(root, file)))
      .update('\0');
  }
  return hash.digest('hex');
}

export async function buildKit(root = ROOT) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const doc = await io.read(path.join(root, ASSET.source));
  const gltf = doc.getRoot();
  const names = gltf
    .listNodes()
    .map((node) => node.getName())
    .sort();
  const expected = [ASSET.root, ...SMITH_HEART_QUENCH_KIT_PIECES.map((p) => `Kit_${p}`)].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected Blender nodes: ${names.join(', ')}`);
  }
  const materials = gltf
    .listMaterials()
    .map((material) => material.getName())
    .sort();
  if (JSON.stringify(materials) !== JSON.stringify(ASSET.materials)) {
    throw new Error(`Unexpected Blender materials: ${materials.join(', ')}`);
  }
  if (gltf.listAnimations().length || gltf.listCameras().length || gltf.listTextures().length) {
    throw new Error('Only static texture-free geometry may ship');
  }
  gltf.setExtras({ sourceFingerprint: sourceFingerprint(root), authoring: 'Blender' });
  await doc.transform(
    prune({ keepExtras: true }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return io.writeBinary(doc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bytes = await buildKit();
  mkdirSync(path.dirname(path.join(ROOT, ASSET.target)), { recursive: true });
  writeFileSync(path.join(ROOT, ASSET.target), bytes);
  console.log(
    `${ASSET.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
  );
}
