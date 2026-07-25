// Deterministic staged authoring, raw GLB export, and procedural preview capture.
//
// Usage:
//   node scripts/assets/eastbrook_grand_armoury/export_eastbrook_grand_armoury.mjs \
//     --stage blockout --raw-only
//   node scripts/assets/eastbrook_grand_armoury/export_eastbrook_grand_armoury.mjs \
//     --stage blockout --preview-only
//   node scripts/assets/eastbrook_grand_armoury/export_eastbrook_grand_armoury.mjs \
//     --stage optimization
//   node scripts/assets/eastbrook_grand_armoury/export_eastbrook_grand_armoury.mjs \
//     --stage final --verify-staged --no-preview
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as esbuild from 'esbuild';
import { MeshoptDecoder } from 'meshoptimizer';
import puppeteer from 'puppeteer-core';
import { closePreview, renderPreviews } from '../../asset_pipeline/lib/preview.mjs';
import { BROWSER_PATH } from '../../browser_path.mjs';
import { eastbrookGrandArmourySourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const SPEC = path.join(ROOT, 'scripts/assets/specs/eastbrook_grand_armoury.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const OPTIMIZER_SPEC = JSON.parse(readFileSync(SPEC, 'utf8'));
const OPTIMIZED_RELATIVE_PATH = OPTIMIZER_SPEC.items[0]?.out;
if (!OPTIMIZED_RELATIVE_PATH) throw new Error('armoury optimizer spec has no output path');
const TEMP_OPTIMIZED_ROOT = path.join(ROOT, 'tmp/asset_optimized/eastbrook_grand_armoury');
const ARMOURY_SHIPPING_BYTE_CEILING = 160 * 1024;

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const stage = optionValue('--stage', 'blockout');
const rawOnly = process.argv.includes('--raw-only');
const previewOnly = process.argv.includes('--preview-only');
const noPreview = process.argv.includes('--no-preview');
const verifyStaged = process.argv.includes('--verify-staged');
if (verifyStaged && stage !== 'final') {
  throw new Error('--verify-staged requires --stage final');
}
const rawOut = path.join(
  ROOT,
  `tmp/asset_src/eastbrook_grand_armoury/eastbrook_grand_armoury-${stage}.glb`,
);
const previewDir = path.join(ROOT, `tmp/eastbrook_grand_armoury_preview/${stage}/procedural`);
const tier1Dir = path.join(ROOT, `tmp/eastbrook_grand_armoury_preview/${stage}/tier1`);
const paletteAuditStages = new Set([
  'material',
  'surface',
  'lighting',
  'interaction',
  'optimization',
  'final',
]);
const lightingEvidenceStages = new Set(['lighting', 'interaction', 'optimization', 'final']);
const interactionEvidenceStages = new Set(['interaction', 'optimization', 'final']);

const SOCKET_CONTRACT = [
  { name: 'Socket_FrontEntry', position: [0, 2.25, 3.18] },
  { name: 'Socket_RearService', position: [0, 1.35, -4.5] },
  { name: 'Socket_CrestMount', position: [0, 6.35, 4.45] },
];

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function assertApproxArray(actual, expected, label, tolerance = 1e-3) {
  assertCondition(actual.length === expected.length, `${label} length changed`);
  for (let index = 0; index < expected.length; index++) {
    assertCondition(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `${label}[${index}] expected ${expected[index]}, got ${actual[index]}`,
    );
  }
}

function sourceFingerprintExtras(root) {
  return {
    document: root.getExtras()?.sourceFingerprint,
    asset: root.getAsset().extras?.sourceFingerprint,
  };
}

async function createNodeIo() {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

async function stampRawSourceFingerprint(glbPath, sourceFingerprint) {
  const io = await createNodeIo();
  const document = await io.read(glbPath);
  const root = document.getRoot();
  root.setExtras({ ...root.getExtras(), sourceFingerprint });
  const asset = root.getAsset();
  const assetExtras =
    asset.extras && typeof asset.extras === 'object' && !Array.isArray(asset.extras)
      ? asset.extras
      : {};
  asset.extras = { ...assetExtras, sourceFingerprint };
  await io.write(glbPath, document);

  const reopened = await io.read(glbPath);
  const reopenedFingerprints = sourceFingerprintExtras(reopened.getRoot());
  assertCondition(
    reopenedFingerprints.document === sourceFingerprint,
    'raw GLB document-root source fingerprint did not survive reopening',
  );
  assertCondition(
    reopenedFingerprints.asset === sourceFingerprint,
    'raw GLB asset source fingerprint did not survive reopening',
  );
}

async function inspectGlb(glbPath) {
  const io = await createNodeIo();
  const document = await io.read(glbPath);
  const root = document.getRoot();
  const scene = root.listScenes()[0];
  if (!scene) throw new Error(`${glbPath} has no scene`);
  const bounds = getBounds(scene);
  const meshes = root.listMeshes().map((mesh) => {
    const primitives = mesh.listPrimitives().map((primitive) => {
      const position = primitive.getAttribute('POSITION');
      if (!position) throw new Error(`${mesh.getName()} primitive has no POSITION`);
      return {
        mode: primitive.getMode(),
        material: primitive.getMaterial()?.getName() ?? null,
        attributes: primitive.listSemantics().sort(),
        triangles: (primitive.getIndices()?.getCount() ?? position.getCount()) / 3,
      };
    });
    return { name: mesh.getName(), primitives };
  });
  const materials = root.listMaterials().map((material) => ({
    name: material.getName(),
    metalness: material.getMetallicFactor(),
    roughness: material.getRoughnessFactor(),
    emissive: material.getEmissiveFactor(),
  }));
  const sceneChildren = scene.listChildren();
  const modelRoot = sceneChildren.find((node) => node.getName() === 'EastbrookGrandArmoury');
  const sockets = SOCKET_CONTRACT.map((socket) => {
    const node = root.listNodes().find((candidate) => candidate.getName() === socket.name);
    return node
      ? {
          name: node.getName(),
          translation: node.getTranslation(),
          rotation: node.getRotation(),
          scale: node.getScale(),
          children: node.listChildren().length,
          mesh: node.getMesh()?.getName() ?? null,
          extras: node.getExtras(),
        }
      : null;
  });
  const extensionNames = (extensions) =>
    extensions.map((extension) => extension.extensionName).sort();
  return {
    path: path.relative(ROOT, glbPath),
    bytes: statSync(glbPath).size,
    sha256: createHash('sha256').update(readFileSync(glbPath)).digest('hex'),
    usedExtensions: extensionNames(root.listExtensionsUsed()),
    requiredExtensions: extensionNames(root.listExtensionsRequired()),
    scenes: root.listScenes().length,
    sceneChildren: sceneChildren.map((node) => node.getName()),
    nodes: root.listNodes().length,
    meshes,
    primitives: meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0),
    triangles: meshes.reduce(
      (sum, mesh) =>
        sum + mesh.primitives.reduce((meshSum, primitive) => meshSum + primitive.triangles, 0),
      0,
    ),
    materials,
    textures: root.listTextures().length,
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
    cameras: root.listCameras().length,
    bounds,
    modelRoot: modelRoot
      ? {
          translation: modelRoot.getTranslation(),
          rotation: modelRoot.getRotation(),
          scale: modelRoot.getScale(),
          extras: modelRoot.getExtras(),
        }
      : null,
    sockets,
    fingerprints: sourceFingerprintExtras(root),
  };
}

function verifyGlbContract(stats, { optimized, sourceFingerprint, expectedStage }) {
  const expectedUsed = optimized
    ? ['EXT_meshopt_compression', 'KHR_materials_emissive_strength', 'KHR_mesh_quantization']
    : ['KHR_materials_emissive_strength'];
  const expectedRequired = optimized ? ['EXT_meshopt_compression', 'KHR_mesh_quantization'] : [];
  assertCondition(
    JSON.stringify(stats.usedExtensions) === JSON.stringify(expectedUsed),
    `${stats.path} used extensions changed: ${stats.usedExtensions.join(', ')}`,
  );
  assertCondition(
    JSON.stringify(stats.requiredExtensions) === JSON.stringify(expectedRequired),
    `${stats.path} required extensions changed: ${stats.requiredExtensions.join(', ')}`,
  );
  assertCondition(
    !stats.usedExtensions.includes('KHR_draco_mesh_compression'),
    'Draco is forbidden',
  );
  assertCondition(
    !stats.usedExtensions.includes('KHR_lights_punctual'),
    'model lights are forbidden',
  );
  assertCondition(stats.scenes === 1, `${stats.path} must contain one scene`);
  assertCondition(
    JSON.stringify(stats.sceneChildren) === JSON.stringify(['EastbrookGrandArmoury']),
    `${stats.path} scene root changed`,
  );
  assertCondition(stats.meshes.length === 6, `${stats.path} must contain six meshes`);
  assertCondition(stats.primitives === 6, `${stats.path} must contain six primitives`);
  assertCondition(
    stats.meshes.every(
      (mesh) =>
        mesh.primitives.length === 1 &&
        mesh.primitives[0].mode === Primitive.Mode.TRIANGLES &&
        JSON.stringify(mesh.primitives[0].attributes) ===
          JSON.stringify(['COLOR_0', 'NORMAL', 'POSITION']),
    ),
    `${stats.path} mesh/primitive topology contract changed`,
  );
  assertCondition(stats.triangles === 8226, `${stats.path} triangle count changed`);
  assertCondition(stats.materials.length === 6, `${stats.path} material count changed`);
  if (optimized) {
    assertCondition(
      stats.bytes <= ARMOURY_SHIPPING_BYTE_CEILING,
      `${stats.path} exceeds the ${ARMOURY_SHIPPING_BYTE_CEILING}-byte shipping ceiling`,
    );
  }
  assertCondition(
    stats.materials.filter((material) => material.emissive.some((value) => value > 0)).length === 2,
    `${stats.path} must contain exactly two emissive materials`,
  );
  assertCondition(
    stats.textures === 0 && stats.animations === 0 && stats.skins === 0 && stats.cameras === 0,
    `${stats.path} gained textures, animation, skinning, or cameras`,
  );
  assertApproxArray(stats.bounds.min, [-6.5, 0, -4.5], `${stats.path} bounds min`);
  assertApproxArray(stats.bounds.max, [6.5, 16.35, 4.5], `${stats.path} bounds max`);
  assertCondition(stats.modelRoot, `${stats.path} has no EastbrookGrandArmoury root node`);
  assertApproxArray(stats.modelRoot.translation, [0, 0, 0], `${stats.path} root translation`);
  assertApproxArray(stats.modelRoot.rotation, [0, 0, 0, 1], `${stats.path} root rotation`);
  assertApproxArray(stats.modelRoot.scale, [1, 1, 1], `${stats.path} root scale`);
  const runtime = stats.modelRoot.extras.sculptRuntime;
  assertCondition(runtime?.stage === expectedStage, `${stats.path} stage metadata changed`);
  assertCondition(
    runtime?.interaction?.mode === 'static-closed-landmark',
    'interaction mode changed',
  );
  assertCondition(runtime?.interaction?.closedBuilding === true, 'closed-building flag changed');
  assertCondition(runtime?.destruction?.breakable === false, 'non-breakable contract changed');
  assertCondition(runtime?.collider?.shippingCollisionMesh === false, 'collision mesh was added');
  assertApproxArray(runtime.collider.center, [0, 8.175, 0], `${stats.path} collider center`);
  assertApproxArray(runtime.collider.size, [13, 16.35, 9], `${stats.path} collider size`);
  assertApproxArray(
    runtime.collider.halfExtents,
    [6.5, 8.175, 4.5],
    `${stats.path} collider half extents`,
  );
  for (const [index, contract] of SOCKET_CONTRACT.entries()) {
    const socket = stats.sockets[index];
    assertCondition(socket, `${stats.path} lost ${contract.name}`);
    assertCondition(socket.children === 0 && socket.mesh === null, `${contract.name} is not empty`);
    assertApproxArray(socket.translation, contract.position, `${contract.name} translation`);
    assertApproxArray(socket.rotation, [0, 0, 0, 1], `${contract.name} rotation`);
    assertApproxArray(socket.scale, [1, 1, 1], `${contract.name} scale`);
    assertCondition(
      socket.extras?.sculptSocket?.interactive === false,
      `${contract.name} became interactive`,
    );
  }
  assertCondition(
    stats.fingerprints.document === sourceFingerprint &&
      stats.fingerprints.asset === sourceFingerprint,
    `${stats.path} source fingerprint changed or is missing`,
  );
}

function optimizedPath(outputRoot) {
  return path.join(outputRoot, OPTIMIZED_RELATIVE_PATH);
}

function runOptimizer(outputRoot) {
  const pipeline = spawnSync(process.execPath, [BUILD_ASSETS, SPEC, '--output-root', outputRoot], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (pipeline.stdout) process.stdout.write(pipeline.stdout);
  if (pipeline.stderr) process.stderr.write(pipeline.stderr);
  if (pipeline.status !== 0) {
    throw new Error(`armoury optimizer failed with status ${pipeline.status ?? 'unknown'}`);
  }
  return optimizedPath(outputRoot);
}

async function renderSerializedGlbPreviews(glbPath, kind) {
  const outDir = path.join(ROOT, `tmp/eastbrook_grand_armoury_preview/${stage}/${kind}`);
  const files = await renderPreviews(glbPath, outDir, {
    size: 768,
    views: ['front', 'right', 'back', 'left', 'hero'],
    clips: false,
  });
  for (const file of files) console.log(`${kind} preview: ${path.relative(ROOT, file)}`);
  return files;
}

const { outputFiles } = await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
});
const bundle = outputFiles[0].text;
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${bundle}</script></body></html>`;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--enable-webgl',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('PAGEERR', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('CONSOLE', message.text());
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });

  if (!previewOnly) {
    const result = await page.evaluate((stageName) => {
      return window.exportEastbrookGrandArmoury(stageName);
    }, stage);
    mkdirSync(path.dirname(rawOut), { recursive: true });
    writeFileSync(rawOut, Buffer.from(result.b64, 'base64'));
    console.log(`raw: ${path.relative(ROOT, rawOut)}`);
    console.log(`authoring stats: ${JSON.stringify(result.stats)}`);
  }

  if (!noPreview) {
    mkdirSync(previewDir, { recursive: true });
    const views = [
      'frontThreeQuarter',
      'front',
      'side',
      'rearThreeQuarter',
      'grazing',
      'materialAudit',
    ];
    if (lightingEvidenceStages.has(stage)) {
      views.push('lightingNeutral', 'lightingGrazing', 'lightingDusk');
    }
    if (interactionEvidenceStages.has(stage)) {
      views.push('interactionScaleAudit', 'interactionColliderAudit');
    }
    for (const view of views) {
      const stats = await page.evaluate(
        ({ stageName, viewName }) => {
          return window.renderEastbrookGrandArmouryPreview(stageName, viewName);
        },
        { stageName: stage, viewName: view },
      );
      const canvas = await page.$('canvas');
      if (!canvas) throw new Error('preview canvas was not created');
      const out = path.join(previewDir, `${view}.png`);
      await canvas.screenshot({ path: out });
      console.log(`preview: ${path.relative(ROOT, out)}`);
      console.log(`preview stats: ${JSON.stringify(stats)}`);
    }

    if (paletteAuditStages.has(stage)) {
      const audit = await page.evaluate(() => {
        return window.renderEastbrookGrandArmouryTier1PaletteAudit();
      });
      const canvas = await page.$('canvas');
      if (!canvas) throw new Error('Tier-1 palette audit canvas was not created');
      mkdirSync(tier1Dir, { recursive: true });
      const out = path.join(tier1Dir, 'materialPaletteAudit.png');
      await canvas.screenshot({ path: out });
      console.log(`Tier-1 palette audit: ${path.relative(ROOT, out)}`);
      console.log(`Tier-1 palette audit contract: ${JSON.stringify(audit)}`);
    }
  }
} finally {
  await browser.close();
}

if (!previewOnly) {
  const sourceFingerprint = eastbrookGrandArmourySourceFingerprint(ROOT);
  await stampRawSourceFingerprint(rawOut, sourceFingerprint);
  const rawStats = await inspectGlb(rawOut);
  if (stage === 'optimization' || stage === 'final') {
    verifyGlbContract(rawStats, { optimized: false, sourceFingerprint, expectedStage: stage });
  }
  console.log(`raw validated: ${JSON.stringify(rawStats)}`);

  if (!rawOnly && stage === 'optimization') {
    const candidateRoot = path.join(TEMP_OPTIMIZED_ROOT, 'optimization-candidate');
    const repeatRoot = path.join(TEMP_OPTIMIZED_ROOT, 'optimization-repeat');
    const candidatePath = runOptimizer(candidateRoot);
    const repeatPath = runOptimizer(repeatRoot);
    const candidateBytes = readFileSync(candidatePath);
    const repeatBytes = readFileSync(repeatPath);
    assertCondition(
      candidateBytes.equals(repeatBytes),
      `optimization is nondeterministic: ${createHash('sha256').update(candidateBytes).digest('hex')} != ${createHash('sha256').update(repeatBytes).digest('hex')}`,
    );
    const optimizedStats = await inspectGlb(candidatePath);
    verifyGlbContract(optimizedStats, {
      optimized: true,
      sourceFingerprint,
      expectedStage: stage,
    });
    console.log(`optimized validated: ${JSON.stringify(optimizedStats)}`);
    console.log(`deterministic optimized rebuild: ${optimizedStats.sha256}`);
    try {
      await renderSerializedGlbPreviews(rawOut, 'raw');
      await renderSerializedGlbPreviews(candidatePath, 'optimized');
    } finally {
      await closePreview();
    }
  } else if (!rawOnly && stage === 'final') {
    if (verifyStaged) {
      const verificationRoot = path.join(TEMP_OPTIMIZED_ROOT, 'verify-staged');
      const rebuiltPath = runOptimizer(verificationRoot);
      const rebuiltStats = await inspectGlb(rebuiltPath);
      verifyGlbContract(rebuiltStats, {
        optimized: true,
        sourceFingerprint,
        expectedStage: stage,
      });
      const indexPath = `public/${OPTIMIZED_RELATIVE_PATH}`;
      const staged = spawnSync('git', ['cat-file', 'blob', `:${indexPath}`], {
        cwd: ROOT,
        encoding: null,
        maxBuffer: 4 * 1024 * 1024,
      });
      if (staged.status !== 0 || !Buffer.isBuffer(staged.stdout)) {
        throw new Error(
          `cannot read staged ${indexPath}: ${Buffer.isBuffer(staged.stderr) ? staged.stderr.toString('utf8').trim() : 'unknown git error'}`,
        );
      }
      const rebuilt = readFileSync(rebuiltPath);
      assertCondition(
        rebuilt.equals(staged.stdout),
        `staged ${indexPath} differs from deterministic rebuild`,
      );
      console.log(`staged artifact verified: ${indexPath} (${rebuiltStats.sha256})`);
    } else {
      const pipeline = spawnSync(process.execPath, [BUILD_ASSETS, SPEC], {
        cwd: ROOT,
        stdio: 'inherit',
      });
      if (pipeline.status !== 0) process.exit(pipeline.status ?? 1);
      const shippingPath = path.join(ROOT, 'public', OPTIMIZED_RELATIVE_PATH);
      const shippingStats = await inspectGlb(shippingPath);
      verifyGlbContract(shippingStats, {
        optimized: true,
        sourceFingerprint,
        expectedStage: stage,
      });
      console.log(`shipping optimized validated: ${JSON.stringify(shippingStats)}`);
    }
  } else if (!rawOnly) {
    throw new Error('only optimization or an accepted final stage may run the optimizer');
  }
}
