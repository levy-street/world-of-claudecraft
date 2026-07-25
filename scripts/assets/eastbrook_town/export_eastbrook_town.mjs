// Deterministic raw export, meshopt optimization, preview evidence, and staged verification.
//
// Usage:
//   node scripts/assets/eastbrook_town/export_eastbrook_town.mjs
//   node scripts/assets/eastbrook_town/export_eastbrook_town.mjs --raw-only
//   node scripts/assets/eastbrook_town/export_eastbrook_town.mjs --preview-only
//   node scripts/assets/eastbrook_town/export_eastbrook_town.mjs --preview-only --asset wall_wing
//   node scripts/assets/eastbrook_town/export_eastbrook_town.mjs --verify-staged --no-preview
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
import sharp from 'sharp';
import { BROWSER_PATH } from '../../browser_path.mjs';
import { EASTBROOK_TOWN_ASSET_IDS, EASTBROOK_TOWN_CONTRACTS } from './model.js';
import { eastbrookTownSourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const SPEC = path.join(ROOT, 'scripts/assets/specs/eastbrook_town.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const RAW_ROOT = path.join(ROOT, 'tmp/asset_src/eastbrook_town');
const TEMP_ROOT = path.join(ROOT, 'tmp/asset_optimized/eastbrook_town');
const PREVIEW_ROOT = path.join(ROOT, 'tmp/eastbrook_town_preview');
const DEFAULT_EVIDENCE_ROOT = path.join(ROOT, 'docs/screenshots/eastbrook-vale-rebuild/assets');
const TURNAROUND_ROOT = path.join(ROOT, 'docs/screenshots/eastbrook-vale-rebuild/turnarounds');
const TOTAL_TRIANGLE_CEILING = 30_000;
const TOTAL_BYTE_CEILING = Math.floor(1.25 * 1024 * 1024);
const TURNAROUND_VIEWS = Object.freeze([
  'front',
  'right',
  'back',
  'left',
  'front-3q',
  'rear-3q',
  'hero',
  'grazing',
]);
const AUDIT_VIEWS = Object.freeze(['neutral', 'dusk', 'player-scale', 'collider-overlay']);

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const rawOnly = process.argv.includes('--raw-only');
const previewOnly = process.argv.includes('--preview-only');
const noPreview = process.argv.includes('--no-preview');
const verifyStaged = process.argv.includes('--verify-staged');
const previewAsset = optionValue('--asset', null);
const evidenceRoot = path.resolve(optionValue('--evidence-dir', DEFAULT_EVIDENCE_ROOT));
if (verifyStaged && (rawOnly || previewOnly)) {
  throw new Error('--verify-staged cannot be combined with --raw-only or --preview-only');
}
if (previewOnly && noPreview)
  throw new Error('--preview-only cannot be combined with --no-preview');
if (previewAsset && !previewOnly) throw new Error('--asset requires --preview-only');
if (previewAsset && !EASTBROOK_TOWN_ASSET_IDS.includes(previewAsset)) {
  throw new Error(`unknown Eastbrook town preview asset: ${previewAsset}`);
}
const previewAssetIds = previewAsset ? [previewAsset] : EASTBROOK_TOWN_ASSET_IDS;

const optimizerSpec = JSON.parse(readFileSync(SPEC, 'utf8'));
const specById = new Map();
for (const item of optimizerSpec.items ?? []) {
  const rawName = path.basename(item.src, '.glb').replace(/-final$/, '');
  specById.set(rawName, item);
}
for (const assetId of EASTBROOK_TOWN_ASSET_IDS) {
  const contract = EASTBROOK_TOWN_CONTRACTS[assetId];
  const item = specById.get(assetId);
  if (!item) throw new Error(`optimizer spec is missing ${assetId}`);
  if (path.basename(item.out) !== contract.outputName) {
    throw new Error(`${assetId} spec output does not match ${contract.outputName}`);
  }
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function assertApproxArray(actual, expected, label, tolerance = 2e-3) {
  assertCondition(actual.length === expected.length, `${label} length changed`);
  for (let index = 0; index < expected.length; index++) {
    assertCondition(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `${label}[${index}] expected ${expected[index]}, got ${actual[index]}`,
    );
  }
}

async function createNodeIo() {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

function rawPath(assetId) {
  return path.join(RAW_ROOT, `${assetId}-final.glb`);
}

function outputPath(outputRoot, assetId) {
  return path.join(outputRoot, specById.get(assetId).out);
}

function fingerprintExtras(root) {
  return {
    document: root.getExtras()?.sourceFingerprint,
    asset: root.getAsset().extras?.sourceFingerprint,
  };
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
  const fingerprints = fingerprintExtras(reopened.getRoot());
  assertCondition(
    fingerprints.document === sourceFingerprint && fingerprints.asset === sourceFingerprint,
    `${path.relative(ROOT, glbPath)} lost its source fingerprint`,
  );
}

async function inspectGlb(glbPath, assetId) {
  const contract = EASTBROOK_TOWN_CONTRACTS[assetId];
  const io = await createNodeIo();
  const document = await io.read(glbPath);
  const root = document.getRoot();
  const scene = root.listScenes()[0];
  if (!scene) throw new Error(`${glbPath} has no scene`);
  const meshes = root.listMeshes().map((mesh) => ({
    name: mesh.getName(),
    primitives: mesh.listPrimitives().map((primitive) => {
      const position = primitive.getAttribute('POSITION');
      if (!position) throw new Error(`${mesh.getName()} has no POSITION`);
      return {
        mode: primitive.getMode(),
        material: primitive.getMaterial()?.getName() ?? null,
        attributes: primitive.listSemantics().sort(),
        triangles: (primitive.getIndices()?.getCount() ?? position.getCount()) / 3,
      };
    }),
  }));
  const materials = root.listMaterials().map((material) => ({
    name: material.getName(),
    metalness: material.getMetallicFactor(),
    roughness: material.getRoughnessFactor(),
    emissive: material.getEmissiveFactor(),
  }));
  const extensionNames = (extensions) =>
    extensions.map((extension) => extension.extensionName).sort();
  const modelRoot = root.listNodes().find((node) => node.getName() === contract.rootName);
  const sockets = contract.sockets.map((definition) => {
    const node = root.listNodes().find((candidate) => candidate.getName() === definition.name);
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
  return {
    assetId,
    path: path.relative(ROOT, glbPath),
    bytes: statSync(glbPath).size,
    sha256: createHash('sha256').update(readFileSync(glbPath)).digest('hex'),
    usedExtensions: extensionNames(root.listExtensionsUsed()),
    requiredExtensions: extensionNames(root.listExtensionsRequired()),
    scenes: root.listScenes().length,
    sceneChildren: scene.listChildren().map((node) => node.getName()),
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
    bounds: getBounds(scene),
    modelRoot: modelRoot
      ? {
          translation: modelRoot.getTranslation(),
          rotation: modelRoot.getRotation(),
          scale: modelRoot.getScale(),
          extras: modelRoot.getExtras(),
        }
      : null,
    sockets,
    fingerprints: fingerprintExtras(root),
  };
}

function verifyGlbContract(stats, { optimized, sourceFingerprint }) {
  const contract = EASTBROOK_TOWN_CONTRACTS[stats.assetId];
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
    JSON.stringify(stats.sceneChildren) === JSON.stringify([contract.rootName]),
    `${stats.path} scene root changed`,
  );
  assertCondition(stats.meshes.length === 2, `${stats.path} must contain two meshes`);
  assertCondition(stats.primitives === 2, `${stats.path} must contain two primitives`);
  assertCondition(
    stats.meshes.every(
      (mesh) =>
        mesh.primitives.length === 1 &&
        mesh.primitives[0].mode === Primitive.Mode.TRIANGLES &&
        JSON.stringify(mesh.primitives[0].attributes) ===
          JSON.stringify(['COLOR_0', 'NORMAL', 'POSITION']),
    ),
    `${stats.path} mesh topology contract changed`,
  );
  assertCondition(
    stats.triangles <= contract.triangleCeiling,
    `${stats.path} exceeds ${contract.triangleCeiling} triangles`,
  );
  assertCondition(stats.materials.length === 2, `${stats.path} must contain two materials`);
  assertCondition(
    JSON.stringify(stats.materials.map((material) => material.name).sort()) ===
      JSON.stringify(['TownEmissive', 'TownOpaque']),
    `${stats.path} material names changed`,
  );
  assertCondition(
    stats.materials.filter((material) => material.emissive.some((value) => value > 0)).length === 1,
    `${stats.path} must contain one emissive material`,
  );
  if (optimized) {
    assertCondition(
      stats.bytes <= contract.byteCeiling,
      `${stats.path} exceeds ${contract.byteCeiling} bytes`,
    );
  }
  assertCondition(
    stats.textures === 0 && stats.animations === 0 && stats.skins === 0 && stats.cameras === 0,
    `${stats.path} gained textures, animation, skinning, or cameras`,
  );
  const halfWidth = contract.dimensions.width / 2;
  const halfDepth = contract.dimensions.depth / 2;
  assertApproxArray(stats.bounds.min, [-halfWidth, 0, -halfDepth], `${stats.path} bounds min`);
  assertApproxArray(
    stats.bounds.max,
    [halfWidth, contract.dimensions.height, halfDepth],
    `${stats.path} bounds max`,
  );
  assertCondition(stats.modelRoot, `${stats.path} has no ${contract.rootName} root node`);
  assertApproxArray(stats.modelRoot.translation, [0, 0, 0], `${stats.path} root translation`);
  assertApproxArray(stats.modelRoot.rotation, [0, 0, 0, 1], `${stats.path} root rotation`);
  assertApproxArray(stats.modelRoot.scale, [1, 1, 1], `${stats.path} root scale`);
  const runtime = stats.modelRoot.extras.sculptRuntime;
  assertCondition(runtime?.assetId === contract.id, `${stats.path} asset id changed`);
  assertCondition(runtime?.coordinateFrame?.front === '+Z', `${stats.path} front axis changed`);
  assertCondition(runtime?.interaction?.interactive === false, `${stats.path} became interactive`);
  assertCondition(
    runtime?.collider?.shippingCollisionMesh === false,
    `${stats.path} added collision geometry`,
  );
  assertCondition(runtime?.destruction?.breakable === false, `${stats.path} became breakable`);
  assertCondition(
    JSON.stringify(runtime?.serviceCues) === JSON.stringify(contract.serviceCues),
    `${stats.path} service cue inventory changed`,
  );
  for (const [index, definition] of contract.sockets.entries()) {
    const socket = stats.sockets[index];
    assertCondition(socket, `${stats.path} lost ${definition.name}`);
    assertCondition(
      socket.children === 0 && socket.mesh === null,
      `${definition.name} is not empty`,
    );
    assertApproxArray(socket.rotation, [0, 0, 0, 1], `${definition.name} rotation`);
    assertApproxArray(socket.scale, [1, 1, 1], `${definition.name} scale`);
    assertCondition(
      socket.extras?.sculptSocket?.id === definition.id &&
        socket.extras?.sculptSocket?.interactive === false,
      `${definition.name} metadata changed`,
    );
  }
  assertCondition(
    stats.fingerprints.document === sourceFingerprint &&
      stats.fingerprints.asset === sourceFingerprint,
    `${stats.path} source fingerprint changed or is missing`,
  );
}

function runOptimizer(outputRoot) {
  const args = [BUILD_ASSETS, SPEC];
  if (outputRoot) args.push('--output-root', outputRoot);
  const pipeline = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (pipeline.stdout) process.stdout.write(pipeline.stdout);
  if (pipeline.stderr) process.stderr.write(pipeline.stderr);
  if (pipeline.status !== 0) {
    throw new Error(`Eastbrook town optimizer failed with status ${pipeline.status ?? 'unknown'}`);
  }
}

function labelSvg(label, width) {
  const escaped = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return Buffer.from(
    `<svg width="${width}" height="42"><rect width="${width}" height="42" fill="#17202bcc"/><text x="16" y="28" fill="#f3d58b" font-family="sans-serif" font-size="20" font-weight="700">${escaped}</text></svg>`,
  );
}

async function makeContactSheet(files, labels, outPath, title) {
  const cellWidth = 480;
  const cellHeight = 384;
  const titleHeight = 56;
  const columns = 3;
  const rows = Math.ceil(files.length / columns);
  const composites = [{ input: labelSvg(title, cellWidth * columns), left: 0, top: 0 }];
  for (let index = 0; index < files.length; index++) {
    const image = await sharp(files[index])
      .resize(cellWidth, cellHeight, { fit: 'contain', background: '#d1d6dc' })
      .png()
      .toBuffer();
    const left = (index % columns) * cellWidth;
    const top = titleHeight + Math.floor(index / columns) * cellHeight;
    composites.push({ input: image, left, top });
    composites.push({ input: labelSvg(labels[index], cellWidth), left, top });
  }
  mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp({
    create: {
      width: cellWidth * columns,
      height: titleHeight + rows * cellHeight,
      channels: 3,
      background: '#c3c9d0',
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  return outPath;
}

async function makeComparisonSheet(referencePath, renderPath, outPath, title) {
  const panelWidth = 720;
  const panelHeight = 560;
  const titleHeight = 56;
  const reference = await sharp(referencePath)
    .resize(panelWidth, panelHeight, { fit: 'contain', background: '#d1d6dc' })
    .png()
    .toBuffer();
  const render = await sharp(renderPath)
    .resize(panelWidth, panelHeight, { fit: 'contain', background: '#d1d6dc' })
    .png()
    .toBuffer();
  mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp({
    create: {
      width: panelWidth * 2,
      height: titleHeight + panelHeight,
      channels: 3,
      background: '#c3c9d0',
    },
  })
    .composite([
      { input: labelSvg(title, panelWidth * 2), left: 0, top: 0 },
      { input: reference, left: 0, top: titleHeight },
      { input: render, left: panelWidth, top: titleHeight },
      { input: labelSvg('Accepted turnaround reference', panelWidth), left: 0, top: titleHeight },
      {
        input: labelSvg('Optimized GLB hero render', panelWidth),
        left: panelWidth,
        top: titleHeight,
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  return outPath;
}

async function renderSerializedContacts(kind, paths, assetIds = EASTBROOK_TOWN_ASSET_IDS) {
  const outputs = new Map();
  const previewBrowser = await puppeteer.launch({
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
    const page = await previewBrowser.newPage();
    await page.setViewport({ width: 900, height: 720, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => console.error('PAGEERR', error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error('CONSOLE', message.text());
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', { timeout: 20_000 });
    for (const assetId of assetIds) {
      const outDir = path.join(PREVIEW_ROOT, assetId, kind);
      mkdirSync(outDir, { recursive: true });
      const base64 = readFileSync(paths.get(assetId)).toString('base64');
      const renderViews = async (views, subdirectory = '') => {
        const files = [];
        const destination = path.join(outDir, subdirectory);
        mkdirSync(destination, { recursive: true });
        for (const view of views) {
          const rendered = await page.evaluate(
            ({ data, id, viewName }) =>
              window.renderEastbrookTownSerializedPreview(data, id, viewName),
            { data: base64, id: assetId, viewName: view },
          );
          const out = path.join(destination, `${view}.png`);
          writeFileSync(out, Buffer.from(rendered.dataUrl.split(',')[1], 'base64'));
          files.push(out);
          console.log(
            `${kind} preview: ${assetId} ${view} ${JSON.stringify({
              bounds: rendered.bounds,
              previewLighting: rendered.previewLighting,
              previewOnlyPlayerProxy: rendered.previewOnlyPlayerProxy,
              previewOnlyContractBounds: rendered.previewOnlyContractBounds,
              shippingCollisionMesh: rendered.shippingCollisionMesh,
            })}`,
          );
        }
        return files;
      };
      const files = await renderViews(TURNAROUND_VIEWS);
      const contact = path.join(evidenceRoot, `${assetId}-${kind}-contact.png`);
      await makeContactSheet(
        files,
        TURNAROUND_VIEWS,
        contact,
        `${assetId}: ${kind} serialized GLB`,
      );
      let auditContact = null;
      if (kind === 'optimized') {
        const auditFiles = await renderViews(AUDIT_VIEWS, 'audit');
        auditContact = path.join(evidenceRoot, `${assetId}-optimized-audit-contact.png`);
        await makeContactSheet(
          auditFiles,
          AUDIT_VIEWS,
          auditContact,
          `${assetId}: optimized lighting, scale, and bounds audit`,
        );
        console.log(`optimized audit contact: ${path.relative(ROOT, auditContact)}`);
      }
      outputs.set(assetId, {
        files,
        contact,
        hero: files.find((file) => file.endsWith('hero.png')),
        auditContact,
      });
      console.log(`${kind} contact: ${path.relative(ROOT, contact)}`);
    }
  } finally {
    await previewBrowser.close();
  }
  return outputs;
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
  await page.setViewport({ width: 900, height: 720, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('PAGEERR', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('CONSOLE', message.text());
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 20_000 });

  for (const assetId of previewOnly ? previewAssetIds : EASTBROOK_TOWN_ASSET_IDS) {
    if (!previewOnly) {
      const result = await page.evaluate((id) => window.exportEastbrookTownAsset(id), assetId);
      const out = rawPath(assetId);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(result.b64, 'base64'));
      console.log(`raw: ${path.relative(ROOT, out)}`);
      console.log(`authoring stats: ${assetId} ${JSON.stringify(result.stats)}`);
    }

    if (!noPreview) {
      const files = [];
      const outDir = path.join(PREVIEW_ROOT, assetId, 'procedural');
      mkdirSync(outDir, { recursive: true });
      for (const view of TURNAROUND_VIEWS) {
        const stats = await page.evaluate(
          ({ id, viewName }) => window.renderEastbrookTownPreview(id, viewName),
          { id: assetId, viewName: view },
        );
        const canvas = await page.$('canvas');
        if (!canvas) throw new Error('preview canvas was not created');
        const out = path.join(outDir, `${view}.png`);
        await canvas.screenshot({ path: out });
        files.push(out);
        console.log(`procedural preview: ${assetId} ${view} ${JSON.stringify(stats.bounds)}`);
      }
      const contact = path.join(evidenceRoot, `${assetId}-procedural-contact.png`);
      await makeContactSheet(files, TURNAROUND_VIEWS, contact, `${assetId}: procedural factory`);
      console.log(`procedural contact: ${path.relative(ROOT, contact)}`);
    }
  }
} finally {
  await browser.close();
}

if (previewOnly) {
  const rawPaths = new Map(previewAssetIds.map((assetId) => [assetId, rawPath(assetId)]));
  const optimizedPaths = new Map(
    previewAssetIds.map((assetId) => [assetId, outputPath(path.join(ROOT, 'public'), assetId)]),
  );
  const rawContacts = await renderSerializedContacts('raw', rawPaths, previewAssetIds);
  const optimizedContacts = await renderSerializedContacts(
    'optimized',
    optimizedPaths,
    previewAssetIds,
  );
  for (const assetId of previewAssetIds) {
    const contract = EASTBROOK_TOWN_CONTRACTS[assetId];
    const hero = optimizedContacts.get(assetId)?.hero;
    assertCondition(hero, `${assetId} optimized hero render is missing`);
    const comparison = path.join(evidenceRoot, `${assetId}-comparison.png`);
    await makeComparisonSheet(
      path.join(TURNAROUND_ROOT, contract.referenceName),
      hero,
      comparison,
      `${assetId}: accepted reference and optimized artifact`,
    );
    console.log(`comparison: ${path.relative(ROOT, comparison)}`);
  }
  assertCondition(rawContacts.size === previewAssetIds.length, 'raw contacts missing');
}

if (!previewOnly) {
  const sourceFingerprint = eastbrookTownSourceFingerprint(ROOT);
  const rawStats = [];
  const rawPaths = new Map();
  for (const assetId of EASTBROOK_TOWN_ASSET_IDS) {
    const glbPath = rawPath(assetId);
    rawPaths.set(assetId, glbPath);
    await stampRawSourceFingerprint(glbPath, sourceFingerprint);
    const stats = await inspectGlb(glbPath, assetId);
    verifyGlbContract(stats, { optimized: false, sourceFingerprint });
    rawStats.push(stats);
    console.log(`raw validated: ${JSON.stringify(stats)}`);
  }
  assertCondition(
    rawStats.reduce((sum, stats) => sum + stats.triangles, 0) <= TOTAL_TRIANGLE_CEILING,
    `town raw assets exceed ${TOTAL_TRIANGLE_CEILING} total triangles`,
  );

  let rawContacts = null;
  if (!noPreview) rawContacts = await renderSerializedContacts('raw', rawPaths);

  if (!rawOnly) {
    const optimizedRoot = verifyStaged
      ? path.join(TEMP_ROOT, 'verify-staged')
      : path.join(ROOT, 'public');
    runOptimizer(verifyStaged ? optimizedRoot : undefined);
    const optimizedPaths = new Map();
    const optimizedStats = [];
    for (const assetId of EASTBROOK_TOWN_ASSET_IDS) {
      const glbPath = outputPath(optimizedRoot, assetId);
      optimizedPaths.set(assetId, glbPath);
      const stats = await inspectGlb(glbPath, assetId);
      verifyGlbContract(stats, { optimized: true, sourceFingerprint });
      optimizedStats.push(stats);
      console.log(`optimized validated: ${JSON.stringify(stats)}`);
    }
    assertCondition(
      optimizedStats.reduce((sum, stats) => sum + stats.bytes, 0) <= TOTAL_BYTE_CEILING,
      `town optimized assets exceed ${TOTAL_BYTE_CEILING} total bytes`,
    );
    assertCondition(
      optimizedStats.reduce((sum, stats) => sum + stats.triangles, 0) <= TOTAL_TRIANGLE_CEILING,
      `town optimized assets exceed ${TOTAL_TRIANGLE_CEILING} total triangles`,
    );

    if (verifyStaged) {
      for (const assetId of EASTBROOK_TOWN_ASSET_IDS) {
        const indexPath = `public/${specById.get(assetId).out}`;
        const staged = spawnSync('git', ['cat-file', 'blob', `:${indexPath}`], {
          cwd: ROOT,
          encoding: null,
          maxBuffer: 16 * 1024 * 1024,
        });
        if (staged.status !== 0 || !Buffer.isBuffer(staged.stdout)) {
          throw new Error(
            `cannot read staged ${indexPath}: ${Buffer.isBuffer(staged.stderr) ? staged.stderr.toString('utf8').trim() : 'unknown git error'}`,
          );
        }
        const rebuilt = readFileSync(optimizedPaths.get(assetId));
        assertCondition(rebuilt.equals(staged.stdout), `staged ${indexPath} differs from rebuild`);
        console.log(`staged artifact verified: ${indexPath}`);
      }
    } else {
      const repeatRoot = path.join(TEMP_ROOT, 'determinism-repeat');
      runOptimizer(repeatRoot);
      for (const assetId of EASTBROOK_TOWN_ASSET_IDS) {
        const shipping = readFileSync(optimizedPaths.get(assetId));
        const repeat = readFileSync(outputPath(repeatRoot, assetId));
        assertCondition(
          shipping.equals(repeat),
          `${assetId} optimization is nondeterministic: ${createHash('sha256').update(shipping).digest('hex')} != ${createHash('sha256').update(repeat).digest('hex')}`,
        );
        console.log(
          `deterministic optimized rebuild: ${assetId} ${createHash('sha256').update(shipping).digest('hex')}`,
        );
      }
    }

    if (!noPreview) {
      const optimizedContacts = await renderSerializedContacts('optimized', optimizedPaths);
      for (const assetId of EASTBROOK_TOWN_ASSET_IDS) {
        const contract = EASTBROOK_TOWN_CONTRACTS[assetId];
        const hero = optimizedContacts.get(assetId)?.hero;
        assertCondition(hero, `${assetId} optimized hero render is missing`);
        const comparison = path.join(evidenceRoot, `${assetId}-comparison.png`);
        await makeComparisonSheet(
          path.join(TURNAROUND_ROOT, contract.referenceName),
          hero,
          comparison,
          `${assetId}: accepted reference and optimized artifact`,
        );
        console.log(`comparison: ${path.relative(ROOT, comparison)}`);
      }
      assertCondition(
        rawContacts?.size === EASTBROOK_TOWN_ASSET_IDS.length,
        'raw contacts missing',
      );
    }
  }
}
