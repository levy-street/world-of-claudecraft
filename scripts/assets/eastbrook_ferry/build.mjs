// Ship the Blender-authored Eastbrook ferry (scripts/assets/eastbrook_ferry/): validate the
// exported hierarchy, materials and idle clip, stamp the source fingerprint, then prune,
// dedup and meshopt it into public/models/props/eastbrook_ferry.glb. Never flatten or join:
// the runtime (src/render/transport_ship.ts) picks the LOD groups, animates the named sail
// and flag nodes, and merges the static parts per material itself.
//
//   blender --background --python scripts/assets/eastbrook_ferry/build_eastbrook_ferry.py
//   node scripts/assets/eastbrook_ferry/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const FERRY_ASSET = {
  source: 'scripts/assets/eastbrook_ferry/eastbrook_ferry_source.glb',
  target: 'public/models/props/eastbrook_ferry.glb',
  /** The fingerprinted inputs: the Blender sources and this builder. */
  inputs: [
    'scripts/assets/eastbrook_ferry/eastbrook_ferry_source.glb',
    'scripts/assets/eastbrook_ferry/build_eastbrook_ferry.py',
    'scripts/assets/eastbrook_ferry/shiplib.py',
    'scripts/assets/eastbrook_ferry/build.mjs',
  ],
  /** Named nodes the runtime depends on (unnamed quantization wrappers are ignored). */
  requiredNodes: [
    'TransportShip_ROOT',
    'Ship_Motion',
    'LOD0',
    'LOD1',
    'LOD2',
    'LOD3',
    'Hull',
    'Deck',
    'Railings',
    'Masts',
    'MainMast',
    'SecondaryMast',
    'MizzenMast',
    'Sails',
    'MainSail',
    'MainTopsail',
    'SecondarySail',
    'SecondaryTopsail',
    'MizzenSail',
    'JibSail',
    'Rigging',
    'Structures',
    'RearCabin',
    'CaptainDeck',
    'Bow',
    'Stairs',
    'Figurehead',
    'Wheel',
    'Props',
    'Barrels',
    'Crates',
    'Rope',
    'Benches',
    'Flags',
    'Gangplank',
    'Sockets',
    'Socket_Gangway_Port',
    'Socket_Gangway_Starboard',
    'Socket_Gangplank_Hinge',
    'Socket_BowSplash',
    'Socket_Wake',
    'Socket_Helm',
    'AnimationControllers',
  ],
  materials: ['FerryCloth', 'FerryGlow', 'FerryIron', 'FerryRope', 'FerryWood'],
  clip: 'Idle',
};

export function sourceFingerprint(asset = FERRY_ASSET, root = ROOT) {
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

export async function buildFerry(asset = FERRY_ASSET, root = ROOT) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const doc = await io.read(path.join(root, asset.source));
  const gltf = doc.getRoot();
  const names = new Set(gltf.listNodes().map((node) => node.getName()));
  const missing = asset.requiredNodes.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`Ferry source is missing nodes: ${missing.join(', ')}`);
  const materials = gltf
    .listMaterials()
    .map((material) => material.getName())
    .sort();
  if (JSON.stringify(materials) !== JSON.stringify(asset.materials)) {
    throw new Error(`Unexpected ferry materials: ${materials.join(', ')}`);
  }
  if (gltf.listTextures().length || gltf.listCameras().length || gltf.listSkins().length) {
    throw new Error('The ferry ships texture-free, camera-free and unskinned');
  }
  const animations = gltf.listAnimations();
  if (animations.length !== 1) {
    throw new Error(`Expected one idle clip, found ${animations.length}`);
  }
  animations[0].setName(asset.clip);
  for (const channel of animations[0].listChannels()) {
    const target = channel.getTargetNode()?.getName() ?? '';
    if (channel.getTargetPath() === 'weights') throw new Error('No morph animation ships');
    if (!target) throw new Error('An idle channel targets an unnamed node');
  }
  const extras = gltf.listScenes()[0]?.listChildren()[0]?.getExtras() ?? {};
  if (!extras.transportShip) throw new Error('TransportShip_ROOT lost its layout extras');
  gltf.setExtras({ sourceFingerprint: sourceFingerprint(asset, root), authoring: 'Blender' });
  await doc.transform(
    resample({ tolerance: 1e-5 }),
    prune({ keepExtras: true, keepLeaves: true }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return io.writeBinary(doc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bytes = await buildFerry();
  mkdirSync(path.dirname(path.join(ROOT, FERRY_ASSET.target)), { recursive: true });
  writeFileSync(path.join(ROOT, FERRY_ASSET.target), bytes);
  console.log(
    `${FERRY_ASSET.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
  );
}
