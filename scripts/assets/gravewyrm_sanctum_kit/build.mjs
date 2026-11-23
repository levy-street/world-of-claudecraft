// Ship the Blender-authored Gravewyrm Sanctum kit (docs/design/dungeon-rework/kit/).
// Never flatten or join: the runtime bakes each Kit_* node on its own and splits
// it by material (KitStone lit, KitGlow emissive, KitGlass translucent clear ice
// and meltwater), as the Wildheart Basin kit's painter does.
//
//   "<blender>" -b --factory-startup --python docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_kit.py
//   node scripts/assets/gravewyrm_sanctum_kit/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const TOOLS = ['Hammer', 'Tongs', 'Anvil', 'Bellows'];

/** Every piece of the kit (docs/design/dungeon-rework/gravewyrm_sanctum.md, section 8).
 *  The Face* pieces, Kit_WyrmSilhouette and Kit_WyrmHeart share the Calving
 *  Face's frame; the IceWall_* shards share the wall's. */
export const GRAVEWYRM_SANCTUM_KIT_PIECES = [
  // The glacier.
  'GlacierWallA',
  'GlacierWallB',
  'IceFall',
  'SeracS',
  'SeracM',
  'SeracL',
  'IceBridge',
  'CrevasseEdgeA',
  'CrevasseEdgeB',
  'CrevasseEdgeC',
  'FrozenFall',
  'SnowDriftA',
  'SnowDriftB',
  'Sastrugi',
  // The rock.
  'ThornpeakRockA',
  'ThornpeakRockB',
  'ThornpeakRockC',
  'ThornpeakCrag',
  'MoraineRocks',
  'RockCliff',
  'HaulRoadKerb',
  // The Smith.
  ...TOOLS.map((t) => `SealPillar_${t}`),
  ...TOOLS.map((t) => `SealPillarCracked_${t}`),
  'SealShackle',
  'SmithsHammer',
  'RuneWall',
  'ChainAnchor',
  'ChainLink',
  'ChainHeap',
  'ChainBroken',
  'ChainBridge',
  'KeystoneSocket',
  'GateTunnel',
  'VigilCairn',
  // The held.
  'HeldGiantA',
  'HeldGiantB',
  'HeldGiantC',
  ...['A', 'B', 'C', 'D', 'E', 'F'].map((k) => `HeldDead${k}`),
  'VaultWall',
  // The cult.
  'CultTent',
  'Sledge',
  'SoulBrazier',
  'ThawPyre',
  'Pyre',
  'MeltChannel',
  'GoadRack',
  'RitualCircle',
  // The lake.
  'IcePlate',
  'IcePlateCracked',
  'IceChunkA',
  'IceChunkB',
  'IceChunkC',
  'PressureRidge',
  // The gates.
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((k) => `IceWall_${k}`),
  'ChainGate',
  'ChainGatePost',
  // The showpiece.
  'CalvingFace',
  'FaceCalved',
  'FaceCrack_0',
  'FaceCrack_1',
  'FacePlateFallen',
  'FaceCrack_2a',
  'FaceCrack_2b',
  'FaceCrack_2c',
  'FaceCrack_2d',
  'FaceCrack_3',
  'FaceChunkA',
  'FaceChunkB',
  'FaceChunkC',
  'WyrmSilhouette',
  'WyrmHeart',
];

export const ASSET = {
  source: 'docs/design/dungeon-rework/kit/gravewyrm_sanctum_kit_components.glb',
  target: 'public/models/props/gravewyrm_sanctum_kit.glb',
  root: 'GravewyrmSanctumKit_ROOT',
  materials: ['KitGlass', 'KitGlow', 'KitStone'],
};

export function sourceFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  // The Blender output itself is a local intermediate (reproducible from the
  // Python sources), so the fingerprint covers the sources.
  for (const file of [
    'docs/design/dungeon-rework/kit/hckit.py',
    'docs/design/dungeon-rework/kit/jaguar_head_sculpt.py',
    'docs/design/dungeon-rework/kit/gwkit.py',
    'docs/design/dungeon-rework/kit/gravewyrm_sculpt.py',
    'docs/design/dungeon-rework/kit/gravewyrm_nature.py',
    'docs/design/dungeon-rework/kit/gravewyrm_face.py',
    'docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_kit.py',
    'scripts/assets/gravewyrm_sanctum_kit/build.mjs',
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
  const expected = [ASSET.root, ...GRAVEWYRM_SANCTUM_KIT_PIECES.map((p) => `Kit_${p}`)].sort();
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
