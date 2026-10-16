// Ship the Blender-authored Fallen Chapel, the Hollow Crypt's world entrance
// (docs/design/dungeon-rework/entrance/build_crypt_entrance.py). Four GLBs
// share one origin, the door at its terrain height: the south gable with the
// crypt stair-house and the nave's furnishings, the nave walls with the
// chancel and the apse, the churchyard (headstones, lychgate, yard walls, the
// dead yew, the approach flags), and the render-only growth (ivy, grass,
// bramble, moss, fallen leaves). Never flatten or join: the runtime
// (src/render/hollow_crypt_entrance.ts) keeps each Entrance_* node and splits
// it by material (KitStone lit, KitLeaf lit and double sided, KitVoid the
// unlit black behind the stair portal).
//
//   npx tsx docs/design/dungeon-rework/entrance/probe.mts crypt 80 90 tmp/asset_src/hollow_crypt_entrance/terrain 40 120
//   "<blender>" -b --factory-startup --python docs/design/dungeon-rework/entrance/build_crypt_entrance.py -- \
//     --out tmp/asset_src/hollow_crypt_entrance --terrain tmp/asset_src/hollow_crypt_entrance/terrain --renders none
//   "<blender>" -b --factory-startup tmp/asset_src/hollow_crypt_entrance/hollow_crypt_entrance_v2.blend \
//     --python docs/design/dungeon-rework/entrance/support_audit.py -- \
//     --terrain tmp/asset_src/hollow_crypt_entrance/terrain --out tmp/asset_src/hollow_crypt_entrance/audit
//   node scripts/assets/hollow_crypt_entrance/build.mjs
//
// The second Blender step is the support audit: it lists every piece of the
// built model that hangs in the air. Ship only when that list is empty.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RAW = 'tmp/asset_src/hollow_crypt_entrance/glb_raw';

/** The four shipped GLBs, the Blender nodes each carries, and its materials. */
export const HOLLOW_CRYPT_ENTRANCE_ASSETS = [
  {
    source: `${RAW}/hollow_crypt_entrance.glb`,
    target: 'public/models/props/hollow_crypt_entrance.glb',
    root: 'CryptEntrance_ROOT',
    pieces: ['Entrance_Details', 'Entrance_Gable', 'Entrance_StairHouse'],
    materials: ['KitStone', 'KitVoid'],
  },
  {
    source: `${RAW}/hollow_crypt_entrance_walls.glb`,
    target: 'public/models/props/hollow_crypt_entrance_walls.glb',
    root: 'CryptEntranceWalls_ROOT',
    pieces: ['Entrance_Nave'],
    materials: ['KitStone'],
  },
  {
    source: `${RAW}/hollow_crypt_entrance_props.glb`,
    target: 'public/models/props/hollow_crypt_entrance_props.glb',
    root: 'CryptEntranceProps_ROOT',
    pieces: ['Entrance_Outside'],
    materials: ['KitLeaf', 'KitStone'],
  },
  {
    source: `${RAW}/hollow_crypt_entrance_growth.glb`,
    target: 'public/models/props/hollow_crypt_entrance_growth.glb',
    root: 'CryptEntranceGrowth_ROOT',
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
    'docs/design/dungeon-rework/entrance/crypt_ruin_kit.py',
    'docs/design/dungeon-rework/entrance/build_crypt_entrance.py',
    'scripts/assets/hollow_crypt_entrance/build.mjs',
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
  for (const asset of HOLLOW_CRYPT_ENTRANCE_ASSETS) {
    const bytes = await buildAsset(asset);
    mkdirSync(path.dirname(path.join(ROOT, asset.target)), { recursive: true });
    writeFileSync(path.join(ROOT, asset.target), bytes);
    console.log(
      `${asset.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
}
