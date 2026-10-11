// Ship the Blender-authored boss room kits (docs/design/boss-rooms/<room>/). Never
// flatten or join: the runtime instances each Kit_* node on its own, and breathes
// the KitGlow material apart from the painted KitSolid one. One row per room; the
// Emberforge kit, the first, keeps its own builder (scripts/assets/forge_room/).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** room id, its Blender root, and the pieces the theme instances. */
const KITS = [
  [
    'abyss',
    'AbyssKit_ROOT',
    [
      'LeviathanArch',
      'CoralColumn',
      'CoralShelf',
      'Anchor',
      'HangingChain',
      'Barnacles',
      'Wreckage',
      'Kelp',
      'GlowPolyp',
      'RibBones',
    ],
  ],
  [
    'frost',
    'FrostKit_ROOT',
    [
      'FrozenThrone',
      'FrozenSoldier',
      'FrozenBanner',
      'DeadBrazier',
      'EmbeddedWeapons',
      'WallIcicles',
      'FrozenRuin',
    ],
  ],
  [
    'void',
    'VoidKit_ROOT',
    [
      'Armillary',
      'RuneObelisk',
      'RuneObeliskBroken',
      'FloatingFragments',
      'BrokenMirror',
      'VoidCandles',
      'Lectern',
      'RuneWall',
    ],
  ],
  [
    'storm',
    'StormKit_ROOT',
    [
      'LightningSpire',
      'SplitMenhir',
      'LightningRod',
      'TornBanner',
      'BoneCluster',
      'GroundingChain',
      'StormShrine',
    ],
  ],
  [
    'warcamp',
    'WarcampKit_ROOT',
    [
      'WarlordGate',
      'Palisade',
      'SkullStake',
      'WarDrum',
      'Campfire',
      'PrisonCage',
      'WeaponRack',
      'BrokenCart',
      'HangingTrophies',
    ],
  ],
  [
    'nest',
    'NestKit_ROOT',
    [
      'GreatWeb',
      'WallWeb',
      'EggShells',
      'WrappedPrey',
      'BoneCluster',
      'TwistedRoots',
      'SilkColumn',
    ],
  ],
  [
    'crypt',
    'CryptKit_ROOT',
    [
      'OssuaryAltar',
      'Tombstones',
      'Sarcophagus',
      'BoneCandelabrum',
      'BrokenColumn',
      'FallenColumn',
      'SkullPile',
      'CryptArch',
      'HangingCenser',
    ],
  ],
];

export const ASSETS = KITS.map(([room, root, pieces]) => ({
  source: `docs/design/boss-rooms/${room}/${room}_kit_components.glb`,
  target: `public/models/props/hoard_${room}_kit.glb`,
  nodes: [root, ...pieces.map((piece) => `Kit_${piece}`)].sort(),
  materials: ['KitGlow', 'KitSolid'],
}));

export function sourceFingerprint(asset, root = ROOT) {
  const hash = createHash('sha256');
  for (const file of [asset.source, 'scripts/assets/boss_rooms/build.mjs']) {
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
  if (JSON.stringify(names) !== JSON.stringify(asset.nodes)) {
    throw new Error(`Unexpected Blender nodes in ${asset.source}: ${names.join(', ')}`);
  }
  const materials = gltf
    .listMaterials()
    .map((material) => material.getName())
    .sort();
  if (JSON.stringify(materials) !== JSON.stringify(asset.materials)) {
    throw new Error(`Unexpected Blender materials in ${asset.source}: ${materials.join(', ')}`);
  }
  // The runtime bakes ONE geometry per material per Kit_ node: a node that came out
  // of Blender with two parts on one material would silently lose one.
  for (const node of gltf.listNodes()) {
    const used = (node.getMesh()?.listPrimitives() ?? []).map((primitive) =>
      primitive.getMaterial()?.getName(),
    );
    if (new Set(used).size !== used.length) {
      throw new Error(`${node.getName()} in ${asset.source} repeats a material`);
    }
  }
  if (gltf.listAnimations().length || gltf.listCameras().length || gltf.listTextures().length) {
    throw new Error('Only static texture-free geometry may ship');
  }
  gltf.setExtras({ sourceFingerprint: sourceFingerprint(asset, root), authoring: 'Blender' });
  await doc.transform(
    prune({ keepExtras: true }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return io.writeBinary(doc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const asset of ASSETS) {
    const bytes = await buildAsset(asset);
    mkdirSync(path.dirname(path.join(ROOT, asset.target)), { recursive: true });
    writeFileSync(path.join(ROOT, asset.target), bytes);
    console.log(
      `${asset.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
}
