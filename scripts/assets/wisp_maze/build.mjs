// Ship the Blender-authored wisp maze kit (docs/design/wisp-maze/): the hedge pieces,
// the gate, lantern post and flagstones of the Evergarden trial, and its garden spirit
// with one crest per guardian. Never flatten or join: the runtime
// (src/render/wisp_maze_kit.ts) bakes each Kit_* node on its own, split by material
// (KitSolid painted, KitTint multiplied by a guardian's colour, KitGlow what shines).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The pieces, in the order the Blender source builds them. */
export const PIECES = [
  'HedgePost',
  'HedgeEnd',
  'HedgeStraight',
  'HedgeCorner',
  'HedgeTee',
  'HedgeCross',
  'HedgeGate',
  'LanternPost',
  'Flagstones',
  'Spirit',
  'Crest0',
  'Crest1',
  'Crest2',
  'Crest3',
  'Crest4',
];

export const ASSET = {
  source: 'docs/design/wisp-maze/wisp_maze_kit_components.glb',
  target: 'public/models/props/wisp_maze_kit.glb',
  nodes: ['WispMazeKit_ROOT', ...PIECES.map((piece) => `Kit_${piece}`)].sort(),
  materials: ['KitGlow', 'KitSolid', 'KitTint'],
};

export function sourceFingerprint(asset = ASSET, root = ROOT) {
  const hash = createHash('sha256');
  for (const file of [asset.source, 'scripts/assets/wisp_maze/build.mjs']) {
    hash
      .update(file)
      .update('\0')
      .update(readFileSync(path.join(root, file)))
      .update('\0');
  }
  return hash.digest('hex');
}

export async function buildAsset(asset = ASSET, root = ROOT) {
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
  if (new Set(gltf.listMaterials().map((m) => m.getName())).size !== asset.materials.length) {
    throw new Error('Kit materials must stay distinct by name');
  }
  if (gltf.listAnimations().length || gltf.listCameras().length || gltf.listTextures().length) {
    throw new Error('Only static texture-free geometry may ship');
  }
  gltf.setExtras({ sourceFingerprint: sourceFingerprint(asset, root), authoring: 'Blender' });
  // Deduplicate geometry only: KitSolid and KitTint are identical materials in the
  // file (the runtime tells them apart by NAME), and merging them would fold the
  // spirit's dyed leaves into its painted twigs.
  await doc.transform(
    prune({ keepExtras: true }),
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return io.writeBinary(doc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bytes = await buildAsset();
  mkdirSync(path.dirname(path.join(ROOT, ASSET.target)), { recursive: true });
  writeFileSync(path.join(ROOT, ASSET.target), bytes);
  console.log(
    `${ASSET.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
  );
}
