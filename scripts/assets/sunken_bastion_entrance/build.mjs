// Ship the Blender-authored Drowned Gate Tower, the Sunken Bastion's world
// entrance (docs/design/dungeon-rework/entrance/build_bastion_entrance.py).
// Three GLBs share one origin, the door at its terrain height: the gatehouse
// (two leaning round towers, the gate front with its rosette and jammed
// portcullis, the open court, the inner arch and its flood sill, the winch,
// the hoarding), the ruins (the curtain wall, the fallen tower drum, the
// causeway flags, the peat and its standing water), and the render-only growth
// (reed, sedge, hanging weed, moss, barnacle crust, Olen's banner). Never
// flatten or join: the runtime (src/render/sunken_bastion_entrance.ts) keeps
// each Entrance_* node and splits it by material (KitStone lit, KitLeaf lit
// and double sided, KitGlow the unlit star glass, KitWet the glossy lit water
// and glass).
//
//   npx tsx docs/design/dungeon-rework/entrance/probe.mts bastion 45 515 tmp/asset_src/sunken_bastion_entrance/terrain 40 120
//   "<blender>" -b --factory-startup --python docs/design/dungeon-rework/entrance/build_bastion_entrance.py -- \
//     --out tmp/asset_src/sunken_bastion_entrance --terrain tmp/asset_src/sunken_bastion_entrance/terrain --renders none
//   node scripts/assets/sunken_bastion_entrance/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RAW = 'tmp/asset_src/sunken_bastion_entrance/glb_raw';

/** The three shipped GLBs, the Blender nodes each carries, and its materials. */
export const SUNKEN_BASTION_ENTRANCE_ASSETS = [
  {
    source: `${RAW}/sunken_bastion_entrance.glb`,
    target: 'public/models/props/sunken_bastion_entrance.glb',
    root: 'BastionEntrance_ROOT',
    pieces: ['Entrance_Gatehouse'],
    materials: ['KitGlow', 'KitStone', 'KitWet'],
  },
  {
    source: `${RAW}/sunken_bastion_entrance_ruins.glb`,
    target: 'public/models/props/sunken_bastion_entrance_ruins.glb',
    root: 'BastionEntranceRuins_ROOT',
    pieces: ['Entrance_Ruins'],
    materials: ['KitStone', 'KitWet'],
  },
  {
    source: `${RAW}/sunken_bastion_entrance_growth.glb`,
    target: 'public/models/props/sunken_bastion_entrance_growth.glb',
    root: 'BastionEntranceGrowth_ROOT',
    pieces: ['Entrance_Growth'],
    materials: ['KitLeaf', 'KitStone'],
  },
];

export function sourceFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  // The Blender output is a local intermediate (reproducible from the Python
  // sources and the sim's own terrain), so the fingerprint covers the sources.
  for (const file of [
    'docs/design/dungeon-rework/kit/hckit.py',
    'docs/design/dungeon-rework/entrance/entrance_common.py',
    'docs/design/dungeon-rework/entrance/bastion_ruin_kit.py',
    'docs/design/dungeon-rework/entrance/build_bastion_entrance.py',
    'scripts/assets/sunken_bastion_entrance/build.mjs',
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
  for (const asset of SUNKEN_BASTION_ENTRANCE_ASSETS) {
    const bytes = await buildAsset(asset);
    mkdirSync(path.dirname(path.join(ROOT, asset.target)), { recursive: true });
    writeFileSync(path.join(ROOT, asset.target), bytes);
    console.log(
      `${asset.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
}
