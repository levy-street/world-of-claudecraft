// Deterministic export, optimization, and contract verification of the Mirefen muster
// camp kit (the army camps Balgath marches between and smashes).
//
// Usage:
//   node scripts/assets/muster_camp/export_muster_camp.mjs
//   node scripts/assets/muster_camp/export_muster_camp.mjs --raw-only
//   node scripts/assets/muster_camp/export_muster_camp.mjs --blender=<path to blender 5.2.1>
//
// 1. Runs the Blender factory (model.py) in --background: one raw GLB per piece in
//    tmp/asset_src/muster_camp/.
// 2. Stamps the source fingerprint (source_fingerprint.mjs) into every raw GLB.
// 3. Optimizes through scripts/assets/build_assets.mjs with specs/muster_camp.json
//    into public/models/props/, then again into a candidate root, and requires the two
//    to match byte for byte.
// 4. Verifies the contract (contract.mjs) on raw AND shipped files: triangle and byte
//    ceilings, texture-free, COLOR_0 on every primitive, the six named material
//    buckets only, floor-seated and centred, the sculptRuntime root extras, meshopt on
//    the shipped files, and the fingerprint.
// After a run, regenerate the media manifest:
//   node scripts/build_media_manifest.mjs generate
// and re-pin tests/muster_camp_asset.test.ts from the printed summary.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import {
  MUSTER_CAMP_BLENDER_VERSION,
  MUSTER_CAMP_MATERIALS,
  MUSTER_CAMP_PIECES,
  MUSTER_TORCH_FLAME_HEIGHT,
} from './contract.mjs';
import { musterCampSourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const FACTORY = path.join(HERE, 'model.py');
const RAW_DIR = path.join(ROOT, 'tmp/asset_src/muster_camp');
const SPEC = path.join(ROOT, 'scripts/assets/specs/muster_camp.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const SHIPPING_DIR = path.join(ROOT, 'public/models/props');
const CANDIDATE_ROOT = path.join(ROOT, 'tmp/asset_optimized/muster_camp/deterministic');
const blenderArg = process.argv.find((arg) => arg.startsWith('--blender='));
const BLENDER = blenderArg
  ? blenderArg.slice('--blender='.length)
  : 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const rawOnly = process.argv.includes('--raw-only');

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function createNodeIo() {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

function runBlender() {
  const version = spawnSync(BLENDER, ['--version'], { encoding: 'utf8' });
  assertCondition(version.status === 0, `blender not runnable at ${BLENDER}`);
  assertCondition(
    version.stdout.includes(`Blender ${MUSTER_CAMP_BLENDER_VERSION}`),
    `muster camp kit is authored against Blender ${MUSTER_CAMP_BLENDER_VERSION}; found: ${version.stdout.split('\n')[0]}`,
  );
  mkdirSync(RAW_DIR, { recursive: true });
  const result = spawnSync(
    BLENDER,
    ['--background', '--factory-startup', '--python', FACTORY, '--', '--out', RAW_DIR],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const report = /MUSTER_KIT_REPORT_BEGIN\n([\s\S]*?)MUSTER_KIT_REPORT_END/.exec(
    result.stdout.replaceAll('\r\n', '\n'),
  );
  if (result.status !== 0 || !report) {
    process.stderr.write(result.stdout.slice(-4000));
    process.stderr.write(result.stderr.slice(-4000));
    throw new Error(`blender factory failed: ${result.status ?? 'unknown'}`);
  }
  process.stdout.write(`factory report:\n${report[1]}`);
}

async function stampSourceFingerprint(glbPath, sourceFingerprint) {
  const io = await createNodeIo();
  const document = await io.read(glbPath);
  const root = document.getRoot();
  root.setExtras({ ...root.getExtras(), sourceFingerprint });
  const asset = root.getAsset();
  const extras =
    asset.extras && typeof asset.extras === 'object' && !Array.isArray(asset.extras)
      ? asset.extras
      : {};
  asset.extras = { ...extras, sourceFingerprint };
  await io.write(glbPath, document);
}

async function inspectGlb(glbPath) {
  const io = await createNodeIo();
  const bytes = readFileSync(glbPath);
  const document = await io.readBinary(bytes);
  const root = document.getRoot();
  const scene = root.listScenes()[0];
  assertCondition(scene, `${glbPath} has no scene`);
  let triangles = 0;
  let primitives = 0;
  const materials = new Set();
  let everyPrimitiveColored = true;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitives++;
      const position = primitive.getAttribute('POSITION');
      triangles += (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
      if (!primitive.getAttribute('COLOR_0')) everyPrimitiveColored = false;
      materials.add(primitive.getMaterial()?.getName() ?? null);
    }
  }
  const sceneRoots = scene.listChildren();
  const flame = root.listNodes().find((node) => node.getName() === 'Socket_Flame');
  return {
    path: path.relative(ROOT, glbPath).split(path.sep).join('/'),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    triangles,
    primitives,
    materials: [...materials].sort(),
    everyPrimitiveColored,
    textures: root.listTextures().length,
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
    extensions: root
      .listExtensionsUsed()
      .map((extension) => extension.extensionName)
      .sort(),
    rootNames: sceneRoots.map((node) => node.getName()),
    runtime: sceneRoots[0]?.getExtras()?.sculptRuntime ?? null,
    flameY: flame ? flame.getWorldTranslation()[1] : null,
    bounds: getBounds(scene),
    fingerprints: {
      document: root.getExtras()?.sourceFingerprint,
      asset: root.getAsset().extras?.sourceFingerprint,
    },
  };
}

function verifyContract(piece, stats, optimized, sourceFingerprint) {
  const where = `${stats.path}`;
  assertCondition(
    stats.triangles <= piece.maxTriangles,
    `${where}: ${stats.triangles} tris over ${piece.maxTriangles}`,
  );
  if (optimized) {
    assertCondition(
      stats.bytes <= piece.maxBytes,
      `${where}: ${stats.bytes} bytes over ${piece.maxBytes}`,
    );
    assertCondition(stats.extensions.includes('EXT_meshopt_compression'), `${where}: not meshopt`);
  }
  assertCondition(stats.textures === 0, `${where}: carries textures`);
  assertCondition(stats.animations === 0 && stats.skins === 0, `${where}: animated or skinned`);
  assertCondition(stats.everyPrimitiveColored, `${where}: a primitive lacks COLOR_0`);
  for (const name of stats.materials) {
    assertCondition(MUSTER_CAMP_MATERIALS.includes(name), `${where}: unexpected material ${name}`);
  }
  assertCondition(stats.rootNames.length === 1, `${where}: expected one scene root`);
  assertCondition(stats.runtime?.kitKey === piece.key, `${where}: sculptRuntime kitKey mismatch`);
  assertCondition(stats.runtime?.tierClass === piece.tierClass, `${where}: tierClass mismatch`);
  const { min, max } = stats.bounds;
  assertCondition(Math.abs(min[1]) <= 0.01, `${where}: not floor-seated (min y ${min[1]})`);
  assertCondition(Math.abs(min[0] + max[0]) <= 0.02, `${where}: not centred on x`);
  assertCondition(Math.abs(min[2] + max[2]) <= 0.02, `${where}: not centred on z`);
  if (piece.key === 'musterTorch') {
    assertCondition(
      stats.flameY !== null && Math.abs(stats.flameY - MUSTER_TORCH_FLAME_HEIGHT) <= 0.01,
      `${where}: flame socket at ${stats.flameY}, contract ${MUSTER_TORCH_FLAME_HEIGHT}`,
    );
  }
  assertCondition(
    stats.fingerprints.document === sourceFingerprint &&
      stats.fingerprints.asset === sourceFingerprint,
    `${where}: source fingerprint changed or is missing`,
  );
}

function runOptimizer(outputRoot) {
  const args = [BUILD_ASSETS, SPEC];
  if (outputRoot) args.push('--output-root', outputRoot);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0)
    throw new Error(`muster camp optimizer failed: ${result.status ?? 'unknown'}`);
}

const sourceFingerprint = musterCampSourceFingerprint(ROOT);
console.log(`source fingerprint: ${sourceFingerprint}`);
runBlender();
for (const piece of MUSTER_CAMP_PIECES) {
  const raw = path.join(RAW_DIR, `${piece.file}.glb`);
  assertCondition(existsSync(raw), `factory did not write ${raw}`);
  await stampSourceFingerprint(raw, sourceFingerprint);
  verifyContract(piece, await inspectGlb(raw), false, sourceFingerprint);
}
if (!rawOnly) {
  runOptimizer(null);
  runOptimizer(CANDIDATE_ROOT);
  const summary = [];
  for (const piece of MUSTER_CAMP_PIECES) {
    const shipped = path.join(SHIPPING_DIR, `${piece.file}.glb`);
    const candidate = path.join(CANDIDATE_ROOT, 'models/props', `${piece.file}.glb`);
    const stats = await inspectGlb(shipped);
    verifyContract(piece, stats, true, sourceFingerprint);
    assertCondition(
      readFileSync(candidate).equals(readFileSync(shipped)),
      `${piece.file}: deterministic optimized rebuild differs byte for byte`,
    );
    assertCondition(statSync(shipped).size === stats.bytes, `${piece.file}: size drift`);
    summary.push({
      key: piece.key,
      file: `models/props/${piece.file}.glb`,
      bytes: stats.bytes,
      sha256: stats.sha256,
      triangles: stats.triangles,
      primitives: stats.primitives,
      materials: stats.materials,
      bounds: stats.bounds,
    });
  }
  console.log(JSON.stringify(summary, null, 2));
}
