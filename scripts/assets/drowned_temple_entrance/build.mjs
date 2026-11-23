// Ship the Blender-authored Moon Stair, the Drowned Temple's world entrance
// (docs/design/dungeon-rework/entrance/build_temple_entrance.py). Three GLBs
// share one origin, the door at its terrain height: the gate and the stair
// (the moongate ring on its dais; the flight, its cheek walls, the colonnade
// and the two penitents), the works (the Glimmer Weir round the mirror, the
// moon pool's kerb and its stelae), and the render-only growth (lilies, reed
// and sedge, moss, hanging weed, the creeper and its moonflowers), one node per
// fading unit (the gate, the flight's treads, its east and west flanks, the works). Never flatten or join: the runtime
// (src/render/drowned_temple_entrance.ts) keeps each node and splits it by
// material (KitStone lit, KitLeaf lit and double sided, KitGlow the unlit
// silver inlay whose colour alpha is its place in the moonrise, KitWet the
// glossy lit stone under the standing water).
//
//   npx tsx docs/design/dungeon-rework/entrance/probe.mts temple -70 792 tmp/asset_src/drowned_temple_entrance/terreno 44 120
//   "<blender>" -b --factory-startup --python docs/design/dungeon-rework/entrance/build_temple_entrance.py -- //     --out tmp/asset_src/drowned_temple_entrance --terrain tmp/asset_src/drowned_temple_entrance/terreno --renders none
//   "<blender>" -b --factory-startup --python docs/design/dungeon-rework/entrance/support_check.py -- //     --blend tmp/asset_src/drowned_temple_entrance/drowned_temple_entrance.blend //     --terrain tmp/asset_src/drowned_temple_entrance/terreno/temple_heightgrid.json --water -5.85 --rims
//   node scripts/assets/drowned_temple_entrance/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RAW = 'tmp/asset_src/drowned_temple_entrance/glb_raw';

/** The three shipped GLBs, the Blender nodes each carries, and its materials. */
export const DROWNED_TEMPLE_ENTRANCE_ASSETS = [
  {
    source: `${RAW}/drowned_temple_entrance.glb`,
    target: 'public/models/props/drowned_temple_entrance.glb',
    root: 'TempleEntrance_ROOT',
    pieces: ['Entrance_Moongate', 'Entrance_MoonStair', 'Entrance_FlankEast', 'Entrance_FlankWest'],
    materials: ['KitGlow', 'KitStone', 'KitWet'],
  },
  {
    source: `${RAW}/drowned_temple_entrance_works.glb`,
    target: 'public/models/props/drowned_temple_entrance_works.glb',
    root: 'TempleEntranceWorks_ROOT',
    pieces: ['Entrance_Works'],
    materials: ['KitGlow', 'KitStone', 'KitWet'],
  },
  {
    source: `${RAW}/drowned_temple_entrance_growth.glb`,
    target: 'public/models/props/drowned_temple_entrance_growth.glb',
    root: 'TempleEntranceGrowth_ROOT',
    pieces: ['Growth_Gate', 'Growth_Stair', 'Growth_FlankEast', 'Growth_FlankWest', 'Growth_Works'],
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
    'docs/design/dungeon-rework/entrance/temple_moon_kit.py',
    'docs/design/dungeon-rework/entrance/build_temple_entrance.py',
    'scripts/assets/drowned_temple_entrance/build.mjs',
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
  for (const asset of DROWNED_TEMPLE_ENTRANCE_ASSETS) {
    const bytes = await buildAsset(asset);
    mkdirSync(path.dirname(path.join(ROOT, asset.target)), { recursive: true });
    writeFileSync(path.join(ROOT, asset.target), bytes);
    console.log(
      `${asset.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
}
