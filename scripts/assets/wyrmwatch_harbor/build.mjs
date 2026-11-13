// Ship the Blender-authored Wyrmwatch cliff harbor (scripts/assets/wyrmwatch_harbor/): validate
// the exported hierarchy, materials and root extras, stamp the source fingerprint, then prune,
// dedup, turn its painted maps into KTX2 and meshopt it into public/models/props/wyrmwatch_harbor.glb. Never flatten or join:
// the runtime (src/render/wyrmwatch_harbor.ts) keeps or sheds the named tier parts and lays the
// path from the named flagstones.
//
//   npx tsx scripts/assets/wyrmwatch_harbor/layout.ts
//   blender --background --python scripts/assets/wyrmwatch_harbor/build_wyrmwatch_harbor.py
//   node scripts/assets/wyrmwatch_harbor/build.mjs
//   node scripts/build_media_manifest.mjs generate
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import {
  checkPaintedMaps,
  checkShippedMaps,
  fingerprintBody,
  paintedMapInputs,
  paintedMapTransforms,
} from '../eastbrook_ferry/painted_maps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The painted base-colour map each material wears (scripts/assets/eastbrook_ferry/
 *  painted_maps.mjs: the ferry's own maps); the rope and the glow wear none. */
const PAINTED_MAPS = {
  HarborIron: 'ferry_fittings',
  HarborStone: 'harbour_stone',
  HarborWood: 'ferry_wood',
};

export const WYRMWATCH_HARBOR_ASSET = {
  source: 'scripts/assets/wyrmwatch_harbor/wyrmwatch_harbor_source.glb',
  target: 'public/models/props/wyrmwatch_harbor.glb',
  /** The fingerprinted inputs: the Blender sources (the house builder and the ferry's shared
   *  shiplib included),
   *  the sim layout they read, and this builder. */
  inputs: [
    'scripts/assets/wyrmwatch_harbor/wyrmwatch_harbor_source.glb',
    'scripts/assets/wyrmwatch_harbor/build_wyrmwatch_harbor.py',
    'scripts/assets/wyrmwatch_harbor/build_harbor_house.py',
    'scripts/assets/wyrmwatch_harbor/layout.json',
    'scripts/assets/eastbrook_ferry/shiplib.py',
    ...paintedMapInputs(PAINTED_MAPS),
    'scripts/assets/wyrmwatch_harbor/build.mjs',
  ],
  /** Named nodes the runtime depends on. */
  requiredNodes: [
    'WyrmwatchHarbor_ROOT',
    'QuayDecks',
    'StairFlights',
    'Landings',
    'Railings',
    'HarborGate',
    'Lanterns',
    'Cargo',
    'HarborTrim',
    'HarborClutter',
    'HouseFrame',
    'HouseWallNorth',
    'HouseWallSouth',
    'HouseWallEast',
    'HouseWallWest',
    'HouseRoof',
    'HouseFurnishings',
    'HouseClutter',
    'PathStoneA',
    'PathStoneB',
    'PathStoneC',
  ],
  materials: ['HarborGlow', 'HarborIron', 'HarborRope', 'HarborStone', 'HarborWood'],
  maps: PAINTED_MAPS,
  /** No map ships larger than this on a side. */
  maxMapSize: 512,
  /** A map this model shows little of ships smaller: map name to pixels a side. */
  mapSizes: { ferry_fittings: 256 },
};

export function sourceFingerprint(asset = WYRMWATCH_HARBOR_ASSET, root = ROOT) {
  const hash = createHash('sha256');
  for (const file of asset.inputs) {
    // Text inputs hash with normalized line endings so a Windows checkout and a Linux
    // checkout agree; the source GLB and the maps are binary and hash byte for byte.
    const body = fingerprintBody(file, readFileSync(path.join(root, file)));
    hash.update(file).update('\0').update(body).update('\0');
  }
  return hash.digest('hex');
}

export async function buildWyrmwatchHarbor(asset = WYRMWATCH_HARBOR_ASSET, root = ROOT) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const doc = await io.read(path.join(root, asset.source));
  const gltf = doc.getRoot();
  const names = new Set(gltf.listNodes().map((node) => node.getName()));
  const missing = asset.requiredNodes.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`Harbor source is missing nodes: ${missing.join(', ')}`);
  await doc.transform(prune({ keepExtras: true, keepLeaves: true }));
  const materials = gltf
    .listMaterials()
    .map((material) => material.getName())
    .sort();
  if (JSON.stringify(materials) !== JSON.stringify(asset.materials)) {
    throw new Error(`Unexpected harbor materials: ${materials.join(', ')}`);
  }
  if (gltf.listCameras().length || gltf.listSkins().length || gltf.listAnimations().length) {
    throw new Error('The harbor ships camera-free, unskinned and still');
  }
  // one painted base-colour map on each material that wears one, and no other texture
  checkPaintedMaps(gltf, asset.maps);
  const extras = gltf.listScenes()[0]?.listChildren()[0]?.getExtras() ?? {};
  if (!extras.wyrmwatchHarbor) throw new Error('WyrmwatchHarbor_ROOT lost its extras');
  gltf.setExtras({ sourceFingerprint: sourceFingerprint(asset, root), authoring: 'Blender' });
  await doc.transform(
    // prune also drops the texture coordinates of the map-free materials
    prune({ keepExtras: true, keepLeaves: true }),
    dedup(),
    ...(await paintedMapTransforms(asset.maxMapSize, asset.mapSizes)),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  checkShippedMaps(gltf, asset.maxMapSize, asset.mapSizes);
  return io.writeBinary(doc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bytes = await buildWyrmwatchHarbor();
  mkdirSync(path.dirname(path.join(ROOT, WYRMWATCH_HARBOR_ASSET.target)), { recursive: true });
  writeFileSync(path.join(ROOT, WYRMWATCH_HARBOR_ASSET.target), bytes);
  console.log(
    `${WYRMWATCH_HARBOR_ASSET.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
  );
}
