// Deterministic export, optimization, and contract verification of Balgath's Boulder
// Toss VFX kit (the boulder he hurls, its shatter chunks, the splinter vortex).
//
// Usage:
//   node scripts/assets/balgath_boulder/export_balgath_boulder.mjs
//   node scripts/assets/balgath_boulder/export_balgath_boulder.mjs --raw-only
//   node scripts/assets/balgath_boulder/export_balgath_boulder.mjs --blender=<path to blender 5.2.1>
//
// 1. Runs the Blender factory (model.py) in --background: one raw GLB in
//    tmp/asset_src/balgath_boulder/.
// 2. Stamps the source fingerprint (source_fingerprint.mjs) into the raw GLB.
// 3. Optimizes through scripts/assets/build_assets.mjs with specs/balgath_boulder.json
//    into public/models/vfx/, then again into a candidate root, and requires the two to
//    match byte for byte.
// 4. Verifies the contract (contract.mjs) on the raw AND shipped files: every named node
//    present with a mesh, per-node triangle ceilings, centred on its own surface
//    centroid, radius and length bands, COLOR_0 on every primitive, the three material
//    buckets only, texture-free, the byte ceiling and meshopt on the shipped file, and
//    the fingerprint.
// After a run, regenerate the media manifest:
//   node scripts/build_media_manifest.mjs generate
// and re-pin tests/balgath_boulder_asset.test.ts from the printed summary.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import {
  BALGATH_BOULDER_BLENDER_VERSION,
  BALGATH_BOULDER_CENTRE_TOLERANCE,
  BALGATH_BOULDER_FILE,
  BALGATH_BOULDER_MATERIALS,
  BALGATH_BOULDER_MAX_BYTES,
  BALGATH_BOULDER_NODES,
  BALGATH_BOULDER_ROOT,
} from './contract.mjs';
import { balgathBoulderSourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const FACTORY = path.join(HERE, 'model.py');
const RAW_DIR = path.join(ROOT, 'tmp/asset_src/balgath_boulder');
const RAW = path.join(RAW_DIR, 'balgath_boulder.glb');
const SPEC = path.join(ROOT, 'scripts/assets/specs/balgath_boulder.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const SHIPPED = path.join(ROOT, 'public', BALGATH_BOULDER_FILE);
const CANDIDATE_ROOT = path.join(ROOT, 'tmp/asset_optimized/balgath_boulder/deterministic');
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
    version.stdout.includes(`Blender ${BALGATH_BOULDER_BLENDER_VERSION}`),
    `the boulder kit is authored against Blender ${BALGATH_BOULDER_BLENDER_VERSION}; found: ${version.stdout.split('\n')[0]}`,
  );
  mkdirSync(RAW_DIR, { recursive: true });
  const result = spawnSync(
    BLENDER,
    ['--background', '--factory-startup', '--python', FACTORY, '--', '--out', RAW_DIR],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const report = /BOULDER_KIT_REPORT_BEGIN\n([\s\S]*?)BOULDER_KIT_REPORT_END/.exec(
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

/** Triangles, materials, colour coverage and shape of one mesh node, in world space. */
function measureNode(node) {
  const mesh = node.getMesh();
  const world = node.getWorldMatrix();
  let triangles = 0;
  let primitives = 0;
  let colored = true;
  const materials = new Set();
  let area = 0;
  const centroid = [0, 0, 0];
  const points = [];
  for (const primitive of mesh.listPrimitives()) {
    primitives++;
    if (!primitive.getAttribute('COLOR_0')) colored = false;
    materials.add(primitive.getMaterial()?.getName() ?? null);
    const position = primitive.getAttribute('POSITION');
    const local = [];
    const element = [0, 0, 0];
    for (let i = 0; i < position.getCount(); i++) {
      local.push(transformPoint(world, position.getElement(i, element)));
    }
    points.push(...local);
    const indices = primitive.getIndices();
    const count = indices ? indices.getCount() : position.getCount();
    triangles += count / 3;
    for (let t = 0; t < count; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => local[indices ? indices.getScalar(t + k) : t + k]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const w = Math.hypot(...cross) / 2;
      area += w;
      for (let k = 0; k < 3; k++) centroid[k] += ((a[k] + b[k] + c[k]) / 3) * w;
    }
  }
  for (let k = 0; k < 3; k++) centroid[k] /= area;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let radius = 0;
  for (const p of points) {
    radius = Math.max(radius, Math.hypot(...p));
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  const length = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  return {
    triangles,
    primitives,
    colored,
    materials: [...materials].sort(),
    centroid,
    radius,
    length,
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
  for (const node of root.listNodes()) {
    if (node.getMesh()) nodes[node.getName()] = measureNode(node);
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
    nodes,
    fingerprints: {
      document: root.getExtras()?.sourceFingerprint,
      asset: root.getAsset().extras?.sourceFingerprint,
    },
  };
}

function verifyContract(stats, optimized, sourceFingerprint) {
  const where = stats.path;
  if (optimized) {
    assertCondition(
      stats.bytes <= BALGATH_BOULDER_MAX_BYTES,
      `${where}: ${stats.bytes} bytes over ${BALGATH_BOULDER_MAX_BYTES}`,
    );
    assertCondition(stats.extensions.includes('EXT_meshopt_compression'), `${where}: not meshopt`);
  }
  assertCondition(stats.textures === 0, `${where}: carries textures`);
  assertCondition(stats.animations === 0 && stats.skins === 0, `${where}: animated or skinned`);
  assertCondition(
    stats.rootNames.length === 1 && stats.rootNames[0] === BALGATH_BOULDER_ROOT,
    `${where}: expected the one scene root ${BALGATH_BOULDER_ROOT}, got ${stats.rootNames}`,
  );
  assertCondition(
    stats.runtime?.assetId === 'balgath-boulder-toss-kit',
    `${where}: runtime extras`,
  );
  const expected = BALGATH_BOULDER_NODES.map((node) => node.name).sort();
  assertCondition(
    JSON.stringify(Object.keys(stats.nodes).sort()) === JSON.stringify(expected),
    `${where}: mesh nodes ${Object.keys(stats.nodes).sort()} are not the contract ${expected}`,
  );
  for (const contract of BALGATH_BOULDER_NODES) {
    const node = stats.nodes[contract.name];
    const at = `${where} ${contract.name}`;
    assertCondition(
      node.triangles <= contract.maxTriangles,
      `${at}: ${node.triangles} tris over ${contract.maxTriangles}`,
    );
    assertCondition(node.colored, `${at}: a primitive lacks COLOR_0`);
    for (const name of node.materials) {
      assertCondition(
        BALGATH_BOULDER_MATERIALS.includes(name),
        `${at}: unexpected material ${name}`,
      );
    }
    const size = contract.role === 'shard' ? node.length : node.radius;
    const off = Math.hypot(...node.centroid);
    assertCondition(
      off <= BALGATH_BOULDER_CENTRE_TOLERANCE * size,
      `${at}: surface centroid ${off.toFixed(4)} off its origin`,
    );
    if (contract.minRadius !== undefined) {
      assertCondition(
        node.radius >= contract.minRadius && node.radius <= contract.maxRadius,
        `${at}: radius ${node.radius} outside ${contract.minRadius}..${contract.maxRadius}`,
      );
    }
    if (contract.minLength !== undefined) {
      assertCondition(
        node.length >= contract.minLength && node.length <= contract.maxLength,
        `${at}: length ${node.length} outside ${contract.minLength}..${contract.maxLength}`,
      );
    }
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
    throw new Error(`boulder kit optimizer failed: ${result.status ?? 'unknown'}`);
}

const sourceFingerprint = balgathBoulderSourceFingerprint(ROOT);
console.log(`source fingerprint: ${sourceFingerprint}`);
runBlender();
assertCondition(existsSync(RAW), `factory did not write ${RAW}`);
await stampSourceFingerprint(RAW, sourceFingerprint);
verifyContract(await inspectGlb(RAW), false, sourceFingerprint);
if (!rawOnly) {
  runOptimizer(null);
  runOptimizer(CANDIDATE_ROOT);
  const candidate = path.join(CANDIDATE_ROOT, BALGATH_BOULDER_FILE);
  const stats = await inspectGlb(SHIPPED);
  verifyContract(stats, true, sourceFingerprint);
  assertCondition(
    readFileSync(candidate).equals(readFileSync(SHIPPED)),
    'balgath_boulder: deterministic optimized rebuild differs byte for byte',
  );
  const summary = {
    file: BALGATH_BOULDER_FILE,
    bytes: stats.bytes,
    sha256: stats.sha256,
    sourceFingerprint,
    nodes: Object.fromEntries(
      BALGATH_BOULDER_NODES.map(({ name }) => {
        const node = stats.nodes[name];
        return [
          name,
          {
            triangles: node.triangles,
            primitives: node.primitives,
            materials: node.materials,
            radius: Number(node.radius.toFixed(4)),
            length: Number(node.length.toFixed(4)),
          },
        ];
      }),
    ),
  };
  console.log(JSON.stringify(summary, null, 2));
}
