// Stage export and multi-angle preview for the Goblin Rocket Sled.
// Shipping optimization and KTX2 compression are intentionally added only
// after the material pass; early shape reviews use this raw deterministic GLB.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, TextureInfo } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRTextureTransform } from '@gltf-transform/extensions';
import * as esbuild from 'esbuild';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import puppeteer from 'puppeteer-core';
import { closePreview, renderPreviews } from '../../asset_pipeline/lib/preview.mjs';
import { BROWSER_PATH } from '../../browser_path.mjs';
import { SLED_MATERIAL_CONTRACT, SLED_STAGES } from './model.js';
import { buildSledSurfaceMaps, NORMAL_SCALE } from './surface_maps.mjs';
import { ORM_CENTER } from '../terrorspark_groundshaker/surface_shading.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const stageIndex = process.argv.indexOf('--stage');
const stage = stageIndex >= 0 ? process.argv[stageIndex + 1] : 'blockout';
if (!SLED_STAGES.includes(stage)) throw new Error(`unknown sled stage: ${stage}`);
const noTurntable = process.argv.includes('--no-turntable');

const rawOut = path.join(ROOT, 'tmp/asset_src/goblin_rocket_sled', `goblin_rocket_sled-${stage}.glb`);
const previewDir = path.join(ROOT, 'docs/screenshots/goblin-rocket-sled/authoring', stage);

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

function normalizeTexcoords(document) {
  const accessors = new Set();
  let extent = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const uv = primitive.getAttribute('TEXCOORD_0');
      if (!uv || accessors.has(uv)) continue;
      accessors.add(uv);
      const min = uv.getMin([]);
      const max = uv.getMax([]);
      assertCondition(Math.min(...min) >= 0, `TEXCOORD_0 must be non-negative: ${min}`);
      extent = Math.max(extent, ...max);
    }
  }
  const range = Math.max(1, Math.ceil(extent));
  for (const uv of accessors) {
    const values = uv.getArray();
    for (let index = 0; index < values.length; index++) values[index] /= range;
    uv.setArray(values);
  }
  return range;
}

async function attachSurfaceMaps(glbPath) {
  const maps = await buildSledSurfaceMaps();
  const io = await createNodeIo();
  const document = await io.read(glbPath);
  const root = document.getRoot();
  document.createExtension(EXTTextureWebP).setRequired(true);
  const uvRange = normalizeTexcoords(document);
  const transform = document
    .createExtension(KHRTextureTransform)
    .setRequired(true)
    .createTransform()
    .setScale([uvRange, uvRange]);
  const textures = new Map();
  const textureFor = (family, channel) => {
    const key = `${family}_${channel}`;
    if (textures.has(key)) return textures.get(key);
    const texture = document
      .createTexture(`sled_${key}`)
      .setMimeType('image/webp')
      .setImage(maps[family][channel]);
    textures.set(key, texture);
    return texture;
  };
  const materialByName = new Map(root.listMaterials().map((entry) => [entry.getName(), entry]));
  for (const contract of SLED_MATERIAL_CONTRACT.filter((entry) => entry.surface)) {
    const materialDef = materialByName.get(contract.name);
    assertCondition(materialDef, `missing exported material ${contract.name}`);
    const orm = textureFor(contract.surface, 'orm');
    materialDef.setBaseColorTexture(textureFor(contract.surface, 'albedo'));
    materialDef.setNormalTexture(textureFor(contract.surface, 'normal'));
    materialDef.setNormalScale(NORMAL_SCALE);
    materialDef.setMetallicRoughnessTexture(orm);
    materialDef.setOcclusionTexture(orm);
    materialDef.setRoughnessFactor(Math.min(1, contract.roughness / ORM_CENTER));
    materialDef.setMetallicFactor(
      contract.metalness === 0 ? 0 : Math.min(1, contract.metalness / ORM_CENTER),
    );
    for (const info of [
      materialDef.getBaseColorTextureInfo(),
      materialDef.getNormalTextureInfo(),
      materialDef.getMetallicRoughnessTextureInfo(),
      materialDef.getOcclusionTextureInfo(),
    ]) {
      info.setWrapS(TextureInfo.WrapMode.REPEAT);
      info.setWrapT(TextureInfo.WrapMode.REPEAT);
      info.setExtension('KHR_texture_transform', transform);
    }
  }
  await io.write(glbPath, document);
  return { ...maps, uvRange };
}
const { outputFiles } = await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
});
const html = `<!doctype html><html><body><script>${outputFiles[0].text}</script></body></html>`;
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-webgl'],
});

let stats;
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('PAGEERR', error.message));
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 20_000 });
  const result = await page.evaluate((selectedStage) => window.exportGoblinRocketSled(selectedStage), stage);
  mkdirSync(path.dirname(rawOut), { recursive: true });
  writeFileSync(rawOut, Buffer.from(result.b64, 'base64'));
  stats = result.stats;
  const topDataUrl = await page.evaluate(
    (selectedStage) => window.renderGoblinRocketSledTop(selectedStage),
    stage,
  );
  mkdirSync(previewDir, { recursive: true });
  writeFileSync(path.join(previewDir, 'top.png'), Buffer.from(topDataUrl.split(',')[1], 'base64'));
} finally {
  await browser.close();
}

console.log(`raw: ${path.relative(ROOT, rawOut)}`);
console.log(`authoring stats: ${JSON.stringify(stats)}`);
if (SLED_STAGES.indexOf(stage) >= SLED_STAGES.indexOf('material')) {
  const maps = await attachSurfaceMaps(rawOut);
  const materialDir = path.join(ROOT, 'docs/screenshots/goblin-rocket-sled/authoring/material');
  mkdirSync(materialDir, { recursive: true });
  const sheet = path.join(materialDir, 'surface-maps.png');
  writeFileSync(sheet, maps.preview);
  console.log(`surface maps: 9 x ${maps.size}, uv range ${maps.uvRange}`);
  console.log(`preview: ${path.relative(ROOT, sheet)}`);
}
console.log(`preview: ${path.relative(ROOT, path.join(previewDir, 'top.png'))}`);
if (!noTurntable) {
  try {
    const files = await renderPreviews(rawOut, previewDir, {
      size: 720,
      views: ['front', 'right', 'back', 'hero'],
      clips: false,
    });
    for (const file of files) console.log(`preview: ${path.relative(ROOT, file)}`);
  } finally {
    await closePreview();
  }
}
