// Build and ship the Emberbristle Broom (Gourdlight Eve's ridable broom):
//
//   KTX_BIN=<KTX-Software bin> node scripts/assets/gourdlight_eve/ship_broom.mjs [--blender=<path>]
//
// 1. BUILD: the deterministic Blender factory (broom.py) in --background writes the raw
//    GLB (and the review .blend) into tmp/asset_src/gourdlight_eve/.
// 2. OPTIMIZE: dedup, prune, resample the baked clips, meshopt (the runtime loader carries
//    the decoder), the Balgath kit's ship.mjs recipe.
// 3. KTX2: the one 1024 px atlas goes to ETC1S (the repo's codec for a flat, stylised
//    base colour; tests/mount_visuals.test.ts pins that no plain image is left).
// Then regenerate the media manifest: node scripts/build_media_manifest.mjs generate
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Mode, toktx } from '@gltf-transform/cli';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RAW_DIR = path.join(ROOT, 'tmp/asset_src/gourdlight_eve');
const RAW = path.join(RAW_DIR, 'emberbristle_broom.glb');
const OUT = path.join(ROOT, 'public/models/mounts/emberbristle_broom.glb');
const blenderArg = process.argv.find((arg) => arg.startsWith('--blender='));
const BLENDER = blenderArg
  ? blenderArg.slice('--blender='.length)
  : 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';

const rootRequire = createRequire(import.meta.url);
const cliRequire = createRequire(rootRequire.resolve('@gltf-transform/cli'));
const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
if (process.env.KTX_BIN) {
  process.env.PATH = `${process.env.PATH ?? ''}${path.delimiter}${process.env.KTX_BIN}`;
}

fs.mkdirSync(RAW_DIR, { recursive: true });
const built = spawnSync(
  BLENDER,
  [
    '--background',
    '--factory-startup',
    '--python',
    path.join(HERE, 'broom.py'),
    '--',
    '--out',
    RAW,
    '--blend',
    path.join(RAW_DIR, 'broom.blend'),
  ],
  { cwd: ROOT, stdio: 'inherit' },
);
if (built.status !== 0) throw new Error(`blender failed (${built.status})`);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });
const doc = await io.readBinary(fs.readFileSync(RAW));
// Blender names each action `Broom|<Clip>`; the game reads the bare clip name.
for (const anim of doc.getRoot().listAnimations()) {
  anim.setName(anim.getName().split('|').pop() ?? anim.getName());
}
await doc.transform(
  dedup(),
  prune(),
  resample({ tolerance: 1e-4 }),
  textureCompress({ encoder: sharp, targetFormat: 'png', resize: [1024, 1024] }),
  toktx({ mode: Mode.ETC1S, jobs: 1, encoder: sharp }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
const buf = Buffer.from(await io.writeBinary(doc));
const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
const left = (json.images ?? []).filter((i) => i.mimeType !== 'image/ktx2');
if (left.length) throw new Error(`${RAW}: ${left.length} textures were not converted to KTX2`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
const anims = (json.animations ?? []).map((a) => a.name).join(',');
console.log(path.relative(ROOT, OUT), `${(buf.length / 1024).toFixed(0)}KB`, 'anims', anims);
