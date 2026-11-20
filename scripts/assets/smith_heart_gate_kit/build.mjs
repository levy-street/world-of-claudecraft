// Ship the Blender-authored gate kit of the Smith's Heart raid
// (docs/design/raid/kit/): the carved threshold and the standing stones every
// forge seal gate (the three vein gates and the Heart Bridge's) stands on,
// and the crystal its curtain of light rises from. Never flatten or join:
// the runtime bakes each Kit_* node on its own
// (src/render/smith_heart/heart_kit.ts) and stands it in each gate
// (src/render/smith_heart/heart_gates.ts).
//
//   "<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_gate_kit.py
//   node scripts/assets/smith_heart_gate_kit/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every piece of the kit (docs/design/raid/smith_heart.md, section 5.1). */
export const SMITH_HEART_GATE_KIT_PIECES = ['GateSill', 'GateStone'];

export const ASSET = {
  source: 'docs/design/raid/kit/smith_heart_gate_kit_components.glb',
  target: 'public/models/props/smith_heart_gate_kit.glb',
  root: 'SmithHeartGateKit_ROOT',
  materials: ['KitGlow', 'KitStone'],
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
    'docs/design/raid/kit/gate_pieces.py',
    'docs/design/raid/kit/build_smith_heart_gate_kit.py',
    'docs/design/raid/kit/build_smith_heart_hammer_kit.py',
    'scripts/assets/smith_heart_gate_kit/build.mjs',
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
  const expected = [ASSET.root, ...SMITH_HEART_GATE_KIT_PIECES.map((p) => `Kit_${p}`)].sort();
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
