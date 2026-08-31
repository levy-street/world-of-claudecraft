// Reproducible procedural rickshaw-mount authoring and export: geometry plus
// procedural PBR surface maps, no animation clips (the wheels are separate nodes
// the renderer rolls). See docs/design/rickshaw_mount/object-sculpt-spec.json.
//
// Usage:
//   node scripts/assets/rickshaw_mount/export_rickshaw_mount.mjs
//   node scripts/assets/rickshaw_mount/export_rickshaw_mount.mjs --no-preview
//   node scripts/assets/rickshaw_mount/export_rickshaw_mount.mjs --raw-only
//
// MANDATORY final step, every run (scripts/assets/CLAUDE.md, "the mandatory
// FINAL step after ANY exporter run"): this script ends with the surface maps
// still webp, not KTX2. Skipping the next two commands ships an uncompressed
// GLB that tests/glb_texture_compression.test.ts will catch, the way this
// exact PR's own review round caught it once already.
//   node scripts/assets/compress_glb_textures.mjs public/models/mounts/rickshaw_mount.glb
//   node scripts/build_media_manifest.mjs generate
import { spawnSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, TextureInfo } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRTextureTransform } from '@gltf-transform/extensions';
import * as esbuild from 'esbuild';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';
import { ORM_CENTER } from '../terrorspark_groundshaker/surface_shading.mjs';
import { RICKSHAW_MATERIAL_CONTRACT } from './model.js';
import { buildRickshawSurfaceMaps, NORMAL_SCALE } from './surface_maps.mjs';

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

/**
 * Fold every TEXCOORD_0 into [0, 1] and hand the discarded scale to
 * KHR_texture_transform. Byte-for-byte the same technique as the tank mount's
 * own export (scripts/assets/terrorspark_groundshaker/export_terrorspark_groundshaker.mjs
 * normalizeTexcoords): the model projects UVs in world space via
 * boxProjectUvInto, so they span several repeats, and build_assets.mjs's own
 * quantize() step refuses any texcoord outside [0, 1] (leaves it float32,
 * which costs more than the rest of the geometry combined).
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

/** Attach the procedural PBR map sets to the exported materials. Mirrors the
 *  tank mount's own attachSurfaceMaps: rastered in Node (sharp), written
 *  through gltf-transform so the export stays byte-reproducible, running on
 *  the RAW glb before build_assets.mjs's resample/prune/dedup/meshopt pass so
 *  that pass's own quantize() step sees already-normalized UVs. */
async function attachRickshawSurfaceMaps(glbPath) {
  const maps = await buildRickshawSurfaceMaps();
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
      .createTexture(`rickshaw_${key}`)
      .setMimeType('image/webp')
      .setImage(maps[family][channel]);
    textures.set(key, texture);
    return texture;
  };

  const materialsByName = new Map(
    root.listMaterials().map((material) => [material.getName(), material]),
  );
  // The ORM map's roughness/metalness channels (buildOrm, surface_maps.mjs)
  // are centered on ORM_CENTER, same convention as the tank: dividing the
  // authored target by it here means factor times the map's own midtone
  // sample lands back on the target from RICKSHAW_MATERIAL_CONTRACT, with
  // the map free to scale up or down into cavities/wear around it. Without
  // this the model.js-authored roughness/metalness (already correct for the
  // UNTEXTURED preview materials) would land ~10% low once multiplied by a
  // ~0.9-centered map. lanternGlow has no contract entry and is skipped,
  // same as it gets no UV attribute in model.js's shadeAllParts.
  for (const contract of RICKSHAW_MATERIAL_CONTRACT) {
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
      info.setWrapS(TextureInfo.WrapMode.REPEAT);
      info.setWrapT(TextureInfo.WrapMode.REPEAT);
      info.setExtension('KHR_texture_transform', uvTransform);
    }
  }

  await io.write(glbPath, document);
  return { ...maps, uvRange };
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
};

