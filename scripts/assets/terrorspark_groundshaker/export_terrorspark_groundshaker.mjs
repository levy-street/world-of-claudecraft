// Deterministic procedural Tank mount export, optimization, validation, and preview.
//
// Usage:
//   node scripts/assets/terrorspark_groundshaker/export_terrorspark_groundshaker.mjs --stage blockout --raw-only
//   node scripts/assets/terrorspark_groundshaker/export_terrorspark_groundshaker.mjs --stage final
//   node scripts/assets/terrorspark_groundshaker/export_terrorspark_groundshaker.mjs --stage final --no-preview
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO, TextureInfo } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRTextureTransform } from '@gltf-transform/extensions';
import * as esbuild from 'esbuild';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import puppeteer from 'puppeteer-core';
import { closePreview, renderPreviews } from '../../asset_pipeline/lib/preview.mjs';
import { BROWSER_PATH } from '../../browser_path.mjs';
import {
  TANK_CLIP_NAMES,
  TANK_MATERIAL_CONTRACT,
  TANK_SOCKET_DEFINITIONS,
  TANK_STAGES,
} from './model.js';
import { tankSourceFingerprint } from './source_fingerprint.mjs';
import { buildTankSurfaceMaps, NORMAL_SCALE } from './surface_maps.mjs';
import { ORM_CENTER } from './surface_shading.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const SPEC = path.join(ROOT, 'scripts/assets/specs/terrorspark_groundshaker.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const SHIPPING_OUT = path.join(ROOT, 'public/models/mounts/terrorspark_groundshaker.glb');
const PREVIEW_ROOT = path.join(ROOT, 'docs/screenshots/terrorspark-groundshaker/authoring');

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const stage = optionValue('--stage', 'final');
if (!TANK_STAGES.includes(stage)) throw new Error(`unknown tank stage: ${stage}`);
const rawOnly = process.argv.includes('--raw-only');
const noPreview = process.argv.includes('--no-preview');
const rawOut = path.join(
  ROOT,
  `tmp/asset_src/terrorspark_groundshaker/terrorspark_groundshaker-${stage}.glb`,
);
const sourceFingerprint = tankSourceFingerprint(ROOT);

/** Two families (metal, fabric) times albedo, normal, and packed ORM. */
const TANK_SURFACE_MAP_COUNT = 6;
/** Shipping ceiling. The textured surface layer roughly doubled the asset (UVs,
 *  per-vertex baked shading, and six embedded maps), which puts it alongside the
 *  other authored mounts rather than above them: valorsteed 562 KiB, gobbler
 *  555 KiB, toad 499 KiB. */
const SHIPPING_BYTE_CEILING = 576 * 1024;

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

/**
 * Fold every TEXCOORD_0 into [0, 1] and hand the discarded scale to
 * KHR_texture_transform.
 *
 * The model projects UVs in world space, so they span several repeats, and
 * `quantize()` refuses any texcoord outside [0, 1] (it would clamp) and leaves
 * it float32. That single accessor cost more than the rest of the geometry put
 * together. Normalizing here lets the optimizer quantize it like every other
 * attribute and the sampler's repeat wrap plus the transform scale reproduce the
 * original tiling exactly. One shared scale for every material, so the loader
 * needs one texture-transform variant per map rather than one per material.
 */
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
      assertCondition(
        Math.min(...min) >= 0,
        `TEXCOORD_0 must be folded non-negative, saw ${Math.min(...min)}`,
      );
      extent = Math.max(extent, ...max);
    }
  }
  const range = Math.max(1, Math.ceil(extent));
  for (const uv of accessors) {
    const array = uv.getArray();
    for (let index = 0; index < array.length; index++) array[index] /= range;
    uv.setArray(array);
  }
  return range;
}

/**
 * Attach the procedural PBR map sets to the exported materials.
 *
 * Authored here rather than in the browser factory for two reasons: the maps
 * are rastered by sharp (Node only), and writing the exact webp bytes through
 * gltf-transform keeps the export byte-reproducible instead of depending on a
 * canvas encoder. Each family's ORM map serves as BOTH the metallicRoughness
 * and the occlusion texture, which is why the material factors are divided by
 * the map midtone: factor times sampled channel lands back on the authored
 * target from TANK_MATERIAL_CONTRACT.
 */
