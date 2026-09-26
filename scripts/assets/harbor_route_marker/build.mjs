// Ship the Blender-authored harbor route marker (scripts/assets/harbor_route_marker/): validate
// the exported hierarchy, materials and text anchor, stamp the source fingerprint, then prune,
// dedup and meshopt it into public/models/props/harbor_route_marker.glb. Never flatten or
// join: the runtime (src/render/harbor_route_markers.ts) keeps or sheds the named tier groups
// and reads the destination text anchor by name.
//
//   blender --background --python scripts/assets/harbor_route_marker/build_harbor_route_marker.py
//   node scripts/assets/harbor_route_marker/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const HARBOR_ROUTE_MARKER_ASSET = {
  source: 'scripts/assets/harbor_route_marker/harbor_route_marker_source.glb',
  target: 'public/models/props/harbor_route_marker.glb',
  /** The fingerprinted inputs: the Blender sources (the ferry's shared shiplib
   *  included) and this builder. */
  inputs: [
    'scripts/assets/harbor_route_marker/harbor_route_marker_source.glb',
    'scripts/assets/harbor_route_marker/build_harbor_route_marker.py',
    'scripts/assets/eastbrook_ferry/shiplib.py',
    'scripts/assets/harbor_route_marker/build.mjs',
  ],
  /** Named nodes the runtime depends on. */
  requiredNodes: [
    'HarborRouteMarker_ROOT',
    'Post',
    'SignBoard',
    'MaritimeIcon',
    'MetalTrim',
    'OptionalLantern',
    'OptionalChain',
    'OptionalRope',
    'DestinationTextAnchor',
    'Socket_ArrowTip',
  ],
  materials: ['HarborGlow', 'HarborIron', 'HarborRope', 'HarborWood'],
};

export function sourceFingerprint(asset = HARBOR_ROUTE_MARKER_ASSET, root = ROOT) {
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

export async function buildHarborRouteMarker(asset = HARBOR_ROUTE_MARKER_ASSET, root = ROOT) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const doc = await io.read(path.join(root, asset.source));
  const gltf = doc.getRoot();
  const names = new Set(gltf.listNodes().map((node) => node.getName()));
  const missing = asset.requiredNodes.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`Marker source is missing nodes: ${missing.join(', ')}`);
  // the unused slot (shiplib's cloth index) never reaches a primitive: prune drops it
  await doc.transform(prune({ keepExtras: true, keepLeaves: true }));
  const materials = gltf
    .listMaterials()
    .map((material) => material.getName())
    .sort();
  if (JSON.stringify(materials) !== JSON.stringify(asset.materials)) {
    throw new Error(`Unexpected marker materials: ${materials.join(', ')}`);
  }
  if (
    gltf.listTextures().length ||
    gltf.listCameras().length ||
    gltf.listSkins().length ||
    gltf.listAnimations().length
  ) {
    throw new Error('The marker ships texture-free, camera-free, unskinned and still');
  }
  const extras = gltf.listScenes()[0]?.listChildren()[0]?.getExtras() ?? {};
  if (!extras.harborRouteMarker) throw new Error('HarborRouteMarker_ROOT lost its extras');
  const anchor = gltf.listNodes().find((node) => node.getName() === 'DestinationTextAnchor');
  if (!anchor?.getExtras().destinationText) {
    throw new Error('DestinationTextAnchor lost its text extras');
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
  const bytes = await buildHarborRouteMarker();
  mkdirSync(path.dirname(path.join(ROOT, HARBOR_ROUTE_MARKER_ASSET.target)), { recursive: true });
  writeFileSync(path.join(ROOT, HARBOR_ROUTE_MARKER_ASSET.target), bytes);
  console.log(
    `${HARBOR_ROUTE_MARKER_ASSET.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
  );
}
