// Export and optimize Old Thatchgrin and his strawling (Gourdlight Eve's field boss).
//
//   node scripts/assets/gourdlight_eve/export_scarecrow.mjs [--blender=<path>]
//
// 1. Runs the Blender factory (scarecrow.py) once per character in --background (one
//    rig per process, so the glTF exporter's action-per-rig matching can never mix the
//    two clip sets): the raw GLBs land in tmp/asset_src/gourdlight_eve/, then a third
//    run saves the review .blend with both side by side, and a fourth builds the
//    Swelling Gourd (swelling_gourd.py).
// 2. Optimizes them through scripts/assets/build_assets.mjs with
//    specs/gourdlight_scarecrow.json into public/models/creatures/.
// 3. KTX2: Old Thatchgrin's sackcloth weave (scarecrow.py + burlap_weave.py) goes to
//    KTX2, the albedo tile ETC1S and the normal tile UASTC (KTX_BIN=<KTX-Software bin>).
// Then regenerate the media manifest:
//   node scripts/build_media_manifest.mjs generate
import { spawnSync } from 'node:child_process';
import fs, { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Mode, toktx } from '@gltf-transform/cli';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RAW_DIR = path.join(ROOT, 'tmp/asset_src/gourdlight_eve');
const blenderArg = process.argv.find((arg) => arg.startsWith('--blender='));
const BLENDER = blenderArg
  ? blenderArg.slice('--blender='.length)
  : 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${path.basename(cmd)} failed (${result.status})`);
}

const factory = path.join(HERE, 'scarecrow.py');
mkdirSync(RAW_DIR, { recursive: true });
for (const who of ['thatchgrin', 'strawling']) {
  run(BLENDER, [
    '--background',
    '--factory-startup',
    '--python',
    factory,
    '--',
    '--out',
    RAW_DIR,
    '--only',
    who,
  ]);
}
run(BLENDER, [
  '--background',
  '--factory-startup',
  '--python',
  factory,
  '--',
  '--blend',
  path.join(RAW_DIR, 'scarecrow.blend'),
]);
// the Swelling Gourd, his giant pumpkin add (its own small factory, the same kit)
run(BLENDER, [
  '--background',
  '--factory-startup',
  '--python',
  path.join(HERE, 'swelling_gourd.py'),
  '--',
  '--out',
  path.join(RAW_DIR, 'gourdlight_swelling_gourd.glb'),
  '--blend',
  path.join(RAW_DIR, 'swelling_gourd.blend'),
]);
run(process.execPath, [
  path.join(ROOT, 'scripts/assets/build_assets.mjs'),
  path.join(ROOT, 'scripts/assets/specs/gourdlight_scarecrow.json'),
]);

// 3. the weave tiles to KTX2 (the boss GLB is the only one that carries textures)
if (process.env.KTX_BIN) {
  process.env.PATH = `${process.env.PATH ?? ''}${path.delimiter}${process.env.KTX_BIN}`;
}
const rootRequire = createRequire(import.meta.url);
const cliRequire = createRequire(rootRequire.resolve('@gltf-transform/cli'));
const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });
const BOSS = path.join(ROOT, 'public/models/creatures/gourdlight_thatchgrin.glb');
const doc = await io.readBinary(fs.readFileSync(BOSS));
await doc.transform(
  toktx({ mode: Mode.UASTC, slots: /normalTexture/, jobs: 1, encoder: sharp }),
  toktx({ mode: Mode.ETC1S, slots: /baseColorTexture/, jobs: 1, encoder: sharp }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
const buf = Buffer.from(await io.writeBinary(doc));
const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
const left = (json.images ?? []).filter((i) => i.mimeType !== 'image/ktx2');
if (left.length) throw new Error(`${BOSS}: ${left.length} textures were not converted to KTX2`);
fs.writeFileSync(BOSS, buf);
console.log(
  path.relative(ROOT, BOSS),
  `${(buf.length / 1024).toFixed(0)}KB`,
  'images',
  json.images?.length ?? 0,
);
