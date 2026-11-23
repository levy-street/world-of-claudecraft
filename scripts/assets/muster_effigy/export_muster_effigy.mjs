// Deterministic export, optimization, and contract verification of the muster
// training effigy (the half-size Balgath the camp drills the pike trick on) and the
// soldiers' stake mallet.
//
// Usage:
//   node scripts/assets/muster_effigy/export_muster_effigy.mjs
//   node scripts/assets/muster_effigy/export_muster_effigy.mjs --raw-only
//   node scripts/assets/muster_effigy/export_muster_effigy.mjs --blender=<path to blender 5.2.1>
//
// 1. Runs the Blender factory (model.py) in --background: muster_effigy.glb and
//    muster_mallet.glb in tmp/asset_src/muster_effigy/.
// 2. Stamps the source fingerprint (source_fingerprint.mjs) into both raw GLBs.
// 3. Optimizes through scripts/assets/build_assets.mjs with specs/muster_effigy.json
//    into public/models/, then again into a candidate root, and requires the two to
//    match byte for byte.
// 4. Verifies the contract (contract.mjs) on raw AND shipped files: triangle and byte
//    ceilings, texture-free, COLOR_0 on every primitive, the named material buckets
//    only, meshopt on the shipped files, the fingerprint, and per piece: the effigy's
//    height, floor seat, centring, Plank_NN groups, lantern nodes and flame height;
//    the mallet's single grip node matching axe_2handed.glb.
// After a run, regenerate the media manifest:
//   node scripts/build_media_manifest.mjs generate
// and re-pin tests/muster_effigy_asset.test.ts from the printed summary.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import {
  MUSTER_EFFIGY_BLENDER_VERSION,
  MUSTER_EFFIGY_HEIGHT,
  MUSTER_EFFIGY_LANTERN_HEIGHT,
  MUSTER_EFFIGY_MATERIALS,
  MUSTER_EFFIGY_PIECES,
  MUSTER_EFFIGY_PLANKS,
  MUSTER_MALLET_GRIP,
} from './contract.mjs';
import { musterEffigySourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const FACTORY = path.join(HERE, 'model.py');
const RAW_DIR = path.join(ROOT, 'tmp/asset_src/muster_effigy');
const SPEC = path.join(ROOT, 'scripts/assets/specs/muster_effigy.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CANDIDATE_ROOT = path.join(ROOT, 'tmp/asset_optimized/muster_effigy/deterministic');
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
    version.stdout.includes(`Blender ${MUSTER_EFFIGY_BLENDER_VERSION}`),
    `muster effigy is authored against Blender ${MUSTER_EFFIGY_BLENDER_VERSION}; found: ${version.stdout.split('\n')[0]}`,
  );
  mkdirSync(RAW_DIR, { recursive: true });
  const result = spawnSync(
    BLENDER,
    ['--background', '--factory-startup', '--python', FACTORY, '--', '--out', RAW_DIR],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const report = /EFFIGY_KIT_REPORT_BEGIN\n([\s\S]*?)EFFIGY_KIT_REPORT_END/.exec(
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
  const nodes = root.listNodes();
  const byName = (name) => nodes.find((node) => node.getName() === name) ?? null;
  const flame = byName('LanternFlame');
  const rootNode = sceneRoots[0] ?? null;
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
    rootExtras: rootNode?.getExtras() ?? {},
    rootTranslation: rootNode?.getTranslation() ?? null,
    rootScale: rootNode?.getScale() ?? null,
    rootHasMesh: Boolean(rootNode?.getMesh()),
    planks: nodes
      .map((node) => node.getName())
      .filter((name) => /^Plank_\d\d$/.test(name))
      .sort(),
    lantern: Boolean(byName('Lantern')?.getMesh()),
    glass: Boolean(byName('LanternGlass')?.getMesh()),
    flame: flame ? flame.getWorldTranslation() : null,
    bounds: getBounds(scene),
    fingerprints: {
      document: root.getExtras()?.sourceFingerprint,
      asset: root.getAsset().extras?.sourceFingerprint,
    },
  };
}

function verifyEffigy(stats, where) {
  assertCondition(
    stats.rootNames.length === 1 && stats.rootNames[0] === 'MusterEffigy',
    `${where}: expected one MusterEffigy root`,
  );
  const { min, max } = stats.bounds;
  const height = max[1] - min[1];
  assertCondition(Math.abs(min[1]) <= 0.01, `${where}: not floor-seated (min y ${min[1]})`);
  assertCondition(
    height >= MUSTER_EFFIGY_HEIGHT.min && height <= MUSTER_EFFIGY_HEIGHT.max,
    `${where}: height ${height} outside ${MUSTER_EFFIGY_HEIGHT.min}..${MUSTER_EFFIGY_HEIGHT.max}`,
  );
  assertCondition(Math.abs(min[0] + max[0]) <= 0.02, `${where}: not centred on x`);
  assertCondition(Math.abs(min[2] + max[2]) <= 0.02, `${where}: not centred on z`);
  assertCondition(
    stats.planks.length >= MUSTER_EFFIGY_PLANKS.min &&
      stats.planks.length <= MUSTER_EFFIGY_PLANKS.max,
    `${where}: ${stats.planks.length} Plank_NN groups`,
  );
  assertCondition(stats.lantern && stats.glass, `${where}: Lantern / LanternGlass mesh missing`);
  assertCondition(
    stats.flame !== null && Math.abs(stats.flame[1] - MUSTER_EFFIGY_LANTERN_HEIGHT) <= 0.01,
    `${where}: LanternFlame at ${stats.flame}, contract ${MUSTER_EFFIGY_LANTERN_HEIGHT}`,
  );
  const extras = stats.rootExtras;
  assertCondition(
    Math.abs(extras.lanternHeight - stats.flame[1]) <= 0.001 &&
      Math.abs(extras.height - height) <= 0.01 &&
      extras.plankCount === stats.planks.length,
    `${where}: root extras disagree with the geometry`,
  );
  assertCondition(extras.sculptRuntime?.kitKey === 'musterEffigy', `${where}: kitKey mismatch`);
}

function verifyMallet(stats, optimized, where) {
  assertCondition(
    stats.rootNames.length === 1 && stats.rootNames[0] === 'MusterMallet' && stats.rootHasMesh,
    `${where}: expected one MusterMallet mesh node`,
  );
  // the axe's frame: handle along y, butt and crown on the axe's, centred on the handle
  const { min, max } = stats.bounds;
  assertCondition(
    Math.abs(min[1] - MUSTER_MALLET_GRIP.buttY) <= 0.005 &&
      Math.abs(max[1] - MUSTER_MALLET_GRIP.crownY) <= 0.005,
    `${where}: handle runs ${min[1]}..${max[1]}, the axe's ${MUSTER_MALLET_GRIP.buttY}..${MUSTER_MALLET_GRIP.crownY}`,
  );
  assertCondition(
    Math.abs(min[0] + max[0]) <= 0.005 && Math.abs(min[2] + max[2]) <= 0.005,
    `${where}: not centred on the handle axis`,
  );
  assertCondition(
    max[1] - min[1] > Math.max(max[0] - min[0], max[2] - min[2]),
    `${where}: the handle is not the long axis`,
  );
  if (optimized) {
    // quantization folds the bounds into the node: it must match the axe's node
    const t = stats.rootTranslation;
    const s = stats.rootScale;
    assertCondition(
      Math.abs(t[0]) < 0.002 &&
        Math.abs(t[1] - MUSTER_MALLET_GRIP.translationY) < 0.002 &&
        Math.abs(t[2]) < 0.002,
      `${where}: grip node translation ${t}`,
    );
    assertCondition(
      s.every((axis) => Math.abs(axis - MUSTER_MALLET_GRIP.scale) < 0.002),
      `${where}: grip node scale ${s}`,
    );
  }
  assertCondition(
    stats.rootExtras.sculptRuntime?.grip?.accessory === '2H_Axe',
    `${where}: grip extras missing`,
  );
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
    assertCondition(
      MUSTER_EFFIGY_MATERIALS.includes(name),
      `${where}: unexpected material ${name}`,
    );
  }
  if (piece.key === 'musterEffigy') verifyEffigy(stats, where);
  else verifyMallet(stats, optimized, where);
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
    throw new Error(`muster effigy optimizer failed: ${result.status ?? 'unknown'}`);
}

