// Ship the Blender-authored Seal Gate, the Gravewyrm Sanctum's world entrance
// (docs/design/dungeon-rework/entrance/). Three GLBs share one origin, the
// door at its terrain height: the gate itself (pylons, lintel, the rock-cut
// tunnel, the chains), the plaza props (the chain heap, the cult's debris, the
// cairn, the headstones, the ground blend) and the render-only ice tongue on
// the ridge. Never flatten or join: the runtime (src/render/sanctum_seal_gate.ts)
// keeps each Entrance_* node and splits it by material (KitStone lit,
// KitGlow the unlit runes, KitIce the glacier ice and icicles).
//
//   npx tsx docs/design/dungeon-rework/entrance/probe.mts sanctum 0 858 tmp/asset_src/sanctum_seal_gate/terrain 32 130
//   "<blender>" -b --factory-startup --python docs/design/dungeon-rework/entrance/build_sanctum_entrance.py -- \
//     --out tmp/asset_src/sanctum_seal_gate --terrain tmp/asset_src/sanctum_seal_gate/terrain --renders none
//   node scripts/assets/sanctum_seal_gate/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The three shipped GLBs, the Blender nodes each carries, and its materials. */
export const SANCTUM_SEAL_GATE_ASSETS = [
  {
    source: 'tmp/asset_src/sanctum_seal_gate/glb_raw/sanctum_seal_gate.glb',
    target: 'public/models/props/sanctum_seal_gate.glb',
    root: 'SanctumSealGate_ROOT',
    pieces: ['Entrance_Chains', 'Entrance_Lintel', 'Entrance_Pylons', 'Entrance_Tunnel'],
    materials: ['KitGlow', 'KitIce', 'KitStone'],
  },
  {
    source: 'tmp/asset_src/sanctum_seal_gate/glb_raw/sanctum_seal_gate_props.glb',
    target: 'public/models/props/sanctum_seal_gate_props.glb',
    root: 'SanctumSealGateProps_ROOT',
    pieces: ['Entrance_GroundBlend', 'Entrance_Graveyard', 'Entrance_PlazaProps'],
    materials: ['KitStone'],
  },
  {
    source: 'tmp/asset_src/sanctum_seal_gate/glb_raw/sanctum_seal_gate_ice.glb',
    target: 'public/models/props/sanctum_seal_gate_ice.glb',
    root: 'SanctumIceTongue_ROOT',
    pieces: ['Entrance_IceTongue'],
    materials: ['KitIce', 'KitStone'],
  },
];

export function sourceFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  // The Blender output is a local intermediate (reproducible from the Python
  // sources and the sim's own terrain), so the fingerprint covers the sources.
  for (const file of [
    'docs/design/dungeon-rework/kit/hckit.py',
    'docs/design/dungeon-rework/entrance/entrance_common.py',
    'docs/design/dungeon-rework/entrance/build_sanctum_entrance.py',
    'scripts/assets/sanctum_seal_gate/build.mjs',
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
  for (const asset of SANCTUM_SEAL_GATE_ASSETS) {
    const bytes = await buildAsset(asset);
    mkdirSync(path.dirname(path.join(ROOT, asset.target)), { recursive: true });
    writeFileSync(path.join(ROOT, asset.target), bytes);
    console.log(
      `${asset.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
}
