// Deterministic rift course kit export, optimization, and contract check.
//
// Usage:
//   node scripts/assets/rift_course_kit/export_rift_course_kit.mjs
//   node scripts/assets/rift_course_kit/export_rift_course_kit.mjs --raw-only
//
// A procedural-original kit (no reference turnaround, no atlas), so there is
// no preview stage: the contract verification below plus the paired Vitest
// (tests/rift_course_kit_asset.test.ts) are the evidence.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as esbuild from 'esbuild';
import { MeshoptDecoder } from 'meshoptimizer';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';
import { RIFT_COURSE_KIT } from './model.js';
import { riftCourseKitSourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const RAW_DIR = path.join(ROOT, 'tmp/asset_src/rift_course_kit');
const SPEC = path.join(ROOT, 'scripts/assets/specs/rift_course_kit.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const rawOnly = process.argv.includes('--raw-only');

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function exportRawKit() {
  const bundle = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--use-angle=swiftshader', '--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction('window.__riftCourseKitReady === true', { timeout: 30000 });
    const results = await page.evaluate(() => window.__exportRiftCourseKit());
    assertCondition(errors.length === 0, `page errors during export: ${errors.join('; ')}`);
    mkdirSync(RAW_DIR, { recursive: true });
    for (const item of results) {
      const raw = Buffer.from(item.base64, 'base64');
      writeFileSync(path.join(RAW_DIR, `${item.key}-final.glb`), raw);
    }
    return results.map((item) => item.key);
  } finally {
    await browser.close();
  }
}

async function stampFingerprint(keys) {
  const fingerprint = riftCourseKitSourceFingerprint();
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const key of keys) {
    const file = path.join(RAW_DIR, `${key}-final.glb`);
    const document = await io.read(file);
    const root = document.getRoot();
    root.getAsset().extras = {
      ...(root.getAsset().extras ?? {}),
      sourceFingerprint: fingerprint,
      sourceFingerprintAlgorithm: 'sha256-length-delimited-v1',
      assetKey: key,
    };
    writeFileSync(file, await io.writeBinary(document));
  }
  return fingerprint;
}

function optimize() {
  const run = spawnSync(process.execPath, [BUILD_ASSETS, SPEC], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  assertCondition(run.status === 0, 'build_assets.mjs failed');
}

async function verify(fingerprint) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
  });
  for (const [key, contract] of Object.entries(RIFT_COURSE_KIT)) {
    const shipped = path.join(ROOT, 'public/models/props', contract.outputName);
    const bytes = statSync(shipped).size;
    assertCondition(
      bytes <= contract.byteCeiling,
      `${key}: ${bytes} bytes exceeds ceiling ${contract.byteCeiling}`,
    );
    const document = await io.read(shipped);
    const root = document.getRoot();
    const extras = root.getAsset().extras ?? {};
    assertCondition(
      extras.sourceFingerprint === fingerprint,
      `${key}: shipped fingerprint drifted from live sources`,
    );
    assertCondition(root.listTextures().length === 0, `${key}: unexpected texture`);
    assertCondition(root.listAnimations().length === 0, `${key}: unexpected animation`);
    assertCondition(root.listSkins().length === 0, `${key}: unexpected skin`);
    const materials = root.listMaterials();
    assertCondition(
      materials.length >= 1 && materials.length <= 2,
      `${key}: ${materials.length} materials (budget 2)`,
    );
    let triangles = 0;
    let colorAttr = false;
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        const position = prim.getAttribute('POSITION');
        triangles += Math.floor((indices ? indices.getCount() : position.getCount()) / 3);
        if (prim.getAttribute('COLOR_0')) colorAttr = true;
      }
    }
    assertCondition(colorAttr, `${key}: COLOR_0 missing`);
    assertCondition(
      triangles <= contract.triangleCeiling,
      `${key}: ${triangles} triangles exceeds ceiling ${contract.triangleCeiling}`,
    );
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    const bounds = getBounds(scene);
    const dims = contract.dimensions;
    const tolerance = 0.05;
    assertCondition(
      Math.abs(bounds.max[1] - dims.height) <= dims.height * tolerance + 0.02 &&
        Math.abs(bounds.min[1]) <= 0.02,
      `${key}: not floor-seated to its contract height`,
    );
    assertCondition(
      Math.abs(bounds.max[0] + bounds.min[0]) <= 0.05 &&
        Math.abs(bounds.max[2] + bounds.min[2]) <= 0.05,
      `${key}: not centred on X/Z`,
    );
    console.log(
      `ok ${contract.outputName}: ${triangles} tris, ${materials.length} mats, ${(bytes / 1024).toFixed(1)} KB`,
    );
  }
}

const keys = await exportRawKit();
const fingerprint = await stampFingerprint(keys);
console.log(`source fingerprint ${fingerprint}`);
if (!rawOnly) {
  optimize();
  await verify(fingerprint);
}