const sourceFingerprint = musterEffigySourceFingerprint(ROOT);
console.log(`source fingerprint: ${sourceFingerprint}`);
runBlender();
for (const piece of MUSTER_EFFIGY_PIECES) {
  const raw = path.join(RAW_DIR, `${piece.file}.glb`);
  assertCondition(existsSync(raw), `factory did not write ${raw}`);
  await stampSourceFingerprint(raw, sourceFingerprint);
  verifyContract(piece, await inspectGlb(raw), false, sourceFingerprint);
}
if (!rawOnly) {
  runOptimizer(null);
  runOptimizer(CANDIDATE_ROOT);
  const summary = [];
  for (const piece of MUSTER_EFFIGY_PIECES) {
    const rel = `${piece.dir}/${piece.file}.glb`;
    const shipped = path.join(PUBLIC_DIR, rel);
    const candidate = path.join(CANDIDATE_ROOT, rel);
    const stats = await inspectGlb(shipped);
    verifyContract(piece, stats, true, sourceFingerprint);
    assertCondition(
      readFileSync(candidate).equals(readFileSync(shipped)),
      `${piece.file}: deterministic optimized rebuild differs byte for byte`,
    );
    assertCondition(statSync(shipped).size === stats.bytes, `${piece.file}: size drift`);
    summary.push({
      key: piece.key,
      file: rel,
      bytes: stats.bytes,
      sha256: stats.sha256,
      triangles: stats.triangles,
      primitives: stats.primitives,
      materials: stats.materials,
      planks: stats.planks.length,
      flame: stats.flame,
      rootExtras: piece.key === 'musterEffigy' ? stats.rootExtras : undefined,
      bounds: stats.bounds,
    });
  }
  console.log(JSON.stringify(summary, null, 2));
}