// A real HTTP origin, not page.setContent's opaque data context: the puller
// preview needs the KTX2 transcoder at '/basis/', the same absolute path the
// real client resolves it from, which only works when the page actually has
// an origin to resolve against.
function serveRepoRoot(rootDir) {
  const server = http.createServer((req, res) => {
    const filePath = path.join(rootDir, decodeURIComponent(req.url.split('?')[0]));
    if (!filePath.startsWith(rootDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const RAW_OUT = path.join(ROOT, 'tmp/asset_src/rickshaw_mount/rickshaw_mount.glb');
const PREVIEW_DIR = path.join(ROOT, 'tmp/rickshaw_mount_preview');
const SPEC = path.join(ROOT, 'scripts/assets/specs/rickshaw_mount.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
// Reused, not hand-built: skel_rickshaw_puller's own rig, attached at
// Socket_Puller for review renders only. The exported rickshaw_mount.glb
// itself does NOT embed this character; composing them is a render-layer
// (src/render/) concern, not something baked into the shipped prop GLB. Must
// stay in sync with src/render/characters/manifest.ts's skel_rickshaw_puller
// VisualDef (skeleton_minion_free.glb, not skeleton_warrior.glb: the game's
// actual puller since round 1, not this exporter's original placeholder) and
// export_entry.js's PULLER_TARGET_WORLD_HEIGHT, or this preview reviews a
// different rig at a different height/offset than what actually ships.
const PULLER_GLB = path.join(ROOT, 'public/models/chars/enemies/skeleton_minion_free.glb');
const noPreview = process.argv.includes('--no-preview');
const rawOnly = process.argv.includes('--raw-only');

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
const ENTRY_HTML_PATH = path.join(ROOT, 'tmp/rickshaw_mount_preview_entry.html');
mkdirSync(path.dirname(ENTRY_HTML_PATH), { recursive: true });
writeFileSync(ENTRY_HTML_PATH, html);

const server = await serveRepoRoot(ROOT);
const { port } = server.address();

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
  await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('PAGEERR', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('CONSOLE', message.text());
  });
  await page.goto(`http://127.0.0.1:${port}/tmp/rickshaw_mount_preview_entry.html`, {
    waitUntil: 'load',
  });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });

  const result = await page.evaluate(() => window.exportRickshawMount());
  mkdirSync(path.dirname(RAW_OUT), { recursive: true });
  writeFileSync(RAW_OUT, Buffer.from(result.b64, 'base64'));
  console.log(`raw: ${path.relative(ROOT, RAW_OUT)}`);
  console.log(`authoring stats: ${JSON.stringify(result.stats)}`);

  const surfaceMaps = await attachRickshawSurfaceMaps(RAW_OUT);
  console.log(
    `surface maps: wood ${surfaceMaps.wood.albedoSize}/${surfaceMaps.wood.reliefSize}, ` +
      `bronze ${surfaceMaps.bronze.albedoSize}/${surfaceMaps.bronze.reliefSize}, ` +
      `leather ${surfaceMaps.leather.albedoSize}/${surfaceMaps.leather.reliefSize}, ` +
      `fabric ${surfaceMaps.fabric.albedoSize}/${surfaceMaps.fabric.reliefSize}, ` +
      `uv range ${surfaceMaps.uvRange}`,
  );
  mkdirSync(PREVIEW_DIR, { recursive: true });
  writeFileSync(path.join(PREVIEW_DIR, 'surface-maps.png'), surfaceMaps.preview);

  // NOTE: the preview renders below run INSIDE the browser page, reusing the
  // in-memory scene exportRickshawMount() already built there; they run
  // BEFORE attachRickshawSurfaceMaps (a Node-only step: sharp + gltf-transform
  // have no browser equivalent) ever touches the file, so they still show the
  // pre-texture vertex-shaded look, not the final textured materials. That's
  // an existing limitation of this preview harness, not something this
  // change fixes: verify the real textured result against the actual shipped
  // GLB in-game instead (it reflects attachRickshawSurfaceMaps + build_assets.mjs
  // both having run).
  if (!noPreview) {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    const pullerB64 = readFileSync(PULLER_GLB).toString('base64');
    for (const view of [
      'threeQuarter',
      'front',
      'side',
      'grazing',
      'rear3q',
      'faceCheck',
      'faceCheckSide',
    ]) {
      await page.evaluate(
        (name, b64) => window.renderRickshawMountPreview(name, b64),
        view,
        pullerB64,
      );
      const canvas = await page.$('canvas');
      if (!canvas) throw new Error('preview canvas was not created');
      const out = path.join(PREVIEW_DIR, `${view}.png`);
      await canvas.screenshot({ path: out });
      console.log(`preview: ${path.relative(ROOT, out)}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}

if (!rawOnly) {
  const pipeline = spawnSync(process.execPath, [BUILD_ASSETS, SPEC], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (pipeline.status !== 0) process.exit(pipeline.status ?? 1);
}
