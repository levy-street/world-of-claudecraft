// Ship the Blender-built Balgath pair (the boss and the Knucklebone form) into
// public/models: the raw build.py exports in, the game files out.
//
//   KTX_BIN=<KTX-Software bin> node scripts/assets/balgath_cyclops/ship.mjs \
//     <boss raw glb> <boss out glb> [<form raw glb> <form out glb>]
//
// Three steps per body, in this order:
//
// 1. THE GLOW, as data three.js can draw. build.py colours the burning iris, its slit
//    pupil and the star-light veins in the barrowhide with a vertex-colour layer that
//    its Blender material routes into Emission. The glTF export drops that layer, and
//    even if it did not, three's emissive term never reads vertex colour: the eye
//    would ship as a flat white ball at full glow. So the colour is rebuilt here from
//    the same rules dressing.py paints it with (glowScalar below is its iris_color,
//    pupil and vein colour, expressed as one brightness along the Barrowglass ramp),
//    stored as a coordinate into a small ramp texture, and the glow material samples
//    that ramp as both its base colour and its emissive map. One material, one draw,
//    no shader patch; the pupil is a real dark slit again.
// 2. OPTIMIZE: dedup, prune, resample the baked per-frame clips, meshopt with
//    quantization (the optimize.mjs recipe; the runtime loader carries the decoder).
//    The written file is read back and every clip's arm tremor measured
//    (arm_jitter.mjs): a resample or quantization setting that roughened the motion
//    stops the ship here.
// 3. KTX2: the repo's compress_glb_textures.mjs codec choice (normal map UASTC, the
//    rest ETC1S), except the normal map is resized first. UASTC is about a byte a texel,
//    and at the baked 2048 it alone was 3.6 MB on the boss; 1024 keeps the relief at
//    raid distance for a quarter of that. The form, a player-sized body twenty raiders
//    can wear at once, takes 512 normals and a 1024 albedo.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Mode, toktx } from '@gltf-transform/cli';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { armJitterFailures, armJitterReport } from './arm_jitter.mjs';

const rootRequire = createRequire(import.meta.url);
const cliRequire = createRequire(rootRequire.resolve('@gltf-transform/cli'));
// Sharp first, then KTX on PATH (compress_glb_textures.mjs: the other order can make
// Windows load the wrong libvips DLL).
const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
if (process.env.KTX_BIN) {
  process.env.PATH = `${process.env.PATH ?? ''}${path.delimiter}${process.env.KTX_BIN}`;
}

/** Per-body texel budgets. */
export const BALGATH_TEXEL_BUDGET = Object.freeze({
  boss: Object.freeze({ normal: 1024, other: 2048 }),
  form: Object.freeze({ normal: 512, other: 1024 }),
});

/** The glow material's name (build.py), and the ramp it samples. */
export const BALGATH_GLOW_MATERIAL = 'BalgathGlow';
const RAMP_WIDTH = 64;
const RAMP_HEIGHT = 4;
/** Ramp brightness at u = 1; a scalar s maps to u = s / RAMP_MAX. */
const RAMP_MAX = 2;

// dressing.py's palette (sRGB).
const IRIS = [0.33, 0.9, 0.8];
const IRIS_HOT = [0.9, 1.0, 0.98];

// anatomy.py, converted from Blender (x, y, z) to glTF (x, z, -y): the eyeball's centre
// and radius. The iris faces glTF +Z (Blender -Y).
const EYE = [0, 12.72, 2.02];
const EYE_R = 0.56;
const IRIS_CAP = (40 * Math.PI) / 180;

/**
 * The brightness of one glow vertex along the Barrowglass ramp: 0 is black, 1 is the iris
 * teal, 2 is the white-hot centre. A port of dressing.py's colouring (iris_color, the
 * pupil slit, the vein colour), with each colour expressed as a multiple of IRIS (the
 * whole palette is IRIS scaled, apart from the hot centre the ramp's top half carries).
 */
export function glowScalar(p) {
  const rel = [p[0] - EYE[0], p[1] - EYE[1], p[2] - EYE[2]];
  const d = Math.hypot(rel[0], rel[1], rel[2]);
  if (d > EYE_R + 0.2) return 0.68; // a star-light vein in the barrowhide (0.16, 0.62, 0.55)
  // The slit pupil stands proud of the iris (R + 0.03 .. R + 0.062 along the gaze).
  if (d - EYE_R > 0.045) return 0;
  const polar = Math.acos(Math.max(-1, Math.min(1, rel[2] / d)));
  const r = polar / IRIS_CAP;
  const az = Math.atan2(rel[1], rel[0]);
  const streak = 0.5 + 0.5 * Math.sin(az * 23 + Math.sin(az * 7) * 2);
  if (r < 0.22) return 2 - r / 0.22;
  if (r < 0.72) {
    const k = (r - 0.22) / 0.5;
    return (1 - 0.55 * k) * (0.55 + 0.6 * streak);
  }
  const k = Math.min(1, (r - 0.72) / 0.16);
  return 0.4 * (1 - k) + 0.09 * k;
}

