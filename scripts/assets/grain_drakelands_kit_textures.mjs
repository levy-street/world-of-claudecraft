// Bake masonry grain into the Drakelands rebuild kit's architecture
// basecolor textures, matching the fortress kit's worked-stone read (the
// ignivar_prop_* pieces carry painted surface detail; the rebuild drop's
// buildings ship smooth single-tone faces that read as plastic beside
// them). The grain goes INTO the texture, not a runtime shader layer, so
// it shows on every graphics tier exactly like the fortress kit's does.
//
// Reads each piece's ORIGINAL basecolor from the archived source drop
// (tmp/asset_src/drakelands_kit, full-quality jpeg), composites a
// deterministic three-octave overlay (fine speckle, tonal mottling, and
// faint vertical weathering streaks; mean-neutral so the owner's tuned
// brightness holds), and writes it into the SHIPPED GLB as webp. Run the
// mandatory KTX2 step afterwards, which also re-applies meshopt:
//   node scripts/assets/compress_glb_textures.mjs public/models/drakelands_kit/<file>...
//   node scripts/build_media_manifest.mjs generate
// Usage: node scripts/assets/grain_drakelands_kit_textures.mjs [name...]
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const SRC_DIR = 'tmp/asset_src/drakelands_kit';
const OUT_DIR = 'public/models/drakelands_kit';

// The architecture set: the pieces whose flat walls earn the grain. Small
// furniture (racks, signs, graves) keeps its clean silhouette.
const TARGETS = [
  'barracks',
  'building_1',
  'building_2',
  'building_base',
  'building_base_roof',
  'castle_door',
  'church',
  'stables',
];

// Deterministic per-piece stream (mulberry32 over a name hash), so a re-run
// ships byte-identical textures.
function rngFor(name) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseLayer(rnd, w, h, amp) {
  const buf = Buffer.alloc(w * h);
  for (let i = 0; i < buf.length; i++) buf[i] = 128 + Math.round((rnd() * 2 - 1) * amp);
  return sharp(buf, { raw: { width: w, height: h, channels: 1 } });
}

// Three octaves summed around mean 128: fine speckle at full resolution,
// blurred mottling from an upscaled coarse field, and vertical weathering
// streaks from a tall-and-narrow field stretched to size.
async function grainOverlay(name, size) {
  const rnd = rngFor(name);
  const fine = await noiseLayer(rnd, size, size, 26).blur(0.4).raw().toBuffer();
  const mottle = await noiseLayer(rnd, size >> 3, size >> 3, 20)
    .resize(size, size, { kernel: 'cubic' })
    .blur(2)
    .raw()
    .toBuffer();
  const streaks = await noiseLayer(rnd, size >> 4, size >> 2, 14)
    .resize(size, size, { kernel: 'cubic' })
    .blur(1.2)
    .raw()
    .toBuffer();
  const out = Buffer.alloc(size * size);
  for (let i = 0; i < out.length; i++) {
    const v = fine[i] - 128 + (mottle[i] - 128) + (streaks[i] - 128);
    out[i] = Math.max(0, Math.min(255, 128 + v));
  }
  return sharp(out, { raw: { width: size, height: size, channels: 1 } })
    .png()
    .toBuffer();
}

const only = process.argv.slice(2);
const names = only.length ? TARGETS.filter((n) => only.includes(n)) : TARGETS;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

for (const name of names) {
  const srcDoc = await io.read(path.join(SRC_DIR, `${name}.glb`));
  const srcTex = srcDoc
    .getRoot()
    .listTextures()
    .find((t) => (t.getMimeType() ?? '').startsWith('image/'));
  if (!srcTex) throw new Error(`${name}: no source basecolor`);
  const size = 1024;
  const base = sharp(srcTex.getImage()).resize(size, size, { kernel: 'lanczos3' });
  const overlay = await grainOverlay(name, size);
  const grained = await base
    .composite([{ input: overlay, blend: 'overlay' }])
    .webp({ quality: 88 })
    .toBuffer();

  const shipped = path.join(OUT_DIR, `${name}.glb`);
  const doc = await io.read(shipped);
  const textures = doc.getRoot().listTextures();
  if (textures.length !== 1) throw new Error(`${name}: expected one shipped texture`);
  textures[0].setImage(grained).setMimeType('image/webp');
  await io.write(shipped, doc);
  console.log(
    `${name}: grained (${Math.round(grained.byteLength / 1024)}KB webp; run the KTX2 step)`,
  );
}
