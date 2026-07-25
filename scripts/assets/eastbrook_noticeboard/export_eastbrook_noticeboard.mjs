// Deterministic staged Eastbrook noticeboard authoring, export, optimization,
// contract validation, and visual evidence capture.
//
// Usage:
//   node scripts/assets/eastbrook_noticeboard/export_eastbrook_noticeboard.mjs \
//     --stage blockout --preview-only
//   node scripts/assets/eastbrook_noticeboard/export_eastbrook_noticeboard.mjs \
//     --stage final
//   node scripts/assets/eastbrook_noticeboard/export_eastbrook_noticeboard.mjs \
//     --stage final --no-preview
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as esbuild from 'esbuild';
import { MeshoptDecoder } from 'meshoptimizer';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from '../../browser_path.mjs';
import {
  NOTICEBOARD_NATIVE_BOUNDS,
  NOTICEBOARD_SOCKET_DEFINITIONS,
  NOTICEBOARD_STAGES,
} from './model.js';
import { eastbrookNoticeboardSourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const SPEC = path.join(ROOT, 'scripts/assets/specs/eastbrook_noticeboard.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const RAW_ROOT = path.join(ROOT, 'tmp/asset_src/eastbrook_noticeboard');
const SHIPPING_OUT = path.join(ROOT, 'public/models/props/eastbrook_noticeboard.glb');
const CANDIDATE_ROOT = path.join(ROOT, 'tmp/asset_optimized/eastbrook_noticeboard/candidate');
const REPEAT_ROOT = path.join(ROOT, 'tmp/asset_optimized/eastbrook_noticeboard/repeat');
const CANDIDATE_OUT = path.join(CANDIDATE_ROOT, 'models/props/eastbrook_noticeboard.glb');
const REPEAT_OUT = path.join(REPEAT_ROOT, 'models/props/eastbrook_noticeboard.glb');
const EVIDENCE_ROOT = path.join(
  ROOT,
  'docs/screenshots/eastbrook-vale-rebuild/polish/assets/noticeboard',
);
const REFERENCE = path.join(
  ROOT,
  'docs/screenshots/eastbrook-vale-rebuild/polish/turnarounds/noticeboard.png',
);
const ATLAS = path.join(ROOT, 'public/textures/eastbrook_surface_atlas.webp');

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const stage = optionValue('--stage', 'final');
if (!NOTICEBOARD_STAGES.includes(stage)) {
  throw new Error(`unknown Eastbrook noticeboard stage: ${stage}`);
}
const rawOnly = process.argv.includes('--raw-only');
const previewOnly = process.argv.includes('--preview-only');
const noPreview = process.argv.includes('--no-preview');
const rawOut = path.join(RAW_ROOT, `eastbrook_noticeboard-${stage}.glb`);

const TURNAROUND_VIEWS = Object.freeze([
  'front',
  'right',
  'back',
  'left',
  'front-3q',
  'rear-3q',
  'grazing',
]);
const STAGE_VIEWS = Object.freeze({
  blockout: ['front', 'front-3q'],
  structural: ['back', 'rear-3q'],
  form: ['front-3q', 'grazing'],
  material: ['front-3q', 'neutral'],
  surface: ['front', 'grazing'],
  lighting: ['neutral', 'dusk'],
  interaction: ['player-scale', 'collider-overlay'],
  optimization: ['front-3q', 'rear-3q', 'grazing'],
  final: ['front-3q', 'rear-3q', 'neutral', 'dusk', 'player-scale', 'collider-overlay'],
});
const MATERIAL_NAMES = Object.freeze([
  'EastbrookNoticeboardHardware',
  'EastbrookNoticeboardSurface',
]);
const TRIANGLE_TARGET = 1_500;
const TRIANGLE_CEILING = 2_500;
const SHIPPING_BYTE_CEILING = 100 * 1024;

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
  const modelRoot = root.listNodes().find((node) => node.getName() === 'EastbrookNoticeboard');
  const sockets = NOTICEBOARD_SOCKET_DEFINITIONS.map((definition) => {
    const node = root.listNodes().find((candidate) => candidate.getName() === definition.nodeName);
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

function verifyFinalContract(stats, optimized, sourceFingerprint) {
  const expectedExtensions = optimized ? ['EXT_meshopt_compression', 'KHR_mesh_quantization'] : [];
  assertCondition(
    JSON.stringify(stats.usedExtensions) === JSON.stringify(expectedExtensions),
    `${stats.path} used extensions changed: ${stats.usedExtensions.join(', ')}`,
  );
  assertCondition(
    JSON.stringify(stats.requiredExtensions) === JSON.stringify(expectedExtensions),
    `${stats.path} required extensions changed: ${stats.requiredExtensions.join(', ')}`,
  );
  assertCondition(
    !stats.usedExtensions.includes('KHR_draco_mesh_compression'),
    'Draco is forbidden',
  );
  assertCondition(
    !stats.usedExtensions.includes('KHR_lights_punctual'),
    'GLB lights are forbidden',
  );
  assertCondition(stats.scenes === 1, `${stats.path} must contain one scene`);
  assertCondition(
    JSON.stringify(stats.sceneChildren) === JSON.stringify(['EastbrookNoticeboard']),
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
  assertCondition(stats.triangles <= TRIANGLE_TARGET, `${stats.path} exceeds triangle target`);
  assertCondition(stats.triangles <= TRIANGLE_CEILING, `${stats.path} exceeds triangle ceiling`);
  assertCondition(stats.materials.length === 2, `${stats.path} must contain two materials`);
  assertCondition(
    JSON.stringify(stats.materials.map((material) => material.name).sort()) ===
      JSON.stringify(MATERIAL_NAMES),
    `${stats.path} material names changed`,
  );
  assertCondition(
    stats.textures === 0 && stats.animations === 0 && stats.skins === 0 && stats.cameras === 0,
    `${stats.path} gained textures, animations, skins, or cameras`,
  );
  if (optimized) {
    assertCondition(stats.bytes <= SHIPPING_BYTE_CEILING, `${stats.path} exceeds byte ceiling`);
  }
  const tolerance = optimized ? 2e-3 : 1e-5;
  const { width, height, depth } = NOTICEBOARD_NATIVE_BOUNDS;
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
  assertCondition(runtime?.stage === 'final', `${stats.path} is not final`);
  assertCondition(
    JSON.stringify(runtime?.frontAxis) === JSON.stringify([0, 0, 1]),
    `${stats.path} public front changed`,
  );
  assertCondition(
    runtime?.collider?.shippingCollisionMesh === false,
    `${stats.path} gained shipping collision geometry`,
  );
  assertCondition(
    runtime?.interaction?.publicFacing === true,
    `${stats.path} lost interaction cue`,
  );
  for (const [index, definition] of NOTICEBOARD_SOCKET_DEFINITIONS.entries()) {
    const socket = stats.sockets[index];
    assertCondition(socket, `${stats.path} lost ${definition.nodeName}`);
    assertCondition(
      socket.children === 0 && socket.mesh === null,
      `${definition.nodeName} is not empty`,
    );
    assertApproxArray(
      socket.translation,
      definition.position,
      `${definition.nodeName} translation`,
      tolerance,
    );
    assertApproxArray(socket.rotation, [0, 0, 0, 1], `${definition.nodeName} rotation`, 1e-8);
    assertApproxArray(socket.scale, [1, 1, 1], `${definition.nodeName} scale`, 1e-8);
    assertCondition(
      socket.extras?.sculptSocket?.id === definition.id,
      `${definition.nodeName} metadata changed`,
    );
  }
  assertCondition(
    stats.fingerprints.document === sourceFingerprint &&
      stats.fingerprints.asset === sourceFingerprint,
    `${stats.path} source fingerprint changed or is missing`,
  );
}

function runOptimizer(outputRoot = null) {
  const args = [BUILD_ASSETS, SPEC];
  if (outputRoot) args.push('--output-root', outputRoot);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`noticeboard optimizer failed: ${result.status ?? 'unknown'}`);
  }
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
    const input = await sharp(files[index])
      .resize(cellWidth, cellHeight, { fit: 'cover' })
      .png()
      .toBuffer();
    const left = (index % columns) * cellWidth;
    const top = titleHeight + Math.floor(index / columns) * (cellHeight + 40);
    composites.push({ input, left, top });
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
  return outPath;
}

async function makeReferenceComparison(optimizedContact) {
  const panelWidth = 760;
  const panelHeight = 650;
  const reference = await sharp(REFERENCE)
    .resize(panelWidth, panelHeight, { fit: 'contain', background: '#d7d9dc' })
    .png()
    .toBuffer();
  const optimized = await sharp(optimizedContact)
    .resize(panelWidth, panelHeight, { fit: 'contain', background: '#d7d9dc' })
    .png()
    .toBuffer();
  const out = path.join(EVIDENCE_ROOT, 'reference-vs-optimized-contact.png');
  await sharp({
    create: {
      width: panelWidth * 2,
      height: panelHeight + 40,
      channels: 3,
      background: '#d7d9dc',
    },
  })
    .composite([
      { input: reference, left: 0, top: 40 },
      { input: optimized, left: panelWidth, top: 40 },
      {
        input: labelSvg('Original World of ClaudeCraft imagegen turnaround', panelWidth),
        left: 0,
        top: 0,
      },
      { input: labelSvg('Optimized GLB multi-angle render', panelWidth), left: panelWidth, top: 0 },
    ])
    .png()
    .toFile(out);
  return out;
}

function writeDataUrl(dataUrl, outPath) {
  const separator = dataUrl.indexOf(',');
  assertCondition(separator >= 0, 'serialized preview returned an invalid data URL');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(dataUrl.slice(separator + 1), 'base64'));
  return outPath;
}

async function updateStageContact() {
  const stageFiles = NOTICEBOARD_STAGES.map((name) =>
    path.join(EVIDENCE_ROOT, 'stages', name, `${STAGE_VIEWS[name][0]}.png`),
  );
  if (!stageFiles.every(existsSync)) return null;
  return makeContactSheet(
    stageFiles,
    NOTICEBOARD_STAGES,
    path.join(EVIDENCE_ROOT, 'stages-contact.png'),
    'img2threejs staged construction mapped to the deterministic repository factory',
  );
}

const sourceFingerprint = eastbrookNoticeboardSourceFingerprint(ROOT);
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

let exportedBase64 = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 720, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('PAGEERR', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('CONSOLE', message.text());
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 20_000 });
  const atlasDataUrl = `data:image/webp;base64,${readFileSync(ATLAS).toString('base64')}`;

  if (!previewOnly) {
    const result = await page.evaluate(
      (stageName) => window.exportEastbrookNoticeboard(stageName),
      stage,
    );
    exportedBase64 = result.b64;
    mkdirSync(path.dirname(rawOut), { recursive: true });
    writeFileSync(rawOut, Buffer.from(result.b64, 'base64'));
    console.log(`raw: ${path.relative(ROOT, rawOut)}`);
    console.log(`authoring stats: ${JSON.stringify(result.stats)}`);
  }

  if (!noPreview) {
    const stageFiles = [];
    for (const viewName of STAGE_VIEWS[stage]) {
      const stats = await page.evaluate(
        ({ stageName, view, atlas }) =>
          window.renderEastbrookNoticeboardPreview(stageName, view, atlas),
        { stageName: stage, view: viewName, atlas: atlasDataUrl },
      );
      const canvas = await page.$('canvas');
      if (!canvas) throw new Error('noticeboard preview canvas was not created');
      const out = path.join(EVIDENCE_ROOT, 'stages', stage, `${viewName}.png`);
      mkdirSync(path.dirname(out), { recursive: true });
      await canvas.screenshot({ path: out });
      stageFiles.push(out);
      console.log(`procedural preview: ${path.relative(ROOT, out)}`);
      console.log(`preview stats: ${JSON.stringify(stats)}`);
    }
    await makeContactSheet(
      stageFiles,
      STAGE_VIEWS[stage],
      path.join(EVIDENCE_ROOT, 'stages', stage, 'contact.png'),
      `${stage} noticeboard construction pass`,
    );
    await updateStageContact();

    if (stage === 'final' && exportedBase64) {
      const serializedSets = [['raw', exportedBase64]];
      if (existsSync(SHIPPING_OUT)) {
        serializedSets.push(['optimized', readFileSync(SHIPPING_OUT).toString('base64')]);
      }
      const contacts = new Map();
      for (const [kind, base64] of serializedSets) {
        const files = [];
        for (const viewName of TURNAROUND_VIEWS) {
          const stats = await page.evaluate(
            ({ data, view, atlas }) =>
              window.renderEastbrookNoticeboardSerializedPreview(data, view, atlas),
            { data: base64, view: viewName, atlas: atlasDataUrl },
          );
          const out = path.join(EVIDENCE_ROOT, kind, `${viewName}.png`);
          files.push(writeDataUrl(stats.dataUrl, out));
        }
        const contact = await makeContactSheet(
          files,
          TURNAROUND_VIEWS,
          path.join(EVIDENCE_ROOT, `${kind}-contact.png`),
          `${kind} Eastbrook noticeboard`,
        );
        contacts.set(kind, contact);
      }
      const optimizedBase64 = serializedSets.find(([kind]) => kind === 'optimized')?.[1];
      if (optimizedBase64) {
        const auditViews = [
          'neutral',
          'low',
          'grazing',
          'dusk',
          'player-scale',
          'collider-overlay',
        ];
        const files = [];
        for (const viewName of auditViews) {
          const stats = await page.evaluate(
            ({ data, view, atlas }) =>
              window.renderEastbrookNoticeboardSerializedPreview(data, view, atlas),
            { data: optimizedBase64, view: viewName, atlas: atlasDataUrl },
          );
          files.push(
            writeDataUrl(
              stats.dataUrl,
              path.join(EVIDENCE_ROOT, 'optimized-lookdev', `${viewName}.png`),
            ),
          );
        }
        await makeContactSheet(
          files,
          [
            'Standard neutral',
            'Lambert-compatible Low',
            'grazing',
            'dusk',
            '2.6-yard player scale',
            'collider and sockets',
          ],
          path.join(EVIDENCE_ROOT, 'optimized-lookdev-contact.png'),
          'Optimized GLB surface, scale, and interaction audit',
        );
        const optimizedContact = contacts.get('optimized');
        if (optimizedContact) {
          console.log(
            `comparison: ${path.relative(ROOT, await makeReferenceComparison(optimizedContact))}`,
          );
        }
      }
    }
  }
} finally {
  await browser.close();
}