/** The ramp texel colour (sRGB, 0..1) at brightness `s`. */
function rampColor(s) {
  if (s <= 1) return IRIS.map((c) => c * s);
  const k = Math.min(1, s - 1);
  return IRIS.map((c, i) => c + (IRIS_HOT[i] - c) * k);
}

async function rampPng() {
  const px = Buffer.alloc(RAMP_WIDTH * RAMP_HEIGHT * 3);
  for (let x = 0; x < RAMP_WIDTH; x++) {
    const c = rampColor(((x + 0.5) / RAMP_WIDTH) * RAMP_MAX);
    for (let y = 0; y < RAMP_HEIGHT; y++) {
      const o = (y * RAMP_WIDTH + x) * 3;
      for (let i = 0; i < 3; i++) px[o + i] = Math.round(Math.min(1, Math.max(0, c[i])) * 255);
    }
  }
  return sharp(px, { raw: { width: RAMP_WIDTH, height: RAMP_HEIGHT, channels: 3 } })
    .png()
    .toBuffer();
}

async function paintGlow(doc) {
  const root = doc.getRoot();
  const material = root.listMaterials().find((m) => m.getName() === BALGATH_GLOW_MATERIAL);
  if (!material) throw new Error(`no ${BALGATH_GLOW_MATERIAL} material`);
  const ramp = doc
    .createTexture('balgath_glow_ramp')
    .setImage(await rampPng())
    .setMimeType('image/png');
  material
    .setBaseColorFactor([1, 1, 1, 1])
    .setBaseColorTexture(ramp)
    .setEmissiveFactor([1, 1, 1])
    .setEmissiveTexture(ramp);
  let painted = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial() !== material) continue;
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const uv = doc
        .createAccessor()
        .setType('VEC2')
        .setArray(new Float32Array(pos.getCount() * 2));
      const p = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, p);
        uv.setElement(i, [Math.min(1, Math.max(0, glowScalar(p) / RAMP_MAX)), 0.5]);
      }
      prim.setAttribute('TEXCOORD_0', uv);
      painted += pos.getCount();
    }
  }
  if (!painted) throw new Error('the glow material draws no vertices');
  return painted;
}

async function ship(input, output, budget) {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });
  const doc = await io.readBinary(fs.readFileSync(input));
  const painted = await paintGlow(doc);
  await doc.transform(
    dedup(),
    prune(),
    resample({ tolerance: 1e-4 }),
    textureCompress({
      encoder: sharp,
      targetFormat: 'png',
      slots: /^normalTexture$/,
      resize: [budget.normal, budget.normal],
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: 'png',
      slots: /^(baseColorTexture|metallicRoughnessTexture)$/,
      resize: [budget.other, budget.other],
    }),
    toktx({ mode: Mode.UASTC, slots: /^normalTexture$/, jobs: 1, encoder: sharp }),
    toktx({ mode: Mode.ETC1S, jobs: 1, encoder: sharp }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const buf = Buffer.from(await io.writeBinary(doc));
  const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
  const left = (json.images ?? []).filter((i) => i.mimeType !== 'image/ktx2');
  if (left.length) throw new Error(`${input}: ${left.length} textures were not converted`);
  // The arms must still hold still after the resample and the quantization: measured
  // on the bytes about to ship, the same measure the asset suite runs.
  const shaking = armJitterFailures(armJitterReport((await io.readBinary(buf)).getRoot()));
  if (shaking.length) {
    throw new Error(`${input}: arm tremor after the ship pass\n  ${shaking.join('\n  ')}`);
  }
  fs.writeFileSync(output, buf);
  const images = (json.images ?? [])
    .map((i) => `${i.name}=${json.bufferViews[i.bufferView].byteLength}`)
    .join(' ');
  console.log(path.basename(output), 'total', buf.length, 'glow verts', painted, images);
}

const [, , bossIn, bossOut, formIn, formOut] = process.argv;
if (!bossIn || !bossOut) {
  console.error('usage: ship.mjs <boss raw> <boss out> [<form raw> <form out>]');
  process.exit(1);
}
await ship(bossIn, bossOut, BALGATH_TEXEL_BUDGET.boss);
if (formIn && formOut) await ship(formIn, formOut, BALGATH_TEXEL_BUDGET.form);
