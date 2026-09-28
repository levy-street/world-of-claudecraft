// Ship the Blender-authored Mirefen tavern (scripts/assets/mirefen_tavern/): validate the
// exported hierarchy, materials and root extras, stamp the source fingerprint, then prune,
// dedup and meshopt it into public/models/props/mirefen_tavern.glb. Never flatten or join:
// the runtime (src/render/mirefen_tavern.ts) keeps or sheds the named tier parts and cuts the
// named shell parts away for the camera.
//
//   npx tsx scripts/assets/mirefen_tavern/layout.ts
//   blender --background --python scripts/assets/mirefen_tavern/build_tavern.py
//   node scripts/assets/mirefen_tavern/build.mjs
//   node scripts/build_media_manifest.mjs generate
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const MIREFEN_TAVERN_ASSET = {
  source: 'scripts/assets/mirefen_tavern/mirefen_tavern_source.glb',
  target: 'public/models/props/mirefen_tavern.glb',
  /** The fingerprinted inputs: the Blender sources (and the ferry's shared shiplib they
   *  build with), the sim layout they read, and this builder. */
  inputs: [
    'scripts/assets/mirefen_tavern/mirefen_tavern_source.glb',
    'scripts/assets/mirefen_tavern/build_tavern.py',
    'scripts/assets/mirefen_tavern/tavern_frame.py',
    'scripts/assets/mirefen_tavern/tavern_shell.py',
    'scripts/assets/mirefen_tavern/tavern_furnish.py',
    'scripts/assets/mirefen_tavern/tavern_facade.py',
    'scripts/assets/mirefen_tavern/tavern_jetty.py',
    'scripts/assets/mirefen_tavern/tavern_roofing.py',
    'scripts/assets/mirefen_tavern/tavern_weather.py',
    'scripts/assets/mirefen_tavern/tavern_grounds.py',
    'scripts/assets/mirefen_tavern/tavern_dog.py',
    'scripts/assets/mirefen_tavern/layout.json',
    'scripts/assets/eastbrook_ferry/shiplib.py',
    'scripts/assets/mirefen_tavern/build.mjs',
  ],
  /** Named nodes the runtime depends on. */
  requiredNodes: [
    'MirefenTavern_ROOT',
    'TavernFrame',
    'TavernFurnishings',
    'TavernLights',
    'TavernGrounds',
    'TavernDog',
    'HallWallFront',
    'HallWallFrontLeft',
    'HallWallFrontRight',
    'HallWallBack',
    'HallWallLeft',
    'HallWallRight',
    'HallRoof',
    'WingWallEast',
    'WingWallBack',
    'WingWallWest',
    'WingRoof',
    'TowerWall',
    'TowerRoof',
    'HallPorch',
    'BarPillar',
    'TavernTrim',
    'TavernClutter',
  ],
  materials: ['TavernGlow', 'TavernMetal', 'TavernPlaster', 'TavernStone', 'TavernWood'],
};

export function sourceFingerprint(asset = MIREFEN_TAVERN_ASSET, root = ROOT) {
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

export async function buildMirefenTavern(asset = MIREFEN_TAVERN_ASSET, root = ROOT) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const doc = await io.read(path.join(root, asset.source));
  const gltf = doc.getRoot();
  const names = new Set(gltf.listNodes().map((node) => node.getName()));
  const missing = asset.requiredNodes.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`Tavern source is missing nodes: ${missing.join(', ')}`);
  await doc.transform(prune({ keepExtras: true, keepLeaves: true }));
  const materials = gltf
    .listMaterials()
    .map((material) => material.getName())
    .sort();
  if (JSON.stringify(materials) !== JSON.stringify(asset.materials)) {
    throw new Error(`Unexpected tavern materials: ${materials.join(', ')}`);
  }
  if (
    gltf.listTextures().length ||
    gltf.listCameras().length ||
    gltf.listSkins().length ||
    gltf.listAnimations().length
  ) {
    throw new Error('The tavern ships texture-free, camera-free, unskinned and still');
  }
  const extras = gltf.listScenes()[0]?.listChildren()[0]?.getExtras() ?? {};
  if (!extras.mirefenTavern) throw new Error('MirefenTavern_ROOT lost its extras');
  gltf.setExtras({ sourceFingerprint: sourceFingerprint(asset, root), authoring: 'Blender' });
  await doc.transform(
    prune({ keepExtras: true, keepLeaves: true }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return io.writeBinary(doc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bytes = await buildMirefenTavern();
  mkdirSync(path.dirname(path.join(ROOT, MIREFEN_TAVERN_ASSET.target)), { recursive: true });
  writeFileSync(path.join(ROOT, MIREFEN_TAVERN_ASSET.target), bytes);
  console.log(
    `${MIREFEN_TAVERN_ASSET.target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
  );
}