if (!previewOnly) {
  await stampSourceFingerprint(rawOut, sourceFingerprint);
  const rawStats = await inspectGlb(rawOut);
  if (stage === 'final') verifyFinalContract(rawStats, false, sourceFingerprint);
  console.log(`raw validated: ${JSON.stringify(rawStats)}`);

  if (!rawOnly && stage === 'final') {
    runOptimizer(CANDIDATE_ROOT);
    runOptimizer(REPEAT_ROOT);
    assertCondition(
      readFileSync(CANDIDATE_OUT).equals(readFileSync(REPEAT_OUT)),
      'deterministic optimized noticeboard rebuild differs byte-for-byte',
    );
    const candidateStats = await inspectGlb(CANDIDATE_OUT);
    verifyFinalContract(candidateStats, true, sourceFingerprint);
    runOptimizer();
    assertCondition(
      readFileSync(CANDIDATE_OUT).equals(readFileSync(SHIPPING_OUT)),
      'shipping noticeboard differs from deterministic candidate',
    );
    const shippingStats = await inspectGlb(SHIPPING_OUT);
    verifyFinalContract(shippingStats, true, sourceFingerprint);
    console.log(`optimized validated: ${JSON.stringify(shippingStats)}`);
    console.log(`deterministic optimized rebuild: ${shippingStats.sha256}`);
  } else if (!rawOnly) {
    throw new Error('only the accepted final stage may run the optimizer');
  }
}

console.log(`source fingerprint: ${sourceFingerprint}`);
