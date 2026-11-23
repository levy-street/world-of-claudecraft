// Deterministic export, optimization, and contract verification of the Fenbridge muster
// standard (Balgath loot: the planted battle standard two muster soldiers rally to).
//
// Usage:
//   node scripts/assets/muster_standard/export_muster_standard.mjs
//   node scripts/assets/muster_standard/export_muster_standard.mjs --raw-only
//   node scripts/assets/muster_standard/export_muster_standard.mjs --blender=<path to blender 5.2.1>
//
// 1. Runs the Blender factory (model.py) in --background: one raw GLB in
//    tmp/asset_src/muster_standard/.
// 2. Stamps the source fingerprint (source_fingerprint.mjs) into the raw GLB.
// 3. Optimizes through scripts/assets/build_assets.mjs with specs/muster_standard.json
//    into public/models/vfx/, then again into a candidate root, and requires the two to
//    match byte for byte.
// 4. Verifies the contract (contract.mjs) on the raw AND shipped files: the one scene
//    root, every named node under its parent, meshes where promised, per-node and total
//    triangle ceilings, COLOR_0 on every primitive, the material buckets only, the glow
//    materials emissive, the anchors, the world bounds, texture-free, unanimated, the
//    byte ceiling and meshopt on the shipped file, and the fingerprint.
// After a run, regenerate the media manifest:
//   node scripts/build_media_manifest.mjs generate
// and re-pin tests/muster_standard_asset.test.ts from the printed summary.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { MUSTER_STANDARD as K } from './contract.mjs';
import { musterStandardSourceFingerprint } from './source_fingerprint.mjs';

