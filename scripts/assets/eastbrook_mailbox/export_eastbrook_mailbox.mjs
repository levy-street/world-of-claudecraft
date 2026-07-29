// Deterministic procedural Ravenpost mailbox export, optimization, and visual evidence.
//
// Usage:
//   node scripts/assets/eastbrook_mailbox/export_eastbrook_mailbox.mjs
//   node scripts/assets/eastbrook_mailbox/export_eastbrook_mailbox.mjs --no-preview
//   node scripts/assets/eastbrook_mailbox/export_eastbrook_mailbox.mjs --raw-only
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
import { EASTBROOK_MAILBOX_CONTRACT } from './model.js';
import { eastbrookMailboxSourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const RAW_OUT = path.join(ROOT, 'tmp/asset_src/eastbrook_mailbox/eastbrook_mailbox-final.glb');
const SPEC = path.join(ROOT, 'scripts/assets/specs/eastbrook_mailbox.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const SHIPPING_OUT = path.join(ROOT, 'public/models/props/mailbox_pillar.glb');
const CANDIDATE_ROOT = path.join(ROOT, 'tmp/asset_optimized/eastbrook_mailbox/deterministic');
const CANDIDATE_OUT = path.join(CANDIDATE_ROOT, 'models/props/mailbox_pillar.glb');
const EVIDENCE_ROOT = path.join(
  ROOT,
  'docs/screenshots/eastbrook-vale-rebuild/polish/assets/ravenpost-mailbox',
);
const REFERENCE = path.join(
  ROOT,
  'docs/screenshots/eastbrook-vale-rebuild/polish/turnarounds/ravenpost-mailbox.png',
);
const ATLAS = path.join(ROOT, 'public/textures/eastbrook_surface_atlas.webp');
const noPreview = process.argv.includes('--no-preview');
const rawOnly = process.argv.includes('--raw-only');
const TURNAROUND_VIEWS = Object.freeze([
  'front',
  'right',
  'back',
  'left',
  'front-3q',
  'rear-3q',
  'grazing',
]);
const LOOKDEV_VIEWS = Object.freeze(['neutral', 'dusk', 'low', 'player-scale']);
const STAGES = Object.freeze(['blockout', 'structural', 'form', 'material']);

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function assertApproxArray(actual, expected, label, tolerance) {
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

function fingerprintExtras(root) {
  return {
    document: root.getExtras()?.sourceFingerprint,
    asset: root.getAsset().extras?.sourceFingerprint,
  };
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
        material: primitive.getMaterial()?.getName() ?? null,
        mode: primitive.getMode(),
        attributes: primitive.listSemantics().sort(),
        triangles: (primitive.getIndices()?.getCount() ?? position.getCount()) / 3,
      };
    }),
  }));
  const modelRoot = root
    .listNodes()
    .find((node) => node.getName() === EASTBROOK_MAILBOX_CONTRACT.rootName);
  const sockets = EASTBROOK_MAILBOX_CONTRACT.sockets.map((definition) => {
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
    path: path.relative(ROOT, glbPath),
    bytes: statSync(glbPath).size,
    sha256: createHash('sha256').update(readFileSync(glbPath)).digest('hex'),
    usedExtensions: root
      .listExtensionsUsed()
      .map((extension) => extension.extensionName)
      .sort(),
    requiredExtensions: root
      .listExtensionsRequired()
      .map((extension) => extension.extensionName)
      .sort(),
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
    materials: root.listMaterials().map((material) => ({
      name: material.getName(),
      metalness: material.getMetallicFactor(),
      roughness: material.getRoughnessFactor(),
    })),
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

function verifyContract(stats, optimized, sourceFingerprint) {
  const expectedUsed = optimized ? ['EXT_meshopt_compression', 'KHR_mesh_quantization'] : [];
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
    JSON.stringify(stats.sceneChildren) === JSON.stringify([EASTBROOK_MAILBOX_CONTRACT.rootName]),
    `${stats.path} scene root changed`,
  );
  assertCondition(stats.nodes === 5, `${stats.path} must contain five semantic nodes`);
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
    stats.triangles <= EASTBROOK_MAILBOX_CONTRACT.triangleTarget,
    `${stats.path} exceeds ${EASTBROOK_MAILBOX_CONTRACT.triangleTarget} target triangles`,
  );
  assertCondition(
    stats.triangles <= EASTBROOK_MAILBOX_CONTRACT.triangleCeiling,
    `${stats.path} exceeds ${EASTBROOK_MAILBOX_CONTRACT.triangleCeiling} hard triangles`,
  );
  assertCondition(stats.materials.length === 2, `${stats.path} must contain two materials`);
  assertCondition(
    JSON.stringify(stats.materials.map((material) => material.name).sort()) ===
      JSON.stringify(['MailboxMetal', 'MailboxOpaque']),
    `${stats.path} material names changed`,
  );
  assertCondition(
    stats.textures === 0 && stats.animations === 0 && stats.skins === 0 && stats.cameras === 0,
    `${stats.path} gained textures, animations, skins, or cameras`,
  );
  if (optimized) {
    assertCondition(
      stats.bytes <= EASTBROOK_MAILBOX_CONTRACT.byteCeiling,
      `${stats.path} exceeds ${EASTBROOK_MAILBOX_CONTRACT.byteCeiling} bytes`,
    );
  }
  const { width, height, depth } = EASTBROOK_MAILBOX_CONTRACT.dimensions;
  const tolerance = optimized ? 2e-3 : 1e-5;
  assertApproxArray(
    stats.bounds.min,
    [-width / 2, 0, -depth / 2],
    `${stats.path} bounds min`,
    tolerance,
  );
  assertApproxArray(
    stats.bounds.max,
    [width / 2, height, depth / 2],
    `${stats.path} bounds max`,
    tolerance,
  );
  assertCondition(stats.modelRoot, `${stats.path} has no semantic root`);
  assertApproxArray(stats.modelRoot.translation, [0, 0, 0], `${stats.path} root translation`, 1e-8);
  assertApproxArray(stats.modelRoot.rotation, [0, 0, 0, 1], `${stats.path} root rotation`, 1e-8);
  assertApproxArray(stats.modelRoot.scale, [1, 1, 1], `${stats.path} root scale`, 1e-8);
  const runtime = stats.modelRoot.extras.sculptRuntime;
  assertCondition(
    runtime?.assetId === EASTBROOK_MAILBOX_CONTRACT.id,
    `${stats.path} asset id changed`,
  );
  assertCondition(runtime?.stage === 'final', `${stats.path} is not the final stage`);
  assertCondition(runtime?.coordinateFrame?.front === '+Z', `${stats.path} front axis changed`);
  assertCondition(runtime?.interaction?.interactive === true, `${stats.path} lost interaction cue`);
  assertCondition(
    runtime?.interaction?.authority === 'ground-object-entity',
    `${stats.path} changed interaction authority`,
  );
  assertCondition(
    runtime?.collider?.shippingCollisionMesh === false,
    `${stats.path} added collision geometry`,
  );
  for (const [index, definition] of EASTBROOK_MAILBOX_CONTRACT.sockets.entries()) {
    const socket = stats.sockets[index];
    assertCondition(socket, `${stats.path} lost ${definition.name}`);
    assertCondition(
      socket.children === 0 && socket.mesh === null,
      `${definition.name} is not empty`,
    );
    assertApproxArray(
      socket.translation,
      definition.position,
      `${definition.name} translation`,
      tolerance,
    );
    assertApproxArray(socket.rotation, [0, 0, 0, 1], `${definition.name} rotation`, 1e-8);
    assertApproxArray(socket.scale, [1, 1, 1], `${definition.name} scale`, 1e-8);
    assertCondition(
      socket.extras?.sculptSocket?.id === definition.id,
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
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0)
    throw new Error(`mailbox optimizer failed: ${result.status ?? 'unknown'}`);
}

function labelSvg(label, width) {
  const escaped = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return Buffer.from(
    `<svg width="${width}" height="40"><rect width="${width}" height="40" fill="#17202bdd"/><text x="14" y="27" fill="#f3d58b" font-family="sans-serif" font-size="18" font-weight="700">${escaped}</text></svg>`,
  );
}

async function makeContactSheet(files, labels, outPath, title) {
  const cellWidth = 420;
  const cellHeight = 336;
  const titleHeight = 52;
  const columns = 3;
  const rows = Math.ceil(files.length / columns);
  const composites = [{ input: labelSvg(title, cellWidth * columns), left: 0, top: 0 }];
  for (let index = 0; index < files.length; index++) {
    const image = await sharp(files[index])
      .resize(cellWidth, cellHeight, { fit: 'cover' })
      .png()
      .toBuffer();
    const left = (index % columns) * cellWidth;
    const top = titleHeight + Math.floor(index / columns) * (cellHeight + 40);
    composites.push({ input: image, left, top });
    composites.push({ input: labelSvg(labels[index], cellWidth), left, top: top + cellHeight });
  }
  mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp({
    create: {
      width: cellWidth * columns,
      height: titleHeight + rows * (cellHeight + 40),
      channels: 3,
      background: '#c7cbd0',
    },
  })
    .composite(composites)
    .png()
    .toFile(outPath);
}

async function makeReferenceComparison(optimizedContact) {
  const panelWidth = 760;
  const panelHeight = 650;
  const left = await sharp(REFERENCE)
    .resize(panelWidth, panelHeight, { fit: 'contain', background: '#d7d9dc' })
    .png()
    .toBuffer();
  const right = await sharp(optimizedContact)
    .resize(panelWidth, panelHeight, { fit: 'contain', background: '#d7d9dc' })
    .png()
    .toBuffer();
  const out = path.join(EVIDENCE_ROOT, 'reference-vs-optimized-contact.png');
  await sharp({
    create: { width: panelWidth * 2, height: panelHeight + 40, channels: 3, background: '#d7d9dc' },
  })
    .composite([
      { input: left, left: 0, top: 40 },
      { input: right, left: panelWidth, top: 40 },
      { input: labelSvg('Imagegen turnaround reference', panelWidth), left: 0, top: 0 },
      { input: labelSvg('Optimized GLB multi-angle render', panelWidth), left: panelWidth, top: 0 },
    ])
    .png()
    .toFile(out);
  return out;
}

const sourceFingerprint = eastbrookMailboxSourceFingerprint(ROOT);
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

let page;
try {
  page = await browser.newPage();
  await page.setViewport({ width: 900, height: 720, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('PAGEERR', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('CONSOLE', message.text());
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__eastbrookMailboxReady !== undefined', { timeout: 20_000 });

  const result = await page.evaluate(() => window.exportEastbrookMailbox());
  mkdirSync(path.dirname(RAW_OUT), { recursive: true });
  writeFileSync(RAW_OUT, Buffer.from(result.b64, 'base64'));
  await stampSourceFingerprint(RAW_OUT, sourceFingerprint);
  const rawStats = await inspectGlb(RAW_OUT);
  verifyContract(rawStats, false, sourceFingerprint);
  console.log(`raw mailbox: ${JSON.stringify(rawStats)}`);

  if (!rawOnly) {
    runOptimizer(null);
    const shippingStats = await inspectGlb(SHIPPING_OUT);
    verifyContract(shippingStats, true, sourceFingerprint);
    runOptimizer(CANDIDATE_ROOT);
    const candidateStats = await inspectGlb(CANDIDATE_OUT);
    verifyContract(candidateStats, true, sourceFingerprint);
    assertCondition(
      readFileSync(CANDIDATE_OUT).equals(readFileSync(SHIPPING_OUT)),
      'deterministic optimized mailbox rebuild differs byte-for-byte',
    );
    console.log(`optimized mailbox: ${JSON.stringify(shippingStats)}`);
    console.log(`deterministic optimized rebuild: ${shippingStats.sha256}`);
  }

  if (!noPreview) {
    const atlasDataUrl = `data:image/webp;base64,${readFileSync(ATLAS).toString('base64')}`;
    const capture = async ({ kind, b64 = null, viewName, stage = 'final', out }) => {
      await page.evaluate((options) => window.renderEastbrookMailboxPreview(options), {
        kind,
        b64,
        viewName,
        stage,
        atlasDataUrl,
      });
      const canvas = await page.$('canvas');
      if (!canvas) throw new Error('mailbox preview canvas was not created');
      mkdirSync(path.dirname(out), { recursive: true });
      await canvas.screenshot({ path: out });
      return out;
    };

    const stageFiles = [];
    for (const stage of STAGES) {
      stageFiles.push(
        await capture({
          kind: 'procedural',
          stage,
          viewName: stage === 'material' ? 'grazing' : 'front-3q',
          out: path.join(EVIDENCE_ROOT, 'stages', `${stage}.png`),
        }),
      );
    }
    await makeContactSheet(
      stageFiles,
      ['blockout', 'structural pass', 'form refinement', 'material and surface pass'],
      path.join(EVIDENCE_ROOT, 'stages-contact.png'),
      'img2threejs staged construction mapped to the deterministic repository factory',
    );

    const rawBase64 = readFileSync(RAW_OUT).toString('base64');
    const optimizedBase64 = rawOnly ? null : readFileSync(SHIPPING_OUT).toString('base64');
    const contacts = [];
    for (const [kind, base64] of [
      ['procedural', null],
      ['raw', rawBase64],
      ...(optimizedBase64 ? [['optimized', optimizedBase64]] : []),
    ]) {
      const files = [];
      for (const viewName of TURNAROUND_VIEWS) {
        files.push(
          await capture({
            kind: kind === 'procedural' ? 'procedural' : 'serialized',
            b64: base64,
            viewName,
            out: path.join(EVIDENCE_ROOT, kind, `${viewName}.png`),
          }),
        );
      }
      const contact = path.join(EVIDENCE_ROOT, `${kind}-contact.png`);
      await makeContactSheet(files, TURNAROUND_VIEWS, contact, `${kind} Ravenpost mailbox`);
      contacts.push({ kind, contact });
    }

    if (optimizedBase64) {
      const lookdevFiles = [];
      for (const viewName of LOOKDEV_VIEWS) {
        lookdevFiles.push(
          await capture({
            kind: 'serialized',
            b64: optimizedBase64,
            viewName,
            out: path.join(EVIDENCE_ROOT, 'optimized-lookdev', `${viewName}.png`),
          }),
        );
      }
      await makeContactSheet(
        lookdevFiles,
        ['neutral', 'dusk', 'Lambert-compatible Low', '2.6-yard player scale'],
        path.join(EVIDENCE_ROOT, 'optimized-lookdev-contact.png'),
        'Optimized GLB surface and scale audit',
      );
      const optimizedContact = contacts.find((entry) => entry.kind === 'optimized')?.contact;
      if (optimizedContact)
        console.log(
          `comparison: ${path.relative(ROOT, await makeReferenceComparison(optimizedContact))}`,
        );
    }
  }
} finally {
  await browser.close();
}

console.log(`source fingerprint: ${sourceFingerprint}`);
