// Ship the Blender-authored Drowned Temple kit (docs/design/dungeon-rework/kit/).
// Never flatten or join: the runtime bakes each Kit_* node on its own and splits
// it by material (KitStone lit, KitGlow emissive, KitGlass translucent glass and water).
//
//   node scripts/assets/drowned_temple_kit/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every piece the runtime instances (src/render/drowned_temple/temple_kit.ts). */
export const DROWNED_TEMPLE_KIT_PIECES = [
  'AmphiTier',
  'Balustrade',
  'Brazier',
  'Column',
  'ColumnBroken',
  'ColumnFallen',
  'CoralCluster',
  'CraterSpire',
  'GreatConch',
  'Kerb',
  'LampPillar',
  'LilyPads',
  'MoonAltar',
  'Moongate',
  'Obelisk',
  'Pearls',
  'PrismPlinth',
  'PrismTower',
  'Reeds',
  'RuinedArch',
  'Shells',
  'StandingStone',
  'StatueConch',
  'StatueFallen',
  'StatuePraying',
  'StatueSinger',
  'SunkenTemple',
  'TidepoolBasin',
  'VeilArch',
  'WardArch',
  'Wayshrine',
];

export const ASSET = {
  source: 'docs/design/dungeon-rework/kit/drowned_temple_kit_components.glb',
  target: 'public/models/props/drowned_temple_kit.glb',
  root: 'DrownedTempleKit_ROOT',
  materials: ['KitGlass', 'KitGlow', 'KitStone'],
};

export function sourceFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  // The Blender output itself is a local intermediate (reproducible from the
  // Python sources), so the fingerprint covers the sources.
  for (const file of [
    'docs/design/dungeon-rework/kit/hckit.py',
    'docs/design/dungeon-rework/kit/build_drowned_temple_kit.py',
    'scripts/assets/drowned_temple_kit/build.mjs',
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
  const expected = [ASSET.root, ...DROWNED_TEMPLE_KIT_PIECES.map((p) => `Kit_${p}`)].sort();
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