const KIT = 'muster_standard';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const FACTORY = path.join(HERE, 'model.py');
const RAW_DIR = path.join(ROOT, `tmp/asset_src/${KIT}`);
const RAW = path.join(RAW_DIR, K.rawName);
const SPEC = path.join(ROOT, `scripts/assets/specs/${KIT}.json`);
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const SHIPPED = path.join(ROOT, 'public', K.file);
const CANDIDATE_ROOT = path.join(ROOT, `tmp/asset_optimized/${KIT}/deterministic`);
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
    version.stdout.includes(`Blender ${K.blenderVersion}`),
    `${KIT} is authored against Blender ${K.blenderVersion}; found: ${version.stdout.split('\n')[0]}`,
  );
  mkdirSync(RAW_DIR, { recursive: true });
  const result = spawnSync(
    BLENDER,
    ['--background', '--factory-startup', '--python', FACTORY, '--', '--out', RAW_DIR],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const report = new RegExp(`${K.reportTag}_BEGIN\\n([\\s\\S]*?)${K.reportTag}_END`).exec(
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

/** Column-major 4x4 times a point. */
function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Triangles, materials, colour coverage and world points of one mesh node. */
function measureMesh(node) {
  const world = node.getWorldMatrix();
  let triangles = 0;
  let colored = true;
  const materials = new Set();
  const points = [];
  const primitives = node.getMesh().listPrimitives();
  for (const primitive of primitives) {
    if (!primitive.getAttribute('COLOR_0')) colored = false;
    materials.add(primitive.getMaterial()?.getName() ?? null);
    const position = primitive.getAttribute('POSITION');
    const element = [0, 0, 0];
    for (let i = 0; i < position.getCount(); i++) {
      points.push(transformPoint(world, position.getElement(i, element)));
    }
    triangles += (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
  }
  return {
    triangles,
    primitives: primitives.length,
    colored,
    materials: [...materials].sort(),
    points,
  };
}

async function inspectGlb(glbPath) {
  const io = await createNodeIo();
  const bytes = readFileSync(glbPath);
  const document = await io.readBinary(bytes);
  const root = document.getRoot();
  const scene = root.listScenes()[0];
  assertCondition(scene, `${glbPath} has no scene`);
  const sceneRoots = scene.listChildren();
  const nodes = {};
  const named = {};
  for (const node of root.listNodes()) {
    const name = node.getName();
    named[name] = (named[name] ?? 0) + 1;
    const parent = node.getParentNode();
    nodes[name] = {
      parent: parent ? parent.getName() : null,
      translation: node.getTranslation(),
      rotation: node.getRotation(),
      scale: node.getScale(),
      mesh: node.getMesh() ? measureMesh(node) : null,
    };
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const node of Object.values(nodes)) {
    for (const p of node.mesh?.points ?? []) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
  }
  return {
    path: path.relative(ROOT, glbPath).split(path.sep).join('/'),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    textures: root.listTextures().length,
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
    extensions: root
      .listExtensionsUsed()
      .map((extension) => extension.extensionName)
      .sort(),
    rootNames: sceneRoots.map((node) => node.getName()),
    runtime: sceneRoots[0]?.getExtras()?.sculptRuntime ?? null,
    materials: root
      .listMaterials()
      .map((m) => ({ name: m.getName(), emissive: m.getEmissiveFactor() })),
    named,
    nodes,
    bounds: { min, max },
    fingerprints: {
      document: root.getExtras()?.sourceFingerprint,
      asset: root.getAsset().extras?.sourceFingerprint,
    },
  };
}

function verifyContract(stats, optimized, sourceFingerprint) {
  const where = stats.path;
  if (optimized) {
    assertCondition(stats.bytes <= K.maxBytes, `${where}: ${stats.bytes} bytes over ${K.maxBytes}`);
    assertCondition(stats.extensions.includes('EXT_meshopt_compression'), `${where}: not meshopt`);
  }
  assertCondition(stats.textures === 0, `${where}: carries textures`);
  assertCondition(stats.animations === 0 && stats.skins === 0, `${where}: animated or skinned`);
  assertCondition(
    stats.rootNames.length === 1 && stats.rootNames[0] === K.root,
    `${where}: expected the one scene root ${K.root}, got ${stats.rootNames}`,
  );
  assertCondition(stats.runtime?.assetId === K.assetId, `${where}: runtime extras`);
  let total = 0;
  for (const contract of K.nodes) {
    const at = `${where} ${contract.name}`;
    assertCondition(stats.named[contract.name] === 1, `${at}: not exactly one node of that name`);
    const node = stats.nodes[contract.name];
    assertCondition(node.parent === contract.parent, `${at}: parent ${node.parent}`);
    assertCondition(Boolean(node.mesh) === contract.mesh, `${at}: mesh presence`);
    if (!node.mesh) continue;
    total += node.mesh.triangles;
    assertCondition(
      node.mesh.triangles <= contract.maxTriangles,
      `${at}: ${node.mesh.triangles} tris over ${contract.maxTriangles}`,
    );
    assertCondition(node.mesh.colored, `${at}: a primitive lacks COLOR_0`);
    for (const name of node.mesh.materials) {
      assertCondition(K.materials.includes(name), `${at}: unexpected material ${name}`);
    }
  }
  const meshNodes = Object.entries(stats.nodes).filter(([, n]) => n.mesh);
  assertCondition(
    meshNodes.length === K.nodes.filter((n) => n.mesh).length,
    `${where}: unexpected extra mesh nodes ${meshNodes.map(([name]) => name)}`,
  );
  assertCondition(total <= K.maxTriangles, `${where}: ${total} tris over ${K.maxTriangles}`);
  for (const name of K.glowMaterials) {
    const material = stats.materials.find((m) => m.name === name);
    assertCondition(material, `${where}: glow material ${name} missing`);
    assertCondition(Math.max(...material.emissive) > 0, `${where}: ${name} is not emissive`);
  }
  for (const [name, at] of Object.entries(K.anchors)) {
    const node = stats.nodes[name];
    assertCondition(
      node.mesh === null &&
        at.every((v, k) => Math.abs(node.translation[k] - v) <= 1e-4) &&
        node.rotation.every((v, k) => Math.abs(v - [0, 0, 0, 1][k]) <= 1e-6) &&
        node.scale.every((v) => Math.abs(v - 1) <= 1e-6),
      `${where} ${name}: anchor moved to ${node.translation}`,
    );
  }
  for (let k = 0; k < 3; k++) {
    assertCondition(
      Math.abs(stats.bounds.min[k] - K.bounds.min[k]) <= K.bounds.tolerance &&
        Math.abs(stats.bounds.max[k] - K.bounds.max[k]) <= K.bounds.tolerance,
      `${where}: bounds ${stats.bounds.min} .. ${stats.bounds.max} off the contract`,
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
    throw new Error(`${KIT} optimizer failed: ${result.status ?? 'unknown'}`);
}

const sourceFingerprint = musterStandardSourceFingerprint(ROOT);
console.log(`source fingerprint: ${sourceFingerprint}`);
runBlender();
assertCondition(existsSync(RAW), `factory did not write ${RAW}`);
await stampSourceFingerprint(RAW, sourceFingerprint);
verifyContract(await inspectGlb(RAW), false, sourceFingerprint);
if (!rawOnly) {
  runOptimizer(null);
  runOptimizer(CANDIDATE_ROOT);
  const candidate = path.join(CANDIDATE_ROOT, K.file);
  const stats = await inspectGlb(SHIPPED);
  verifyContract(stats, true, sourceFingerprint);
  assertCondition(
    readFileSync(candidate).equals(readFileSync(SHIPPED)),
    `${KIT}: deterministic optimized rebuild differs byte for byte`,
  );
  const summary = {
    file: K.file,
    bytes: stats.bytes,
    sha256: stats.sha256,
    sourceFingerprint,
    bounds: {
      min: stats.bounds.min.map((v) => Number(v.toFixed(4))),
      max: stats.bounds.max.map((v) => Number(v.toFixed(4))),
    },
    materials: stats.materials.map((m) => m.name),
    nodes: Object.fromEntries(
      K.nodes
        .filter((n) => n.mesh)
        .map(({ name }) => {
          const mesh = stats.nodes[name].mesh;
          return [
            name,
            { triangles: mesh.triangles, primitives: mesh.primitives, materials: mesh.materials },
          ];
        }),
    ),
  };
  console.log(JSON.stringify(summary, null, 2));
}
