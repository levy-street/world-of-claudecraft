// Deterministic procedural Ignivar export, optimization, validation, and preview.
//
// Usage:
//   node scripts/assets/ignivar_herald/export_ignivar_herald.mjs
//   node scripts/assets/ignivar_herald/export_ignivar_herald.mjs --no-preview
//   node scripts/assets/ignivar_herald/export_ignivar_herald.mjs --raw-only
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import * as esbuild from 'esbuild';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import puppeteer from 'puppeteer-core';
import { closePreview, renderPreviews } from '../../asset_pipeline/lib/preview.mjs';
import { BROWSER_PATH } from '../../browser_path.mjs';
import {
  IGNIVAR_CLIP_NAMES,
  IGNIVAR_MATERIAL_CONTRACT,
  IGNIVAR_SOCKET_DEFINITIONS,
} from './model.js';
import { ignivarSourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const RAW_OUT = path.join(ROOT, 'tmp/asset_src/ignivar_herald/ignivar_herald.glb');
const SHIPPING_OUT = path.join(ROOT, 'public/models/creatures/ignivar_herald.glb');
const PREVIEW_DIR = path.join(ROOT, 'docs/screenshots/ignivar-raid/boss-model-candidate-v2');
const sourceFingerprint = ignivarSourceFingerprint(ROOT);
const noPreview = process.argv.includes('--no-preview');
const rawOnly = process.argv.includes('--raw-only');

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function createNodeIo() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
}