async function attachSurfaceMaps(glbPath) {
  const maps = await buildTankSurfaceMaps();
  const io = await createNodeIo();
  const document = await io.read(glbPath);
  const root = document.getRoot();
  document.createExtension(EXTTextureWebP).setRequired(true);
  const uvRange = normalizeTexcoords(document);
  const uvTransform = document
    .createExtension(KHRTextureTransform)
    .setRequired(true)
    .createTransform()
    .setScale([uvRange, uvRange]);

  const textures = new Map();
  const textureFor = (family, channel) => {
    const key = `${family}_${channel}`;
    const existing = textures.get(key);
    if (existing) return existing;
    const texture = document
      .createTexture(`tank_${key}`)
      .setMimeType('image/webp')
      .setImage(maps[family][channel]);
    textures.set(key, texture);
    return texture;
  };

  const materialsByName = new Map(
    root.listMaterials().map((material) => [material.getName(), material]),
  );
  for (const contract of TANK_MATERIAL_CONTRACT) {
    const material = materialsByName.get(contract.name);
    assertCondition(Boolean(material), `${contract.name} is missing from the exported document`);
    const orm = textureFor(contract.surface, 'orm');
    material.setBaseColorTexture(textureFor(contract.surface, 'albedo'));
    material.setNormalTexture(textureFor(contract.surface, 'normal'));
    material.setNormalScale(NORMAL_SCALE);
    material.setMetallicRoughnessTexture(orm);
    material.setOcclusionTexture(orm);
    material.setRoughnessFactor(Math.min(1, contract.roughness / ORM_CENTER));
    material.setMetallicFactor(Math.min(1, contract.metalness / ORM_CENTER));
    for (const info of [
      material.getBaseColorTextureInfo(),
      material.getNormalTextureInfo(),
      material.getMetallicRoughnessTextureInfo(),
      material.getOcclusionTextureInfo(),
    ]) {
      // World-space projected UVs run far outside [0, 1); the detail only tiles
      // if the sampler repeats.
      info.setWrapS(TextureInfo.WrapMode.REPEAT);
      info.setWrapT(TextureInfo.WrapMode.REPEAT);
      info.setExtension('KHR_texture_transform', uvTransform);
    }
  }

  await io.write(glbPath, document);
  return { ...maps, uvRange };
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
        triangles: (primitive.getIndices()?.getCount() ?? position.getCount()) / 3,
        attributes: primitive.listSemantics().sort(),
      };
    }),
  }));
  const bounds = getBounds(scene);
  const nodes = root.listNodes();
  return {
    path: path.relative(ROOT, glbPath),
    bytes: statSync(glbPath).size,
    sha256: createHash('sha256').update(readFileSync(glbPath)).digest('hex'),
    scenes: root.listScenes().length,
    sceneChildren: scene.listChildren().map((node) => node.getName()),
    nodes: nodes.length,
    meshes,
    primitives: meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0),
    triangles: meshes.reduce(
      (sum, mesh) =>
        sum + mesh.primitives.reduce((meshSum, primitive) => meshSum + primitive.triangles, 0),
      0,
    ),
    materials: root.listMaterials().map((material) => ({
      name: material.getName(),
      roughness: material.getRoughnessFactor(),
      metalness: material.getMetallicFactor(),
    })),
    textures: root.listTextures().map((texture) => ({
      name: texture.getName(),
      mimeType: texture.getMimeType(),
      size: texture.getSize(),
      bytes: texture.getImage()?.byteLength ?? 0,
    })),
    animations: root.listAnimations().map((animation) => ({
      name: animation.getName(),
      duration: Math.max(
        0,
        ...animation
          .listSamplers()
          .map((sampler) => sampler.getInput()?.getMaxNormalizedValue?.() ?? 0),
      ),
      channels: animation.listChannels().length,
    })),
    skins: root.listSkins().length,
    cameras: root.listCameras().length,
    bounds,
    sockets: TANK_SOCKET_DEFINITIONS.map((definition) => {
      const node = nodes.find((candidate) => candidate.getName() === definition.nodeName);
      return node
        ? {
            name: node.getName(),
            translation: node.getTranslation(),
            mesh: node.getMesh()?.getName() ?? null,
            extras: node.getExtras(),
          }
        : null;
    }),
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
  const expectedExtensions = optimized
    ? [
        'EXT_meshopt_compression',
        'EXT_texture_webp',
        'KHR_mesh_quantization',
        'KHR_texture_transform',
      ]
    : ['EXT_texture_webp', 'KHR_texture_transform'];
  assertCondition(stats.scenes === 1, `${stats.path} must contain one scene`);
  assertCondition(
    JSON.stringify(stats.sceneChildren) === JSON.stringify(['Tank']),
    `${stats.path} scene root must be Tank`,
  );
  assertCondition(
    stats.textures.length === TANK_SURFACE_MAP_COUNT,
    `${stats.path} must ship ${TANK_SURFACE_MAP_COUNT} surface maps, found ${stats.textures.length}`,
  );
  assertCondition(
    stats.textures.every((texture) => texture.mimeType === 'image/webp' && texture.bytes > 0),
    `${stats.path} surface maps must all be non-empty webp`,
  );
  assertCondition(stats.skins === 0, `${stats.path} must contain zero skins`);
  assertCondition(stats.cameras === 0, `${stats.path} must contain zero cameras`);
  assertCondition(stats.triangles <= 14_000, `${stats.path} exceeds 14,000 triangles`);
  assertCondition(stats.primitives <= 24, `${stats.path} exceeds 24 primitives`);
  if (stage === 'final') {
    assertCondition(stats.materials.length === 6, `${stats.path} must contain six materials`);
    assertCondition(
      JSON.stringify(stats.materials.map((material) => material.name).sort()) ===
        JSON.stringify(TANK_MATERIAL_CONTRACT.map((material) => material.name).sort()),
      `${stats.path} material names changed`,
    );
  }
  assertCondition(
    JSON.stringify(stats.animations.map((animation) => animation.name)) ===
      JSON.stringify(TANK_CLIP_NAMES),
    `${stats.path} must contain Idle, Walk, Run, Death in order`,
  );
  assertCondition(
    stats.animations.every((animation) => animation.channels > 0),
    `${stats.path} clips must have live animation channels`,
  );
  assertCondition(
    stats.sockets.every((socket) => socket && socket.mesh === null && socket.extras?.purpose),
    `${stats.path} sockets must be extras-bearing empty nodes`,
  );
  assertCondition(Math.abs(stats.bounds.min[1]) <= 0.001, `${stats.path} must sit on minY zero`);
  if (stage === 'final') {
    assertCondition(
      stats.bounds.max[1] >= 2.3 && stats.bounds.max[1] <= 2.55,
      `${stats.path} height must remain in the 2.3 to 2.55 yard contract`,
    );
  }
  assertCondition(
    stats.fingerprints.document === sourceFingerprint &&
      stats.fingerprints.asset === sourceFingerprint,
    `${stats.path} source fingerprint is missing or stale`,
  );
  assertCondition(
    JSON.stringify(stats.extensions) === JSON.stringify(expectedExtensions),
    `${stats.path} extensions changed: ${stats.extensions.join(', ')}`,
  );
  if (optimized) {
    assertCondition(
      stats.bytes <= SHIPPING_BYTE_CEILING,
      `${stats.path} exceeds ${SHIPPING_BYTE_CEILING / 1024} KiB`,
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
    (selectedStage, fingerprint) => window.exportTankMount(selectedStage, fingerprint),
    stage,
    sourceFingerprint,
  );
  mkdirSync(path.dirname(rawOut), { recursive: true });
  writeFileSync(rawOut, Buffer.from(result.b64, 'base64'));
  authoringStats = result.stats;
} finally {
  await browser.close();
}

