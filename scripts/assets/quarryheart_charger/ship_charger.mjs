// Build and ship the Quarryheart Charger (the Smith's Heart raid's reward mount):
//
//   KTX_BIN=<KTX-Software bin> node scripts/assets/quarryheart_charger/ship_charger.mjs \
//     [--blender=<path>] [--blend=<review .blend>]
//
// 1. BUILD: the deterministic Blender factory (build_charger.py) in --background writes the raw
//    GLB into tmp/quarryheart/ (and the review .blend when asked) and prints CHARGER_REPORT: the
//    Idle height (the manifest's `height`) and the three gait references.
// 2. OPTIMIZE: the clip names lose Blender's `Charger|` prefix, then dedup, prune, resample,
//    meshopt. The plate shader's custom attributes (_DIR, _CEN in -1..1, _KIND) survive it: the
//    first two quantize as normalized generics, _KIND (0..2) stays float.
// 3. KTX2: the two 1024 px atlases (base, emissive) go to ETC1S, the repo's codec for a flat,
//    stylised sheet (tests/quarryheart_charger.test.ts pins that no plain image is left).
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
const RAW_DIR = path.join(ROOT, 'tmp/quarryheart');
const RAW = path.join(RAW_DIR, 'raw.glb');
const OUT = path.join(ROOT, 'public/models/mounts/quarryheart_charger.glb');
const argValue = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const BLENDER =
  argValue('blender') ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const BLEND = argValue('blend');

const rootRequire = createRequire(import.meta.url);
const cliRequire = createRequire(rootRequire.resolve('@gltf-transform/cli'));
const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
if (process.env.KTX_BIN) {
  process.env.PATH = `${process.env.PATH ?? ''}${path.delimiter}${process.env.KTX_BIN}`;
}

fs.mkdirSync(RAW_DIR, { recursive: true });
const args = [
  '--background',
  '--factory-startup',
  '--python',
  path.join(HERE, 'build_charger.py'),
  '--',
  '--out',
  RAW,
];
if (BLEND) args.push('--blend', path.resolve(BLEND));
const built = spawnSync(BLENDER, args, { cwd: ROOT, encoding: 'utf8' });
process.stdout.write(
  (built.stdout ?? '')
    .split('\n')
    .filter((l) => l.includes('CHARGER_'))
    .join('\n'),
);
process.stdout.write('\n');
if (built.status !== 0) {
  process.stderr.write(built.stderr ?? '');
  throw new Error(`blender failed (${built.status})`);
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });
const doc = await io.readBinary(fs.readFileSync(RAW));
for (const anim of doc.getRoot().listAnimations()) {
  anim.setName(anim.getName().split('|').pop() ?? anim.getName());
}
// Blender's exporter carries a custom attribute's numbers through untouched, so the plate data
// still sits in Blender's Z-up axes: turn _DIR and _CEN into glTF's (x, z, -y) like POSITION.
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const name of ['_DIR', '_CEN']) {
      const acc = prim.getAttribute(name);
      if (!acc) continue;
      const a = acc.getArray();
      for (let i = 0; i < a.length; i += 3) {
        const y = a[i + 1];
        a[i + 1] = a[i + 2];
        a[i + 2] = -y;
      }
      acc.setArray(a);
    }
  }
}
// The rest pose's inverse bind matrices before meshopt quantizes POSITION: quantizing a skinned
// mesh folds the dequantization into them, which is how the dequantization is read back below.
const rawIbm = doc.getRoot().listSkins()[0].getInverseBindMatrices().getArray().slice(0, 16);
await doc.transform(
  dedup(),
  prune({ keepAttributes: true }),
  resample({ tolerance: 1e-4 }),
  textureCompress({ encoder: sharp, targetFormat: 'png', resize: [1024, 1024] }),
  toktx({ mode: Mode.ETC1S, jobs: 1, encoder: sharp }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
// The dequantization (quantized mesh space to the bind space the plate data is in): D in
// IBM_shipped = IBM_raw x D, a uniform scale and an offset. The renderer's plate shader needs it
// (quarryheart_charger_fx.ts), so it rides the two charger materials' extras.
{
  const { Matrix4 } = await import('three');
  const shippedIbm = doc.getRoot().listSkins()[0].getInverseBindMatrices().getArray().slice(0, 16);
  const D = new Matrix4()
    .fromArray(Array.from(rawIbm))
    .invert()
    .multiply(new Matrix4().fromArray(Array.from(shippedIbm)));
  const e = D.elements;
  const dequant = [e[12], e[13], e[14], e[0]].map((x) => Number(x.toFixed(6)));
  if (Math.abs(e[0] - e[5]) > 1e-4 || Math.abs(e[0] - e[10]) > 1e-4 || Math.abs(e[1]) > 1e-5) {
    throw new Error(`quantization is not a uniform scale: ${e.join(',')}`);
  }
  for (const mat of doc.getRoot().listMaterials()) {
    if (mat.getName() === 'QuarryheartStone' || mat.getName() === 'QuarryheartWind') {
      mat.setExtras({ ...mat.getExtras(), quarryheartDequant: dequant });
    }
    // the living fire is the charger's look: the Low tier's Lambert keeps its emissive map
    // (characters/assets.ts buildTintedClone)
    if (mat.getName() === 'QuarryheartStone') {
      mat.setExtras({ ...mat.getExtras(), lowTierEmissive: true });
    }
  }
  console.log('dequant', dequant.join(','));
}
const buf = Buffer.from(await io.writeBinary(doc));
const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
const left = (json.images ?? []).filter((i) => i.mimeType !== 'image/ktx2');
if (left.length) throw new Error(`${RAW}: ${left.length} textures were not converted to KTX2`);
const attrs = new Set(
  (json.meshes ?? []).flatMap((m) => m.primitives.flatMap((p) => Object.keys(p.attributes))),
);
for (const a of ['_DIR', '_CEN', '_KIND']) {
  if (!attrs.has(a)) throw new Error(`${RAW}: the plate attribute ${a} did not survive the ship`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
const anims = (json.animations ?? []).map((a) => a.name).join(',');
console.log(path.relative(ROOT, OUT), `${(buf.length / 1024).toFixed(0)}KB`, 'anims', anims);
