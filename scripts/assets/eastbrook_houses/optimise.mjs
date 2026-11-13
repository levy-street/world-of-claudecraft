// The shipping pass for everything this kit builds. Blender leaves each model with plain
// float geometry and WebP maps; the game's other models ship meshopt-compressed with
// KTX2 maps, which stay compressed on the GPU instead of decoding to full RGBA bitmaps
// (scripts/assets/compress_glb_textures.mjs says why that matters on a phone). This script
// brings the kit's files to that form:
//
//   1. meshopt compression, by filter (no vertex quantisation: the kit tiles its maps, so
//      its texture coordinates run far outside 0..1, and a quantised file would need a
//      texture transform on materials the game shares by name between files);
//   2. the repo's own texture pass, which turns every map into KTX2.
//
// It works on the model files that differ from the last commit and are not yet in that
// form, so it is safe to run again after any rebuild. Run it AFTER tiers.mjs (the tier
// files are cut from the WebP maps) and BEFORE the generators that hash or measure files:
//
//   node scripts/assets/eastbrook_houses/optimise.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DRY = process.argv.includes('--dry-run');
const only = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

function glbJson(file) {
  const bytes = fs.readFileSync(file);
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
}

/** Model files that differ from the last commit: what a build of this kit has written. */
function touchedModels() {
  const out = execFileSync('git', ['status', '--porcelain', '-uall', '--', 'public/models'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  return out
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith(' D') && !line.startsWith('D '))
    .map((line) => line.slice(3).trim())
    .filter((file) => file.endsWith('.glb'))
    .map((file) => path.join(ROOT, file));
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const files = only.length ? only.map((file) => path.resolve(file)) : touchedModels();
const needMeshopt = [];
const needTextures = [];
for (const file of files) {
  const json = glbJson(file);
  const used = json.extensionsUsed ?? [];
  if (!used.includes('EXT_meshopt_compression')) needMeshopt.push(file);
  if ((json.images ?? []).some((image) => image.mimeType !== 'image/ktx2')) needTextures.push(file);
}
console.log(
  `${files.length} model files touched: ${needMeshopt.length} want meshopt, ${needTextures.length} want KTX2 maps`,
);
if (DRY) process.exit(0);

let bytesBefore = 0;
let bytesAfter = 0;
for (const file of needMeshopt) {
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(file, doc);
  bytesBefore += before;
  bytesAfter += fs.statSync(file).size;
}
if (needMeshopt.length) {
  console.log(
    `meshopt: ${needMeshopt.length} files, ${(bytesBefore / 1048576).toFixed(1)} MB -> ${(bytesAfter / 1048576).toFixed(1)} MB`,
  );
}

// A map no material wears any more still rides in the file: a street lamp's flame is built
// on the glass tile and then authored as a plain emitter (build_props.py rename_materials),
// which leaves that tile behind, a sixth of the lamp's 128 KB budget. Drop every such map.
// (Textures only: the named empties a loader looks for, a lamp's LIGHT_SOCKET, must stay.)
let orphans = 0;
for (const file of files) {
  const json = glbJson(file);
  const used = new Set();
  for (const material of json.materials ?? []) {
    const slots = [
      material.pbrMetallicRoughness?.baseColorTexture,
      material.pbrMetallicRoughness?.metallicRoughnessTexture,
      material.normalTexture,
      material.occlusionTexture,
      material.emissiveTexture,
    ];
    for (const slot of slots) if (slot) used.add(slot.index);
  }
  const wornImages = new Set(
    (json.textures ?? [])
      .map((texture, index) => [texture, index])
      .filter(([, index]) => used.has(index))
      .map(
        ([texture]) =>
          texture.extensions?.KHR_texture_basisu?.source ??
          texture.extensions?.EXT_texture_webp?.source ??
          texture.source,
      ),
  );
  if ((json.images ?? []).length <= wornImages.size) continue;
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  await doc.transform(prune({ propertyTypes: [PropertyType.TEXTURE], keepLeaves: true }));
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(file, doc);
  orphans++;
  console.log(
    `unworn maps dropped: ${path.relative(ROOT, file)} ${(before / 1024).toFixed(0)} KB -> ${(fs.statSync(file).size / 1024).toFixed(0)} KB`,
  );
}
if (orphans) console.log(`${orphans} files carried a map nothing wore`);

// The texture pass is the repo's own script, handed the files in batches (a command line
// only holds so many paths).
const BATCH = 60;
for (let i = 0; i < needTextures.length; i += BATCH) {
  const batch = needTextures.slice(i, i + BATCH);
  const out = execFileSync(
    'node',
    [path.join(ROOT, 'scripts/assets/compress_glb_textures.mjs'), '--jobs', '4', ...batch],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    },
  );
  const summary = out.trim().split('\n').pop();
  console.log(
    `maps ${Math.min(i + BATCH, needTextures.length)}/${needTextures.length}: ${summary}`,
  );
  const bad = out.split('\n').filter((line) => /^(aborted|failed)/.test(line));
  if (bad.length) console.log(bad.join('\n'));
}

// meshopt's filters store a normal as a pair of bytes. glTF allows a vertex attribute that is
// not a float only under KHR_mesh_quantization, which every other shipped model declares, so
// declare it here too (the header alone changes: the stream is what the pass above wrote).
let declared = 0;
for (const file of files) {
  const bytes = fs.readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  if ((json.extensionsUsed ?? []).includes('KHR_mesh_quantization')) continue;
  const FLOAT = 5126;
  const quantized = (json.meshes ?? []).some((mesh) =>
    mesh.primitives.some((primitive) =>
      Object.entries(primitive.attributes).some(
        ([name, accessor]) =>
          !name.startsWith('COLOR_') && json.accessors[accessor].componentType !== FLOAT,
      ),
    ),
  );
  if (!quantized) continue;
  json.extensionsUsed = [...(json.extensionsUsed ?? []), 'KHR_mesh_quantization'].sort();
  json.extensionsRequired = [...(json.extensionsRequired ?? []), 'KHR_mesh_quantization'].sort();
  let body = Buffer.from(JSON.stringify(json), 'utf8');
  if (body.length % 4) body = Buffer.concat([body, Buffer.alloc(4 - (body.length % 4), 0x20)]);
  const rest = bytes.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + body.length + rest.length, 8);
  header.writeUInt32LE(body.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  fs.writeFileSync(file, Buffer.concat([header, body, rest]));
  declared++;
}
if (declared) console.log(`${declared} files now declare KHR_mesh_quantization`);
