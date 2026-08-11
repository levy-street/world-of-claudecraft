// Deterministic export, optimization, and visual evidence for the three
// Masterwrought phase 06 inscription tome held models.
//
// Usage:
//   node scripts/assets/inscription_tomes/export_inscription_tomes.mjs
//   node scripts/assets/inscription_tomes/export_inscription_tomes.mjs --no-preview
//   node scripts/assets/inscription_tomes/export_inscription_tomes.mjs --raw-only
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
import {
  INSCRIPTION_TOME_KEYS,
  INSCRIPTION_TOME_LIMITS,
  INSCRIPTION_TOME_VARIANTS,
} from './model.js';
import { inscriptionTomesSourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const SPEC = path.join(ROOT, 'scripts/assets/specs/inscription_tomes.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const CANDIDATE_ROOT = path.join(ROOT, 'tmp/asset_optimized/inscription_tomes/deterministic');
const EVIDENCE_ROOT = path.join(ROOT, 'docs/screenshots/masterwrought-phase06-tomes');
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
const STAGES = Object.freeze(['blockout', 'structural', 'final']);

function rawOutFor(key) {
  return path.join(ROOT, `tmp/asset_src/inscription_tomes/${key}-final.glb`);
}
function shippingOutFor(key) {
  return path.join(ROOT, `public/models/weapons/${key}.glb`);
}
function candidateOutFor(key) {
  return path.join(CANDIDATE_ROOT, `models/weapons/${key}.glb`);
}
function referenceFor(key) {
  return path.join(
    ROOT,
    `docs/achievements/masterwrought-phase06-art/${INSCRIPTION_TOME_VARIANTS[key].itemId}.svg`,
  );
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function createNodeIo() {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
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
    materials: root
      .listMaterials()
      .map((material) => material.getName())
      .sort(),
    textures: root.listTextures().length,
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
    cameras: root.listCameras().length,
    bounds: getBounds(scene),
    rootNode: root.listNodes().find((node) => node.getExtras()?.sculptRuntime) ?? null,
    rootExtras:
      root
        .listNodes()
        .find((node) => node.getExtras()?.sculptRuntime)
        ?.getExtras() ?? null,
    fingerprints: {
      document: root.getExtras()?.sourceFingerprint,
      asset: root.getAsset().extras?.sourceFingerprint,
    },
  };
}

function verifyContract(key, stats, optimized, sourceFingerprint) {
  const variant = INSCRIPTION_TOME_VARIANTS[key];
  const expected = optimized ? ['EXT_meshopt_compression', 'KHR_mesh_quantization'] : [];
  assertCondition(
    JSON.stringify(stats.usedExtensions) === JSON.stringify(expected),
    `${stats.path} used extensions changed: ${stats.usedExtensions.join(', ')}`,
  );
  assertCondition(
    JSON.stringify(stats.requiredExtensions) === JSON.stringify(expected),
    `${stats.path} required extensions changed: ${stats.requiredExtensions.join(', ')}`,
  );
  assertCondition(stats.scenes === 1, `${stats.path} must contain one scene`);
  assertCondition(
    JSON.stringify(stats.sceneChildren) === JSON.stringify([variant.rootName]),
    `${stats.path} scene root changed: ${stats.sceneChildren.join(', ')}`,
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
    JSON.stringify(stats.materials) === JSON.stringify(['TomeMetal', 'TomeOpaque']),
    `${stats.path} material names changed: ${stats.materials.join(', ')}`,
  );
  assertCondition(
    stats.triangles <= INSCRIPTION_TOME_LIMITS.triangleTarget,
    `${stats.path} exceeds ${INSCRIPTION_TOME_LIMITS.triangleTarget} target triangles (${stats.triangles})`,
  );
  assertCondition(
    stats.textures === 0 && stats.animations === 0 && stats.skins === 0 && stats.cameras === 0,
    `${stats.path} gained textures, animations, skins, or cameras`,
  );
  if (optimized) {
    assertCondition(
      stats.bytes <= INSCRIPTION_TOME_LIMITS.byteCeiling,
      `${stats.path} exceeds ${INSCRIPTION_TOME_LIMITS.byteCeiling} bytes (${stats.bytes})`,
    );
  }
  // Held-item envelope: grip origin near the bottom edge, the book standing
  // along +Y, hand-scale extents. Exact bounds are pinned in the vitest.
  const { min, max } = stats.bounds;
  assertCondition(min[1] > -0.25 && min[1] < 0, `${stats.path} grip origin drifted (${min[1]})`);
  assertCondition(max[1] < 0.45, `${stats.path} too tall for a held tome (${max[1]})`);
  assertCondition(
    Math.abs(min[0]) < 0.25 &&
      Math.abs(max[0]) < 0.25 &&
      Math.abs(min[2]) < 0.15 &&
      Math.abs(max[2]) < 0.15,
    `${stats.path} exceeds the hand-scale envelope`,
  );
  const runtime = stats.rootExtras?.sculptRuntime;
  assertCondition(runtime?.assetId === variant.id, `${stats.path} asset id changed`);
  assertCondition(runtime?.itemId === variant.itemId, `${stats.path} item id changed`);
  assertCondition(runtime?.stage === 'final', `${stats.path} is not the final stage`);
  assertCondition(runtime?.coordinateFrame?.front === '+Z', `${stats.path} front axis changed`);
  assertCondition(runtime?.coordinateFrame?.origin === 'grip', `${stats.path} origin cue changed`);
  assertCondition(
    runtime?.interaction?.interactive === false &&
      runtime?.interaction?.authority === 'held-item-attachment',
    `${stats.path} interaction contract changed`,
  );
  assertCondition(
    runtime?.collider?.shippingCollisionMesh === false,
    `${stats.path} added collision geometry`,
  );
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
  if (result.status !== 0) throw new Error(`tome optimizer failed: ${result.status ?? 'unknown'}`);
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

async function makeReferenceComparison(key, optimizedContact) {
  const panelWidth = 760;
  const panelHeight = 650;
  const left = await sharp(referenceFor(key), { density: 300 })
    .resize(panelWidth, panelHeight, { fit: 'contain', background: '#d7d9dc' })
    .png()
    .toBuffer();
  const right = await sharp(optimizedContact)
    .resize(panelWidth, panelHeight, { fit: 'contain', background: '#d7d9dc' })
    .png()
    .toBuffer();
  const out = path.join(EVIDENCE_ROOT, key, 'reference-vs-optimized-contact.png');
  await sharp({
    create: { width: panelWidth * 2, height: panelHeight + 40, channels: 3, background: '#d7d9dc' },
  })
    .composite([
      { input: left, left: 0, top: 40 },
      { input: right, left: panelWidth, top: 40 },
      { input: labelSvg('Committed item-icon SVG reference', panelWidth), left: 0, top: 0 },
      { input: labelSvg('Optimized GLB multi-angle render', panelWidth), left: panelWidth, top: 0 },
    ])
    .png()
    .toFile(out);
  return out;
}

const sourceFingerprint = inscriptionTomesSourceFingerprint(ROOT);
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
  await page.waitForFunction('window.__inscriptionTomesReady !== undefined', { timeout: 20_000 });

  for (const key of INSCRIPTION_TOME_KEYS) {
    const result = await page.evaluate(
      (variantKey) => window.exportInscriptionTome(variantKey),
      key,
    );
    const rawOut = rawOutFor(key);
    mkdirSync(path.dirname(rawOut), { recursive: true });
    writeFileSync(rawOut, Buffer.from(result.b64, 'base64'));
    await stampSourceFingerprint(rawOut, sourceFingerprint);
    const rawStats = await inspectGlb(rawOut);
    verifyContract(key, rawStats, false, sourceFingerprint);
    console.log(`raw ${key}: ${rawStats.triangles} tris, ${rawStats.bytes} bytes`);
  }

  if (!rawOnly) {
    runOptimizer(null);
    runOptimizer(CANDIDATE_ROOT);
    for (const key of INSCRIPTION_TOME_KEYS) {
      const shippingStats = await inspectGlb(shippingOutFor(key));
      verifyContract(key, shippingStats, true, sourceFingerprint);
      const candidateStats = await inspectGlb(candidateOutFor(key));
      verifyContract(key, candidateStats, true, sourceFingerprint);
      assertCondition(
        readFileSync(candidateOutFor(key)).equals(readFileSync(shippingOutFor(key))),
        `deterministic optimized rebuild differs for ${key}`,
      );
      console.log(
        `optimized ${key}: ${shippingStats.triangles} tris, ${shippingStats.bytes} bytes, sha256 ${shippingStats.sha256}, bounds ${JSON.stringify(shippingStats.bounds)}`,
      );
    }
  }

  if (!noPreview) {
    const capture = async ({ kind, variantKey, b64 = null, viewName, stage = 'final', out }) => {
      await page.evaluate((options) => window.renderInscriptionTomePreview(options), {
        kind,
        variantKey,
        b64,
        viewName,
        stage,
      });
      const canvas = await page.$('canvas');
      if (!canvas) throw new Error('tome preview canvas was not created');
      mkdirSync(path.dirname(out), { recursive: true });
      await canvas.screenshot({ path: out });
      return out;
    };

    for (const key of INSCRIPTION_TOME_KEYS) {
      const evidence = path.join(EVIDENCE_ROOT, key);
      const stageFiles = [];
      for (const stage of STAGES) {
        stageFiles.push(
          await capture({
            kind: 'procedural',
            variantKey: key,
            stage,
            viewName: 'front-3q',
            out: path.join(evidence, 'stages', `${stage}.png`),
          }),
        );
      }
      await makeContactSheet(
        stageFiles,
        [...STAGES],
        path.join(evidence, 'stages-contact.png'),
        `${key} staged construction`,
      );

      const optimizedBase64 = rawOnly ? null : readFileSync(shippingOutFor(key)).toString('base64');
      const files = [];
      for (const viewName of TURNAROUND_VIEWS) {
        files.push(
          await capture({
            kind: optimizedBase64 ? 'serialized' : 'procedural',
            variantKey: key,
            b64: optimizedBase64,
            viewName,
            out: path.join(evidence, 'optimized', `${viewName}.png`),
          }),
        );
      }
      const contact = path.join(evidence, 'optimized-contact.png');
      await makeContactSheet(files, TURNAROUND_VIEWS, contact, `${key} optimized GLB`);
      if (optimizedBase64) {
        console.log(
          `comparison: ${path.relative(ROOT, await makeReferenceComparison(key, contact))}`,
        );
      }
    }
  }
} finally {
  await browser.close();
}

console.log(`source fingerprint: ${sourceFingerprint}`);