async function stampSourceFingerprint(glbPath) {
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

async function optimizeTexturelessCharacter(sourcePath, outputPath) {
  const io = await createNodeIo();
  const document = await io.read(sourcePath);
  await document.transform(
    resample(),
    prune({ keepExtras: true }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  mkdirSync(path.dirname(outputPath), { recursive: true });
  await io.write(outputPath, document);
}

async function inspectGlb(glbPath) {
  const io = await createNodeIo();
  const document = await io.read(glbPath);
  const root = document.getRoot();
  const scene = root.listScenes()[0];
  if (!scene) throw new Error(`${glbPath} has no scene`);
  const nodes = root.listNodes();
  const meshes = root.listMeshes().map((mesh) => ({
    name: mesh.getName(),
    primitives: mesh.listPrimitives().map((primitive) => {
      const position = primitive.getAttribute('POSITION');
      if (!position) throw new Error(`${mesh.getName()} has no POSITION`);
      return {
        material: primitive.getMaterial()?.getName() ?? null,
        triangles: (primitive.getIndices()?.getCount() ?? position.getCount()) / 3,
      };
    }),
  }));
  return {
    path: path.relative(ROOT, glbPath),
    bytes: statSync(glbPath).size,
    sha256: createHash('sha256').update(readFileSync(glbPath)).digest('hex'),
    scenes: root.listScenes().length,
    sceneChildren: scene.listChildren().map((node) => node.getName()),
    nodes: nodes.length,
    meshes: meshes.length,
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
    animations: root.listAnimations().map((animation) => ({
      name: animation.getName(),
      channels: animation.listChannels().length,
    })),
    skins: root.listSkins().length,
    cameras: root.listCameras().length,
    bounds: getBounds(scene),
    sockets: IGNIVAR_SOCKET_DEFINITIONS.map((definition) => {
      const node = nodes.find((candidate) => candidate.getName() === definition.name);
      return node ? { name: node.getName(), extras: node.getExtras() } : null;
    }),
    animatedNodes: [
      'ForgeBodyPivot',
      'ForgeArmPivot',
      'MagmaArmPivot',
      'LeftLegPivot',
      'RightLegPivot',
      'FurnaceCorePulse',
    ].map((name) => nodes.some((node) => node.getName() === name)),
    extensions: root
      .listExtensionsUsed()
      .map((extension) => extension.extensionName)
      .sort(),
    fingerprints: {
      document: root.getExtras()?.sourceFingerprint,
      asset: root.getAsset().extras?.sourceFingerprint,
    },
  };
}

function verifyContract(stats, optimized) {
  assertCondition(stats.scenes === 1, `${stats.path} must contain one scene`);
  assertCondition(
    JSON.stringify(stats.sceneChildren) === JSON.stringify(['IgnivarHerald']),
    `${stats.path} scene root must be IgnivarHerald`,
  );
  assertCondition(stats.textures === 0, `${stats.path} must contain zero textures`);
  assertCondition(stats.skins === 0, `${stats.path} must contain zero skins`);
  assertCondition(stats.cameras === 0, `${stats.path} must contain zero cameras`);
  assertCondition(stats.triangles <= 32_000, `${stats.path} exceeds 32,000 triangles`);
  const primitiveBudget = optimized ? 32 : 36;
  assertCondition(
    stats.primitives <= primitiveBudget,
    `${stats.path} exceeds ${primitiveBudget} primitives`,
  );
  assertCondition(
    JSON.stringify(stats.materials) ===
      JSON.stringify(IGNIVAR_MATERIAL_CONTRACT.map((material) => material.name).sort()),
    `${stats.path} material contract changed: ${stats.materials.join(', ')}`,
  );
  assertCondition(
    JSON.stringify(stats.animations.map((animation) => animation.name)) ===
      JSON.stringify(IGNIVAR_CLIP_NAMES),
    `${stats.path} animation contract changed`,
  );
  assertCondition(
    stats.animations.every((animation) => animation.channels > 0),
    `${stats.path} clips must have live channels`,
  );
  assertCondition(
    stats.sockets.every((socket) => socket?.extras?.socketType === 'vfx-emitter'),
    `${stats.path} must preserve all VFX sockets`,
  );
  assertCondition(
    stats.animatedNodes.every(Boolean),
    `${stats.path} must preserve all animated pivots`,
  );
  assertCondition(Math.abs(stats.bounds.min[1]) <= 0.001, `${stats.path} must sit on y=0`);
  assertCondition(
    stats.bounds.max[1] >= 6.0 && stats.bounds.max[1] <= 6.5,
    `${stats.path} native height left its contract: ${stats.bounds.max[1]}`,
  );
  assertCondition(
    stats.fingerprints.document === sourceFingerprint &&
      stats.fingerprints.asset === sourceFingerprint,
    `${stats.path} source fingerprint is missing or stale`,
  );
  const required = optimized
    ? ['EXT_meshopt_compression', 'KHR_materials_emissive_strength', 'KHR_mesh_quantization']
    : ['KHR_materials_emissive_strength'];
  assertCondition(
    JSON.stringify(stats.extensions) === JSON.stringify(required),
    `${stats.path} extensions changed: ${stats.extensions.join(', ')}`,
  );
  if (optimized) {
    assertCondition(stats.bytes <= 700 * 1024, `${stats.path} exceeds 700 KiB`);
  }
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

let authoringStats;
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('PAGEERR', error.message));
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 20_000 });
  const result = await page.evaluate(
    (fingerprint) => window.exportIgnivarHerald(fingerprint),
    sourceFingerprint,
  );
  mkdirSync(path.dirname(RAW_OUT), { recursive: true });
  writeFileSync(RAW_OUT, Buffer.from(result.b64, 'base64'));
  authoringStats = result.stats;
} finally {
  await browser.close();
}

await stampSourceFingerprint(RAW_OUT);
const rawStats = await inspectGlb(RAW_OUT);
verifyContract(rawStats, false);
console.log(`raw: ${path.relative(ROOT, RAW_OUT)}`);
console.log(`authoring stats: ${JSON.stringify(authoringStats)}`);
console.log(`raw contract: ${JSON.stringify(rawStats)}`);

if (!rawOnly) {
  // This is the exact textureless character subset of build_assets.mjs. Keeping
  // it local avoids loading sharp, which is unnecessary for a zero-texture GLB.
  await optimizeTexturelessCharacter(RAW_OUT, SHIPPING_OUT);
  await stampSourceFingerprint(SHIPPING_OUT);
  const shippingStats = await inspectGlb(SHIPPING_OUT);
  verifyContract(shippingStats, true);
  console.log(`shipping contract: ${JSON.stringify(shippingStats)}`);
}

if (!noPreview) {
  const previewModel = rawOnly ? RAW_OUT : SHIPPING_OUT;
  const files = await renderPreviews(previewModel, PREVIEW_DIR, {
    size: 640,
    views: ['front', 'right', 'back', 'hero'],
    clips: true,
  });
  for (const file of files) console.log(`preview: ${path.relative(ROOT, file)}`);
  await closePreview();
}

console.log(`source fingerprint: ${sourceFingerprint}`);
