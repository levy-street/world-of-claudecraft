// Ship the Gravewyrm Sanctum's interior AAA kit, the second Blender kit
// (docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_interior.py on the
// sculpt library gravewyrm_interior_sculpt.py). Never flatten or join: the
// runtime bakes each Kit_* node with the first kit's (src/render/
// gravewyrm_sanctum/sanctum_kit.ts) and splits it by material into the same
// three slot materials (KitStone lit, KitGlow the dim runes, KitGlass clear ice).
//
//   "<blender>" -b --factory-startup --python docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_interior.py -- \
//     --out tmp/asset_src/gravewyrm_sanctum_interior
//   node scripts/assets/gravewyrm_sanctum_interior/build.mjs
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

/** Every piece of the interior kit, by zone. */
export const GRAVEWYRM_SANCTUM_INTERIOR_PIECES = [
  // The Lock Terrace (Korgath).
  'LockSpur',
  'LockCurb',
  ...TOOLS.map((t) => `SealPillarV2_${t}`),
  ...TOOLS.map((t) => `SealPillarCrackedV2_${t}`),
  // Lip modules under the walkways' edges.
  'LipRockA',
  'LipRockB',
  'LipRockC',
  // The Ritual Vault (Velkhar) and the icy walks round it.
  'ThawPyreV2',
  'LipIceA',
  'LipIceB',
  'BoneHeap',
  // The walks between the bosses.
  'EdgeRubbleA',
  'EdgeRubbleB',
  'EdgeRubbleIceA',
  'EdgeRubbleIceB',
  'DriftA',
  'DriftB',
];

export const ASSET = {
  source: 'tmp/asset_src/gravewyrm_sanctum_interior/glb_raw/gravewyrm_sanctum_interior.glb',
  target: 'public/models/props/gravewyrm_sanctum_interior.glb',
  root: 'GravewyrmSanctumInterior_ROOT',
  materials: ['KitGlow', 'KitStone'],
};

export function sourceFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  // The Blender output is a local intermediate (reproducible from the Python
  // sources), so the fingerprint covers the sources.
  for (const file of [
    'docs/design/dungeon-rework/kit/jaguar_head_sculpt.py',
    'docs/design/dungeon-rework/kit/gravewyrm_sculpt.py',
    'docs/design/dungeon-rework/entrance/sanctum_gate_sculpt.py',
    'docs/design/dungeon-rework/entrance/entrance_common.py',
    'docs/design/dungeon-rework/kit/gravewyrm_interior_sculpt.py',
    'docs/design/dungeon-rework/kit/gravewyrm_vault_sculpt.py',
    'docs/design/dungeon-rework/kit/gravewyrm_paths_sculpt.py',
    'docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_interior.py',
    'scripts/assets/gravewyrm_sanctum_interior/build.mjs',
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
  const expected = [ASSET.root, ...GRAVEWYRM_SANCTUM_INTERIOR_PIECES.map((p) => `Kit_${p}`)].sort();
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
