// Deterministic farm prop authoring, export, optimization, contract validation,
// and visual evidence capture for the fifteen farming GLBs.
//
// Usage:
//   BROWSER_PATH=... node scripts/assets/farm_props/export_farm_props.mjs
//   BROWSER_PATH=... node scripts/assets/farm_props/export_farm_props.mjs --no-preview
//   BROWSER_PATH=... node scripts/assets/farm_props/export_farm_props.mjs --raw-only
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
  FARM_ACCENT_MATERIAL,
  FARM_PROP_CONTRACTS,
  FARM_PROP_IDS,
  FARM_SOIL_SOCKET_NODE,
} from './model.js';
import { farmPropsSourceFingerprint } from './source_fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const SPEC = path.join(ROOT, 'scripts/assets/specs/farm_props.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const RAW_ROOT = path.join(ROOT, 'tmp/asset_src/farm_props');
const CANDIDATE_ROOT = path.join(ROOT, 'tmp/asset_optimized/farm_props/candidate');
const REPEAT_ROOT = path.join(ROOT, 'tmp/asset_optimized/farm_props/repeat');
const PUBLIC_ROOT = path.join(ROOT, 'public');
const EVIDENCE_ROOT = path.join(ROOT, 'docs/screenshots/farming/assets/farm_props');

const rawOnly = process.argv.includes('--raw-only');
const noPreview = process.argv.includes('--no-preview');

