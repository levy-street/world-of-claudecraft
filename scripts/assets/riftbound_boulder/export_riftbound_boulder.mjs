/**
 * Export the Riftbound Boulder mount GLB.
 *
 *   node scripts/assets/riftbound_boulder/export_riftbound_boulder.mjs
 *   node scripts/assets/riftbound_boulder/export_riftbound_boulder.mjs --raw-only
 *   node scripts/assets/riftbound_boulder/export_riftbound_boulder.mjs --no-preview
 *
 * Bundles the browser entry with esbuild, runs it in a headless page so three's
 * GLTFExporter can serialize the factory's scene, stamps the source
 * fingerprint, verifies the geometry contract, and then hands the raw GLB to
 * build_assets.mjs for the shipping optimization pass.
 *
 * The contract this enforces is not cosmetic. The renderer rolls this mount by
 * rotating its visual root, and that only spins the stone in place while the
 * root's origin IS the stone's centre. manifest.ts reaches that with
 * `height: 1.6` + `hover: -0.8`, which are correct only while the authored
 * bounds are exactly 2.0 tall and centred on the origin. verifyContract checks
 * both, so a factory edit that broke the centring could never ship quietly.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as esbuild from 'esbuild';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import puppeteer from 'puppeteer-core';
import { closePreview, renderPreviews } from '../../asset_pipeline/lib/preview.mjs';
import { BROWSER_PATH } from '../../browser_path.mjs';
import { boulderSourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const SPEC = path.join(ROOT, 'scripts/assets/specs/riftbound_boulder.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const RAW_OUT = path.join(ROOT, 'tmp/asset_src/riftbound_boulder/riftbound_boulder-final.glb');
const SHIPPING_OUT = path.join(ROOT, 'public/models/mounts/riftbound_boulder.glb');
// Turnarounds land in scratch, NOT under docs/screenshots. The CI test-job
// sparse checkout excludes committed screenshot subtrees except the ones a
// tracked file references (tests/ci_workflow.test.ts pins that set equality),
// so writing previews into the evidence directory would make every CI shard
// fetch review images no test reads. Same place the asset pipeline puts its
// own previews; committed PR evidence is copied in by hand.
const PREVIEW_ROOT = path.join(ROOT, 'tmp/riftbound_boulder/preview');

const rawOnly = process.argv.includes('--raw-only');
const noPreview = process.argv.includes('--no-preview');
const sourceFingerprint = boulderSourceFingerprint(ROOT);

/** An untextured, unrigged stone has no excuse to be large. */
const SHIPPING_BYTE_CEILING = 96 * 1024;
/** The byte gate cannot police geometry on its own: the stone ships at 28 KB
 *  against that 96 KiB ceiling, so the triangle count could roughly triple
 *  before bytes complained. Gate the count directly. */
const TRIANGLE_CEILING = 1200;
/** Authored extent: exactly 2.0 tall, centred on the origin (see the header). */
const EXTENT_TOLERANCE = 1e-3;
const CENTER_TOLERANCE = 1e-3;

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

async function inspectGlb(glbPath) {
  const io = await createNodeIo();
  const document = await io.read(glbPath);
  const root = document.getRoot();
  const bounds = getBounds(root.listScenes()[0]);
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : primitive.getAttribute('POSITION').getCount();
      triangles += count / 3;
    }
  }
  return {
    path: path.relative(ROOT, glbPath),
    bytes: statSync(glbPath).size,
    triangles,
    meshes: root.listMeshes().length,
    materials: root
      .listMaterials()
      .map((material) => material.getName())
      .sort(),
    textures: root.listTextures().length,
    animations: root.listAnimations().map((clip) => clip.getName()),
    bounds: { min: bounds.min, max: bounds.max },
  };
}

function verifyContract(stats, optimized) {
  const height = stats.bounds.max[1] - stats.bounds.min[1];
  assertCondition(
    Math.abs(height - 2) <= EXTENT_TOLERANCE,
    `authored height must be 2.0, got ${height}`,
  );
  for (const axis of [0, 1, 2]) {
    const center = (stats.bounds.max[axis] + stats.bounds.min[axis]) / 2;
    assertCondition(
      Math.abs(center) <= CENTER_TOLERANCE,
      `bounds must be origin-centred on axis ${axis}, got ${center}`,
    );
  }
  assertCondition(stats.meshes >= 1, 'expected at least the stone mesh');
  assertCondition(
    stats.triangles < TRIANGLE_CEILING,
    `triangle budget: ${stats.triangles} exceeds ${TRIANGLE_CEILING}`,
  );
  assertCondition(
    stats.materials.includes('riftbound_stone') && stats.materials.includes('riftbound_vein'),
    `expected the stone and vein materials, got ${stats.materials.join(', ')}`,
  );
  // Deliberately texture-free: vertex colors only, which is also why this model
  // needs no KTX2 pass (tests/glb_texture_compression.test.ts has nothing to
  // check here) and why it ships at a fraction of the other mounts' size.
  assertCondition(stats.textures === 0, `expected no textures, got ${stats.textures}`);
  assertCondition(
    stats.animations.length === 0,
    `expected a clipless mount, got ${stats.animations.join(', ')}`,
  );
  if (optimized) {
    assertCondition(
      stats.bytes <= SHIPPING_BYTE_CEILING,
      `${stats.path} exceeds ${SHIPPING_BYTE_CEILING / 1024} KiB (${stats.bytes} bytes)`,
    );
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
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('CONSOLE', message.text());
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 20_000 });
  const result = await page.evaluate(
    (fingerprint) => window.exportRiftboundBoulder(fingerprint),
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

if (!noPreview) {
  const files = await renderPreviews(RAW_OUT, path.join(PREVIEW_ROOT, 'final'), {
    size: 640,
    views: ['front', 'right', 'back', 'hero'],
  });
  for (const file of files) console.log(`preview: ${path.relative(ROOT, file)}`);
  await closePreview();
}

if (!rawOnly) {
  const pipeline = spawnSync(process.execPath, [BUILD_ASSETS, SPEC], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (pipeline.status !== 0) process.exit(pipeline.status ?? 1);
  await stampSourceFingerprint(SHIPPING_OUT);
  const shippingStats = await inspectGlb(SHIPPING_OUT);
  verifyContract(shippingStats, true);
  console.log(`shipping contract: ${JSON.stringify(shippingStats)}`);
}

console.log(`source fingerprint: ${sourceFingerprint}`);
