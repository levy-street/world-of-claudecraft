// Ship the Blender-authored harbormaster's gear (scripts/assets/harbormaster_gear/): validate
// each exported hierarchy and its materials, stamp the source fingerprint, then prune, dedup
// and meshopt it into public/models/chars/npc_gear/. Never flatten or join: the game parents
// each model's root to one bone of the harbormaster's composed body (the `harbormaster` NPC
// prop set, src/render/characters/manifest.ts), with an identity transform, so the root must
// stay the scene's one child at the origin (characters/assets.ts flattenWeaponScene).
//
//   node scripts/assets/harbormaster_gear/extract_reference.mjs      (preview reference only)
//   blender --background --python scripts/assets/harbormaster_gear/build_harbormaster_gear.py
//   node scripts/assets/harbormaster_gear/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The fingerprinted inputs every gear model shares: the Blender sources (the ferry's shared
 *  shiplib included) and this builder. Each model adds its own exported source GLB. */
const SHARED_INPUTS = [
  'scripts/assets/harbormaster_gear/build_harbormaster_gear.py',
  'scripts/assets/eastbrook_ferry/shiplib.py',
  'scripts/assets/harbormaster_gear/build.mjs',
];

export const HARBORMASTER_GEAR_ASSETS = [
  {
    source: 'scripts/assets/harbormaster_gear/harbormaster_tricorne_source.glb',
    target: 'public/models/chars/npc_gear/harbormaster_tricorne.glb',
    bone: 'head',
    root: 'HarbormasterTricorne_ROOT',
    parts: ['Pipe', 'Tricorne'],
    materials: ['GearBrass', 'GearFelt', 'GearWood'],
  },
  {
    source: 'scripts/assets/harbormaster_gear/harbormaster_spyglass_source.glb',
    target: 'public/models/chars/npc_gear/harbormaster_spyglass.glb',
    bone: 'hips',
    root: 'HarbormasterSpyglass_ROOT',
    parts: ['Spyglass'],
    materials: ['GearBrass', 'GearLeather'],
  },
].map((asset) => ({ ...asset, inputs: [asset.source, ...SHARED_INPUTS] }));

export function sourceFingerprint(asset, root = ROOT) {
  const hash = createHash('sha256');
  for (const file of asset.inputs) {
    // Text inputs hash with normalized line endings so a Windows checkout and a Linux
    // checkout agree; the source GLB is binary and hashes byte for byte.
    const bytes = readFileSync(path.join(root, file));
    const body = file.endsWith('.glb')
      ? bytes
      : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
    hash.update(file).update('\0').update(body).update('\0');
  }
  return hash.digest('hex');
}

export async function buildHarbormasterGear(asset, root = ROOT) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const doc = await io.read(path.join(root, asset.source));
  const gltf = doc.getRoot();
  const top = gltf.listScenes()[0]?.listChildren() ?? [];
  if (top.length !== 1 || top[0].getName() !== asset.root) {
    throw new Error(`${asset.source}: the scene must hold exactly ${asset.root}`);
  }
  const [rootNode] = top;
  const t = rootNode.getTranslation();
  const r = rootNode.getRotation();
  const s = rootNode.getScale();
  if (t.some((v) => v !== 0) || r[3] !== 1 || s.some((v) => v !== 1)) {
    throw new Error(`${asset.root} must sit at the bone origin with no transform`);
  }
  if (rootNode.getExtras()?.harbormasterGear?.bone !== asset.bone) {
    throw new Error(`${asset.root} lost its bone extras`);
  }
  const children = rootNode
    .listChildren()
    .map((n) => n.getName())
    .sort();
  if (JSON.stringify(children) !== JSON.stringify(asset.parts)) {
    throw new Error(`${asset.root}: unexpected parts ${children.join(', ')}`);
  }
  await doc.transform(prune({ keepExtras: true, keepLeaves: true }));
  const materials = gltf
    .listMaterials()
    .map((material) => material.getName())
    .sort();
  if (JSON.stringify(materials) !== JSON.stringify(asset.materials)) {
    throw new Error(`Unexpected ${asset.root} materials: ${materials.join(', ')}`);
  }
  if (
    gltf.listTextures().length ||
    gltf.listCameras().length ||
    gltf.listSkins().length ||
    gltf.listAnimations().length
  ) {
    throw new Error('The gear ships texture-free, camera-free, unskinned and still');
  }
  gltf.setExtras({ sourceFingerprint: sourceFingerprint(asset, root), authoring: 'Blender' });
  await doc.transform(
    prune({ keepExtras: true, keepLeaves: true }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return io.writeBinary(doc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const asset of HARBORMASTER_GEAR_ASSETS) {
    const bytes = await buildHarbormasterGear(asset);
    mkdirSync(path.dirname(path.join(ROOT, asset.target)), { recursive: true });
    writeFileSync(path.join(ROOT, asset.target), bytes);
    console.log(
      `${asset.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
}
