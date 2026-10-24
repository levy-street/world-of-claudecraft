// Ship the Blender-built Drakemaw Raptor: the raw build.py export in, the game file out.
//
//   node scripts/assets/drakemaw_raptor/ship.mjs <raw glb> <source glb> <stats json> <out glb>
//
// 1. PAINT: the Blender round trip carried a PNG decoded from the source's KTX2;
//    the source's original KTX2 bytes and its material go back in, untouched, so
//    the rebuild wears exactly the paint (and the codec) the mount shipped with.
// 2. TRACKS: a channel that only ever holds its bone at rest is dropped (the
//    mixer fills an absent track from the rest pose), which also keeps the
//    parentless Root free of any track.
// 3. OPTIMIZE: dedup, prune, meshopt with quantization (the runtime loader
//    carries the decoder). The solved per-frame keys are NOT resampled: thinning
//    them let interpolation drift add up down the five joints of a leg (a planted
//    claw 3 mm under the ground on the frame the renderer sizes the model by),
//    and meshopt packs the regular dense keys as small as it packs thinned ones.
// 4. PROVENANCE: asset.extras.drakemawRaptor carries the sha256 fingerprint of
//    every input of the build (FINGERPRINT_INPUTS), the Blender that built it,
//    and the measurements the manifest pins; tests/drakemaw_raptor_mount.test.ts recomputes the
//    fingerprint, so editing a builder without re-running the build fails it.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');

/** Every file the shipped GLB is a function of, repo-relative. */
export const FINGERPRINT_INPUTS = [
  'scripts/assets/drakemaw_raptor/source/drakemaw_raptor_source.glb',
  'scripts/assets/drakemaw_raptor/anatomy.py',
  'scripts/assets/drakemaw_raptor/rig.py',
  'scripts/assets/drakemaw_raptor/pose.py',
  'scripts/assets/drakemaw_raptor/clips.py',
  'scripts/assets/drakemaw_raptor/keys.py',
  'scripts/assets/drakemaw_raptor/build.py',
  'scripts/assets/drakemaw_raptor/prep.mjs',
  'scripts/assets/drakemaw_raptor/ship.mjs',
  'scripts/assets/drakemaw_raptor/build.mjs',
];

export function fingerprint(root = ROOT) {
  const h = createHash('sha256');
  for (const rel of FINGERPRINT_INPUTS) {
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(path.join(root, rel)));
    h.update('\0');
  }
  return h.digest('hex');
}

const sameAsRest = (sampler, rest) => {
  const out = sampler.getOutput();
  const n = out.getElementSize();
  const v = new Array(n).fill(0);
  for (let i = 0; i < out.getCount(); i++) {
    out.getElement(i, v);
    let d = 0;
    for (let k = 0; k < n; k++) d = Math.max(d, Math.abs(v[k] - rest[k]));
    // q and -q are one rotation
    if (n === 4 && d > 1e-6) {
      let dn = 0;
      for (let k = 0; k < 4; k++) dn = Math.max(dn, Math.abs(v[k] + rest[k]));
      d = Math.min(d, dn);
    }
    if (d > 1e-6) return false;
  }
  return true;
};

export async function ship(rawPath, sourcePath, statsPath, outPath) {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });
  const doc = await io.readBinary(fs.readFileSync(rawPath));
  const src = await io.readBinary(fs.readFileSync(sourcePath));
  const root = doc.getRoot();

  // 1. the paint
  const srcMat = src.getRoot().listMaterials()[0];
  const srcTex = srcMat.getBaseColorTexture();
  const mats = root.listMaterials();
  if (mats.length !== 1) throw new Error(`expected one material, got ${mats.length}`);
  const mat = mats[0];
  const tex = mat.getBaseColorTexture();
  if (!tex || !srcTex) throw new Error('missing base colour texture');
  tex.setImage(srcTex.getImage()).setMimeType('image/ktx2').setURI('').setName(srcTex.getName());
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  mat
    .setName(srcMat.getName())
    .setDoubleSided(srcMat.getDoubleSided())
    .setAlphaMode(srcMat.getAlphaMode())
    .setBaseColorFactor(srcMat.getBaseColorFactor())
    .setMetallicFactor(srcMat.getMetallicFactor())
    .setRoughnessFactor(srcMat.getRoughnessFactor())
    .setEmissiveFactor(srcMat.getEmissiveFactor())
    .setMetallicRoughnessTexture(null)
    .setNormalTexture(null)
    .setOcclusionTexture(null)
    .setEmissiveTexture(null);
  for (const t of root.listTextures()) if (t !== tex) t.dispose();

  // 2. the tracks
  let dropped = 0;
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const p = ch.getTargetPath();
      const rest =
        p === 'rotation'
          ? node.getRotation()
          : p === 'translation'
            ? node.getTranslation()
            : node.getScale();
      if (sameAsRest(ch.getSampler(), rest)) {
        ch.getSampler().dispose();
        ch.dispose();
        dropped++;
      }
    }
  }

  // 3. optimize
  await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));

  // 4. provenance and the measured contract
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  root.getAsset().generator = 'World of ClaudeCraft drakemaw_raptor build';
  root.getAsset().extras = {
    drakemawRaptor: {
      fingerprint: fingerprint(),
      blender: stats.blender,
      idleHeight: stats.idle_height,
      idleMin: stats.idle_min,
      saddleRest: stats.saddle_rest_gltf,
      speeds: stats.speeds,
      gaits: stats.gaits,
    },
  };
  const buf = Buffer.from(await io.writeBinary(doc));
  const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
  const left = (json.images ?? []).filter((i) => i.mimeType !== 'image/ktx2');
  if (left.length) throw new Error(`${left.length} textures are not KTX2`);
  if (!(json.extensionsRequired ?? []).includes('KHR_texture_basisu'))
    throw new Error('KTX2 not required');
  for (const m of json.meshes)
    for (const pr of m.primitives) {
      if ('COLOR_0' in pr.attributes) throw new Error('COLOR_0 must not ship on a mount');
      if ('JOINTS_1' in pr.attributes) throw new Error('more than four influences');
    }
  fs.writeFileSync(outPath, buf);
  const anims = (json.animations ?? []).map((a) => a.name).join(',');
  console.log(
    path.basename(outPath),
    buf.length,
    'bytes | clips',
    anims,
    '| tracks dropped',
    dropped,
  );
  return { bytes: buf.length, animations: json.animations.map((a) => a.name) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , raw, source, stats, out] = process.argv;
  if (!raw || !source || !stats || !out) {
    console.error('usage: ship.mjs <raw glb> <source glb> <stats json> <out glb>');
    process.exit(1);
  }
  await ship(raw, source, stats, out);
}