const surfaceMaps = await attachSurfaceMaps(rawOut);
const materialEvidence = path.join(PREVIEW_ROOT, 'material');
mkdirSync(materialEvidence, { recursive: true });
const previewSheet = path.join(materialEvidence, 'surface-maps.png');
writeFileSync(previewSheet, surfaceMaps.preview);
console.log(
  `surface maps: metal ${surfaceMaps.metal.albedoSize}/${surfaceMaps.metal.reliefSize}, ` +
    `fabric ${surfaceMaps.fabric.albedoSize}/${surfaceMaps.fabric.reliefSize}, ` +
    `uv range ${surfaceMaps.uvRange}, sheet ${path.relative(ROOT, previewSheet)}`,
);

await stampSourceFingerprint(rawOut);
const rawStats = await inspectGlb(rawOut);
verifyContract(rawStats, false);
console.log(`raw: ${path.relative(ROOT, rawOut)}`);
console.log(`authoring stats: ${JSON.stringify(authoringStats)}`);
console.log(`raw contract: ${JSON.stringify(rawStats)}`);

if (!noPreview) {
  const previewDir = path.join(PREVIEW_ROOT, stage);
  const files = await renderPreviews(rawOut, previewDir, {
    size: 640,
    views: ['front', 'right', 'back', 'hero'],
    clips: true,
  });
  for (const file of files) console.log(`preview: ${path.relative(ROOT, file)}`);
  await closePreview();
}

if (!rawOnly) {
  if (stage !== 'final') {
    throw new Error('shipping optimization is only allowed for --stage final');
  }
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
