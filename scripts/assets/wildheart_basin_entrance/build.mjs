// Ship the Blender-authored Jaguar Maw, the Wildheart Basin's world entrance
// (docs/design/dungeon-rework/entrance/build_wildheart_entrance.py). Three GLBs
// share one origin, the door at its terrain height: the idol (a jaguar's head
// of fitted megaliths: the neck and its collar with the fret standing in its
// band, the skull with its domed forehead, brows, cheekbones, jowls and two
// small round ears, the short deep muzzle with its nose and lips, the upper
// jaw out over the causeway, the palate, the lower jaw's two rami, the jade
// eyes, the fangs, the pelt's rosettes and spots let in as dark stones, the
// nape's panels and its collapse, the rubble core behind the joints, the
// strangler fig's trunk and roots), the court (the heaved flagstone causeway and its kerbs, the two
// fire bowls, the Sunbone's tusks with their war cloth, the fallen stone by
// the east cheek and the blocks down the bank and in the shallows), and the
// render-only growth (the fig's crown, lianas, fern, taro, reed, moss). Never
// flatten or join: the runtime
// (src/render/wildheart_basin_entrance.ts) keeps each Entrance_* node and
// splits it by material (KitStone lit, KitLeaf lit and double sided, KitGlow
// the unlit coals, KitWet the glossy lit jade). The crown's leaf cards carry
// authored normals (each pad lit as one rounded mass): keep the NORMAL
// attribute as exported.
//
// The height grid is probed with the door ALREADY at its place in
// src/sim/content/wildheart.ts: the door's own calm pad shapes the ground.
//
//   npx tsx docs/design/dungeon-rework/entrance/probe.mts wildheart -237 1093 tmp/asset_src/wildheart_basin_entrance/terrain 40 120
//   "<blender>" -b --factory-startup --python docs/design/dungeon-rework/entrance/build_wildheart_entrance.py -- //     --out tmp/asset_src/wildheart_basin_entrance --terrain tmp/asset_src/wildheart_basin_entrance/terrain --renders none
//   node scripts/assets/wildheart_basin_entrance/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RAW = 'tmp/asset_src/wildheart_basin_entrance/glb_raw';

/** The three shipped GLBs, the Blender nodes each carries, and its materials. */
export const WILDHEART_BASIN_ENTRANCE_ASSETS = [
  {
    source: `${RAW}/wildheart_basin_entrance.glb`,
    target: 'public/models/props/wildheart_basin_entrance.glb',
    root: 'WildheartEntrance_ROOT',
    pieces: ['Entrance_Idol'],
    materials: ['KitStone', 'KitWet'],
  },
  {
    source: `${RAW}/wildheart_basin_entrance_court.glb`,
    target: 'public/models/props/wildheart_basin_entrance_court.glb',
    root: 'WildheartEntranceCourt_ROOT',
    pieces: ['Entrance_Court'],
    materials: ['KitGlow', 'KitLeaf', 'KitStone'],
  },
  {
    source: `${RAW}/wildheart_basin_entrance_growth.glb`,
    target: 'public/models/props/wildheart_basin_entrance_growth.glb',
    root: 'WildheartEntranceGrowth_ROOT',
    pieces: ['Entrance_Growth'],
    materials: ['KitLeaf'],
  },
];

export function sourceFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  // The Blender output is a local intermediate (reproducible from the Python
  // sources and the sim's own terrain), so the fingerprint covers the sources.
  for (const file of [
    'docs/design/dungeon-rework/kit/hckit.py',
    'docs/design/dungeon-rework/entrance/entrance_common.py',
    'docs/design/dungeon-rework/kit/jaguar_head_sculpt.py',
    'docs/design/dungeon-rework/entrance/wildheart_ruin_kit.py',
    'docs/design/dungeon-rework/entrance/wildheart_idol_sculpt.py',
    'docs/design/dungeon-rework/entrance/build_wildheart_entrance.py',
    'scripts/assets/wildheart_basin_entrance/build.mjs',
  ]) {
    hash
      .update(file)
      .update('\0')
      .update(readFileSync(path.join(root, file)))
      .update('\0');
  }
  return hash.digest('hex');
}

export async function buildAsset(asset, root = ROOT) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const doc = await io.read(path.join(root, asset.source));
  const gltf = doc.getRoot();
  const names = gltf
    .listNodes()
    .map((node) => node.getName())
    .sort();
  const expected = [asset.root, ...asset.pieces].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected Blender nodes in ${asset.source}: ${names.join(', ')}`);
  }
  const materials = gltf
    .listMaterials()
    .map((material) => material.getName())
    .sort();
  if (JSON.stringify(materials) !== JSON.stringify(asset.materials)) {
    throw new Error(`Unexpected Blender materials in ${asset.source}: ${materials.join(', ')}`);
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
  for (const asset of WILDHEART_BASIN_ENTRANCE_ASSETS) {
    const bytes = await buildAsset(asset);
    mkdirSync(path.dirname(path.join(ROOT, asset.target)), { recursive: true });
    writeFileSync(path.join(ROOT, asset.target), bytes);
    console.log(
      `${asset.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
}