const TRIANGLE_CEILING = 1_200;
const SHIPPING_BYTE_CEILING = 35 * 1024;
const SET_BYTE_CEILING = 400 * 1024;
// The bed mounting sheet doubles as the Socket_Soil proof.
const MOUNTING_VIEWS = Object.freeze([
  ['farm_bed', null, 'empty bed'],
  ['farm_bed', 'farm_sprout', 'bed and sprout'],
  ['farm_bed', 'farm_grain_stage4', 'bed and ready grain'],
  ['farm_bed', 'farm_rootleaf_stage4', 'bed and ready rootleaf'],
  ['farm_bed', 'farm_gourd_stage4', 'bed and ready gourd'],
  ['farm_bed', 'farm_grain_withered', 'bed and withered grain'],
]);

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
  const meshNodes = root
    .listNodes()
    .filter((node) => node.getMesh() !== null)
    .map((node) => {
      const mesh = node.getMesh();
      const primitives = mesh.listPrimitives().map((primitive) => {
        const position = primitive.getAttribute('POSITION');
        if (!position) throw new Error(`${node.getName()} has no POSITION`);
        return {
          material: primitive.getMaterial()?.getName() ?? null,
          mode: primitive.getMode(),
          attributes: primitive.listSemantics().sort(),
          triangles: (primitive.getIndices()?.getCount() ?? position.getCount()) / 3,
        };
      });
      return { name: node.getName(), primitives };
    });
  const modelRoot = scene.listChildren()[0] ?? null;
  const sockets = root
    .listNodes()
    .filter((node) => node.getName().startsWith('Socket_'))
    .map((node) => ({
      name: node.getName(),
      translation: node.getTranslation(),
      children: node.listChildren().length,
      mesh: node.getMesh()?.getName() ?? null,
      extras: node.getExtras(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
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
    meshNodes,
    triangles: meshNodes.reduce(
      (sum, node) =>
        sum + node.primitives.reduce((meshSum, primitive) => meshSum + primitive.triangles, 0),
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
    modelRoot: modelRoot
      ? {
          name: modelRoot.getName(),
          translation: modelRoot.getTranslation(),
          rotation: modelRoot.getRotation(),
          scale: modelRoot.getScale(),
          extras: modelRoot.getExtras(),
        }
      : null,
    sockets,
    fingerprints: {
      document: root.getExtras()?.sourceFingerprint,
      asset: root.getAsset().extras?.sourceFingerprint,
    },
  };
}

function verifyContract(stats, contract, optimized, sourceFingerprint) {
  const expectedExtensions = optimized ? ['EXT_meshopt_compression', 'KHR_mesh_quantization'] : [];
  assertCondition(
    JSON.stringify(stats.usedExtensions) === JSON.stringify(expectedExtensions),
    `${stats.path} used extensions changed: ${stats.usedExtensions.join(', ')}`,
  );
  assertCondition(
    JSON.stringify(stats.requiredExtensions) === JSON.stringify(expectedExtensions),
    `${stats.path} required extensions changed`,
  );
  assertCondition(
    !stats.usedExtensions.includes('KHR_draco_mesh_compression'),
    'Draco is forbidden',
  );
  assertCondition(stats.scenes === 1, `${stats.path} must contain one scene`);
  assertCondition(
    JSON.stringify(stats.sceneChildren) === JSON.stringify([contract.rootNode]),
    `${stats.path} scene root changed`,
  );
  assertCondition(
    JSON.stringify(stats.meshNodes.map((node) => node.name).sort()) ===
      JSON.stringify([...contract.meshes].sort()),
    `${stats.path} mesh node names changed`,
  );
  assertCondition(
    stats.meshNodes.every(
      (node) =>
        node.primitives.length === 1 &&
        node.primitives[0].mode === Primitive.Mode.TRIANGLES &&
        JSON.stringify(node.primitives[0].attributes) ===
          JSON.stringify(['COLOR_0', 'NORMAL', 'POSITION']),
    ),
    `${stats.path} mesh topology contract changed`,
  );
  assertCondition(
    stats.triangles <= TRIANGLE_CEILING,
    `${stats.path} exceeds the triangle ceiling: ${stats.triangles}`,
  );
  assertCondition(
    JSON.stringify(stats.materials) === JSON.stringify([...contract.materials].sort()),
    `${stats.path} material names changed: ${stats.materials.join(', ')}`,
  );
  assertCondition(
    stats.meshNodes.every((node) =>
      node.name === 'CropAccent'
        ? node.primitives[0].material === FARM_ACCENT_MATERIAL
        : node.primitives[0].material !== FARM_ACCENT_MATERIAL,
    ),
    `${stats.path} accent material is not bound to CropAccent`,
  );
  assertCondition(
    stats.textures === 0 && stats.animations === 0 && stats.skins === 0 && stats.cameras === 0,
    `${stats.path} gained textures, animations, skins, or cameras`,
  );
  if (optimized) {
    assertCondition(
      stats.bytes <= SHIPPING_BYTE_CEILING,
      `${stats.path} exceeds the byte ceiling: ${stats.bytes}`,
    );
  }

  const tolerance = optimized ? 3e-3 : 1e-5;
  const [footprintX, footprintZ] = contract.footprintYd;
  assertApproxArray(
    stats.bounds.min,
    [-footprintX / 2, 0, -footprintZ / 2],
    `${stats.path} bounds min`,
    tolerance,
  );
  assertApproxArray(
    stats.bounds.max,
    [footprintX / 2, contract.heightYd, footprintZ / 2],
    `${stats.path} bounds max`,
    tolerance,
  );

  assertCondition(stats.modelRoot, `${stats.path} has no model root`);
  assertApproxArray(stats.modelRoot.translation, [0, 0, 0], `${stats.path} root translation`, 1e-8);
  assertApproxArray(stats.modelRoot.rotation, [0, 0, 0, 1], `${stats.path} root rotation`, 1e-8);
  assertApproxArray(stats.modelRoot.scale, [1, 1, 1], `${stats.path} root scale`, 1e-8);
  assertCondition(
    JSON.stringify(stats.modelRoot.extras?.farmPropContract) === JSON.stringify(contract),
    `${stats.path} stamped contract row drifted from the factory contract`,
  );
  assertCondition(
    stats.modelRoot.extras?.sculptRuntime?.assetId === contract.id &&
      stats.modelRoot.extras?.sculptRuntime?.swapReady === true,
    `${stats.path} lost its runtime contract metadata`,
  );

  const expectedSockets = Object.keys(contract.sockets).sort();
  assertCondition(
    JSON.stringify(stats.sockets.map((socket) => socket.name)) === JSON.stringify(expectedSockets),
    `${stats.path} socket set changed`,
  );
  for (const socket of stats.sockets) {
    assertCondition(
      socket.children === 0 && socket.mesh === null,
      `${socket.name} in ${stats.path} is not an empty mount point`,
    );
    assertCondition(
      socket.extras?.farmPropSocket?.purpose === contract.sockets[socket.name],
      `${socket.name} in ${stats.path} lost its purpose metadata`,
    );
    assertCondition(
      socket.translation[1] > 0 && socket.translation[1] <= contract.heightYd,
      `${socket.name} in ${stats.path} is not seated on the asset`,
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
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    throw new Error(`farm prop optimizer failed: ${result.status ?? 'unknown'}`);
  }
}

function optimizedPath(outputRoot, id) {
  return path.join(outputRoot, FARM_PROP_CONTRACTS[id].out);
}

function labelSvg(label, width) {
  const escaped = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return Buffer.from(
    `<svg width="${width}" height="34"><rect width="${width}" height="34" fill="#17202bdd"/><text x="12" y="23" fill="#f3d58b" font-family="sans-serif" font-size="15" font-weight="700">${escaped}</text></svg>`,
  );
}

async function makeContactSheet(files, labels, outPath, title, columns) {
  const cellWidth = 400;
  const cellHeight = 320;
  const titleHeight = 44;
  const rows = Math.ceil(files.length / columns);
  const composites = [{ input: labelSvg(title, cellWidth * columns), left: 0, top: 0 }];
  for (let index = 0; index < files.length; index++) {
    const input = await sharp(files[index])
      .resize(cellWidth, cellHeight, { fit: 'cover' })
      .png()
      .toBuffer();
    const left = (index % columns) * cellWidth;
    const top = titleHeight + Math.floor(index / columns) * (cellHeight + 34);
    composites.push({ input, left, top });
    composites.push({ input: labelSvg(labels[index], cellWidth), left, top: top + cellHeight });
  }
  mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp({
    create: {
      width: cellWidth * columns,
      height: titleHeight + rows * (cellHeight + 34),
      channels: 3,
      background: '#c7cbd0',
    },
  })
    .composite(composites)
    .png()
    .toFile(outPath);
  return outPath;
}

function writeDataUrl(dataUrl, outPath) {
  const separator = dataUrl.indexOf(',');
  assertCondition(separator >= 0, 'serialized preview returned an invalid data URL');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(dataUrl.slice(separator + 1), 'base64'));
  return outPath;
}

const sourceFingerprint = farmPropsSourceFingerprint(ROOT);
const { outputFiles } = await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
});
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${outputFiles[0].text}</script></body></html>`;
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

const exported = new Map();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 512, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('PAGEERR', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('CONSOLE', message.text());
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 30_000 });

  mkdirSync(RAW_ROOT, { recursive: true });
  for (const id of FARM_PROP_IDS) {
    const result = await page.evaluate((assetId) => window.exportFarmProp(assetId), id);
    exported.set(id, result.b64);
    writeFileSync(path.join(RAW_ROOT, `${id}.glb`), Buffer.from(result.b64, 'base64'));
    console.log(`raw ${id}: ${JSON.stringify(result.stats)}`);
  }

  if (!noPreview) {
    const soloFiles = [];
    for (const id of FARM_PROP_IDS) {
      const stats = await page.evaluate(({ data, view }) => window.renderFarmPropSolo(data, view), {
        data: exported.get(id),
        view: 'front-3q',
      });
      soloFiles.push(writeDataUrl(stats.dataUrl, path.join(EVIDENCE_ROOT, 'solo', `${id}.png`)));
    }
    console.log(
      `solo contact: ${path.relative(
        ROOT,
        await makeContactSheet(
          soloFiles,
          [...FARM_PROP_IDS],
          path.join(EVIDENCE_ROOT, 'solo-contact.png'),
          'Farm prop set, procedural GLB turnaround',
          5,
        ),
      )}`,
    );

    const mountingFiles = [];
    const mountingLabels = [];
    for (const [bedId, stageId, label] of MOUNTING_VIEWS) {
      const stats = await page.evaluate(
        ({ bed, stage, view }) => window.renderFarmPropOnBed(bed, stage, view),
        {
          bed: exported.get(bedId),
          stage: stageId ? exported.get(stageId) : null,
          view: 'front-3q',
        },
      );
      mountingFiles.push(
        writeDataUrl(
          stats.dataUrl,
          path.join(EVIDENCE_ROOT, 'mounting', `${stageId ?? 'bare'}.png`),
        ),
      );
      mountingLabels.push(label);
    }
    console.log(
      `mounting contact: ${path.relative(
        ROOT,
        await makeContactSheet(
          mountingFiles,
          mountingLabels,
          path.join(EVIDENCE_ROOT, 'mounting-contact.png'),
          'Stage meshes mounted on the bed Socket_Soil node',
          3,
        ),
      )}`,
    );
  }
} finally {
  await browser.close();
}

for (const id of FARM_PROP_IDS) {
  const rawPath = path.join(RAW_ROOT, `${id}.glb`);
  await stampSourceFingerprint(rawPath, sourceFingerprint);
  verifyContract(await inspectGlb(rawPath), FARM_PROP_CONTRACTS[id], false, sourceFingerprint);
}
console.log(`raw validated: ${FARM_PROP_IDS.length} assets`);

if (!rawOnly) {
  runOptimizer(CANDIDATE_ROOT);
  runOptimizer(REPEAT_ROOT);
  for (const id of FARM_PROP_IDS) {
    assertCondition(
      readFileSync(optimizedPath(CANDIDATE_ROOT, id)).equals(
        readFileSync(optimizedPath(REPEAT_ROOT, id)),
      ),
      `deterministic optimized rebuild of ${id} differs byte-for-byte`,
    );
    verifyContract(
      await inspectGlb(optimizedPath(CANDIDATE_ROOT, id)),
      FARM_PROP_CONTRACTS[id],
      true,
      sourceFingerprint,
    );
  }
  console.log('deterministic rebuild: candidate and repeat runs are byte identical');

  runOptimizer();
  let totalBytes = 0;
  const table = [];
  for (const id of FARM_PROP_IDS) {
    const shippingPath = optimizedPath(PUBLIC_ROOT, id);
    assertCondition(
      readFileSync(optimizedPath(CANDIDATE_ROOT, id)).equals(readFileSync(shippingPath)),
      `shipping ${id} differs from the deterministic candidate`,
    );
    const stats = await inspectGlb(shippingPath);
    verifyContract(stats, FARM_PROP_CONTRACTS[id], true, sourceFingerprint);
    totalBytes += stats.bytes;
    table.push({
      id,
      triangles: stats.triangles,
      bytes: stats.bytes,
      sha256: stats.sha256,
      bounds: stats.bounds,
      sockets: stats.sockets.map((socket) => `${socket.name}@${socket.translation.join(',')}`),
    });
  }
  assertCondition(
    totalBytes <= SET_BYTE_CEILING,
    `the farm prop set exceeds its byte ceiling: ${totalBytes}`,
  );
  for (const row of table) console.log(`shipping: ${JSON.stringify(row)}`);
  console.log(`shipping total bytes: ${totalBytes}`);
}

console.log(`soil socket node: ${FARM_SOIL_SOCKET_NODE}`);
console.log(`source fingerprint: ${sourceFingerprint}`);
