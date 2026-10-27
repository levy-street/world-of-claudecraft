// Ship the Blender-authored Heart kit of the Smith's Heart raid (phase 2J,
// docs/design/raid/kit/): the final room's platform (the Anvil of the World,
// its walk, balustrade and keel), the Arrival Terrace and its return portal,
// the Heart Bridge, the four altars, the roots of the mountain, the heart and
// its bed, and the colossus's rock pieces. Never flatten or join: the runtime
// bakes each Kit_* node on its own (src/render/smith_heart/heart_kit.ts) and
// places it over the Heart's plan (src/render/smith_heart/heart_room_kit_plan_core.ts)
// or moves it (src/render/smith_heart_fx/final_fx.ts).
//
//   "<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_heart_kit.py
//   node scripts/assets/smith_heart_heart_kit/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every piece of the kit (docs/design/raid/smith_heart.md, section 5.17). */
export const SMITH_HEART_HEART_KIT_PIECES = [
  // The Anvil of the World: its walk and balustrade, its keel.
  'AnvilFloor',
  'AnvilKeel',
  // The Arrival Terrace and its keel, the Heart Bridge.
  'TerraceFloor',
  'TerraceKeel',
  'HeartBridge',
  // The four altars and the roots of the mountain that hold the platform.
  'AltarHammer',
  'AltarBreath',
  'AltarQuench',
  'AltarHeat',
  'HeartRoot',
  // The heart and its bed deep in the chasm.
  'HeartCrystal',
  'CoreBed',
  // The colossus's rock pieces (the body until its own model).
  'ColTorso',
  'ColHip',
  'ColHead',
  'ColShoulder',
  'ColUpperArm',
  'ColForearm',
  'ColFist',
  'ColShardA',
  'ColShardB',
  'ColShardC',
  // The marks the torn and the crumbled pieces leave on the platform.
  'TornSocket',
  'RubbleScatter',
  // Mythic's Walking Slab (the Slabwright's soul dragging its pillar,
  // src/render/smith_heart_fx/council_slab_fx.ts): its claws, its collar, its face.
  'SlabClaw',
  'SlabCollar',
  'SlabFace',
];

export const ASSET = {
  source: 'docs/design/raid/kit/smith_heart_heart_kit_components.glb',
  target: 'public/models/props/smith_heart_heart_kit.glb',
  root: 'SmithHeartHeartKit_ROOT',
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
    'docs/design/raid/kit/ring_pieces.py',
    'docs/design/raid/kit/ring_sculpt.py',
    'docs/design/raid/kit/heat_pieces.py',
    'docs/design/raid/kit/heart_pieces.py',
    'docs/design/raid/kit/build_smith_heart_heart_kit.py',
    'docs/design/raid/kit/build_smith_heart_hammer_kit.py',
    'scripts/assets/smith_heart_heart_kit/build.mjs',
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
  const expected = [ASSET.root, ...SMITH_HEART_HEART_KIT_PIECES.map((p) => `Kit_${p}`)].sort();
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
