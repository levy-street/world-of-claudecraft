// Approved Blender components only. Never flatten/join: runtime animates named layers.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPONENTS = {
  orb: ['Core', 'LocalArcs', 'OuterEnergy', 'Sparks'],
  impact: ['Crown', 'GroundArcs', 'ImpactCore', 'RadialBurst', 'Sparks'],
};

export function sourceFingerprint(kind, root = ROOT) {
  const hash = createHash('sha256');
  for (const file of [
    `docs/design/orbital-lightning/${kind}_components.glb`,
    'scripts/assets/orbital_lightning/build.mjs',
    'pnpm-lock.yaml',
  ]) {
    hash
      .update(file)
      .update('\0')
      .update(readFileSync(path.join(root, file)))
      .update('\0');
  }
  return hash.digest('hex');
}

export async function buildComponent(kind, root = ROOT) {
  if (!Object.hasOwn(COMPONENTS, kind)) throw new Error(`Unknown component: ${kind}`);
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const doc = await io.read(
    path.join(root, `docs/design/orbital-lightning/${kind}_components.glb`),
  );
  const asset = doc.getRoot();
  const names = asset
    .listNodes()
    .map((node) => node.getName())
    .sort();
  if (JSON.stringify(names) !== JSON.stringify(COMPONENTS[kind])) {
    throw new Error(`Unexpected Blender component nodes: ${names.join(', ')}`);
  }
  if (asset.listAnimations().length || asset.listCameras().length || asset.listTextures().length) {
    throw new Error('Only static texture-free component geometry may ship');
  }
  asset.setExtras({ sourceFingerprint: sourceFingerprint(kind, root), authoring: 'Blender' });
  await doc.transform(
    prune({ keepExtras: true }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return io.writeBinary(doc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.join(ROOT, 'public/vfx/orbital-lightning');
  mkdirSync(target, { recursive: true });
  for (const kind of Object.keys(COMPONENTS)) {
    const bytes = await buildComponent(kind);
    writeFileSync(path.join(target, `${kind}.glb`), bytes);
    console.log(
      `${kind}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
}
