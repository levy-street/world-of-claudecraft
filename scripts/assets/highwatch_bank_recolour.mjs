// The Highwatch look of the painted Tidehold bank
// (public/models/tidehold/highwatch/bank{,.half,.quarter}.glb).
//
// The other Highwatch buildings were re-baked by the painted pipeline, which
// is not in this repository. This makes the bank's Highwatch look from what
// IS here: the five buildings that exist in both the default and the
// Highwatch look are the same models with only their baked atlases swapped,
// so their wall and roof colour atlases pair default and Highwatch colours
// pixel for pixel. A 3D colour lookup table learned from those pairs maps the
// bank's own wall and roof colour atlases into the Highwatch palette. The
// table maps a blurred copy (the regional colour) and the bank's own fine
// light and shade are put back on top, so its stonework keeps its detail.
// Only those two atlases change in each tier file: geometry, bounds,
// collision, normals, emission, interior, props and the shared town maps are
// the default bank's.
//
//   KTX_BIN=<KTX-Software bin dir> node scripts/assets/highwatch_bank_recolour.mjs
//
// Needs the `ktx` CLI (KTX-Software 4.x); KTX_BIN names its directory when
// it is not on PATH.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MODELS = path.join(ROOT, 'public', 'models', 'tidehold');
const PAIRS = ['house_c', 'hall', 'shop_a', 'smithy', 'tavern_b'];
const PARTS = ['walls', 'roof'];
const TIERS = ['', '.half', '.quarter'];
const KTX = process.env.KTX_BIN ? path.join(process.env.KTX_BIN, 'ktx') : 'ktx';
/** The repo's colour-map ETC1S settings (scripts/assets/woc_character/ktx_encode.mjs). */
const ETC1S = ['--encode', 'basis-lz', '--clevel', '1', '--qlevel', '128'];
const N = 33; // lattice points per channel
const STEP = 255 / (N - 1);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-bank-'));

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** A texture of a document by name. */
function textureNamed(doc, name) {
  const tex = doc
    .getRoot()
    .listTextures()
    .find((t) => t.getName() === name);
  if (!tex) throw new Error(`no texture ${name}`);
  return tex;
}

/** KTX2 bytes to raw RGBA pixels. */
async function decode(ktx2, tag) {
  const src = path.join(work, `${tag}.ktx2`);
  const png = path.join(work, `${tag}.png`);
  fs.writeFileSync(src, ktx2);
  execFileSync(KTX, ['extract', '--transcode', 'rgba8', src, png], { stdio: 'ignore' });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Raw RGBA pixels to ETC1S KTX2 bytes with a generated mip chain. */
async function encode(img, tag) {
  const png = path.join(work, `${tag}.out.png`);
  const out = path.join(work, `${tag}.out.ktx2`);
  await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .png()
    .toFile(png);
  const args = ['create', '--format', 'R8G8B8A8_SRGB', '--assign-tf', 'srgb', '--generate-mipmap'];
  execFileSync(KTX, [...args, ...ETC1S, png, out], { stdio: 'ignore' });
  return fs.readFileSync(out);
}

/** Learn one part's default -> Highwatch colour table from the paired atlases. */
async function learn(part) {
  const sum = new Float64Array(N * N * N * 3);
  const wsum = new Float64Array(N * N * N);
  for (const b of PAIRS) {
    const def = await io.read(path.join(MODELS, `${b}.glb`));
    const hw = await io.read(path.join(MODELS, 'highwatch', `${b}.glb`));
    const name = `${b}_${part}_color`;
    const src = await decode(textureNamed(def, name).getImage(), `def_${name}`);
    let dst = await decode(textureNamed(hw, name).getImage(), `hw_${name}`);
    if (dst.w !== src.w || dst.h !== src.h) {
      const data = await sharp(dst.data, { raw: { width: dst.w, height: dst.h, channels: 4 } })
        .resize(src.w, src.h)
        .raw()
        .toBuffer();
      dst = { data, w: src.w, h: src.h };
    }
    for (let i = 0; i < src.w * src.h; i++) {
      const o = i * 4;
      if (src.data[o + 3] < 128) continue;
      const f = [src.data[o] / STEP, src.data[o + 1] / STEP, src.data[o + 2] / STEP];
      const i0 = f.map(Math.floor);
      for (let corner = 0; corner < 8; corner++) {
        const d = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
        let w = 1;
        const idx = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const t = f[k] - i0[k];
          w *= d[k] ? t : 1 - t;
          idx[k] = Math.min(N - 1, i0[k] + d[k]);
        }
        if (w <= 0) continue;
        const c = (idx[0] * N + idx[1]) * N + idx[2];
        wsum[c] += w;
        for (let k = 0; k < 3; k++) sum[c * 3 + k] += w * dst.data[o + k];
      }
    }
  }
  const lut = new Float64Array(N * N * N * 3);
  let have = new Uint8Array(N * N * N);
  for (let c = 0; c < N * N * N; c++) {
    if (wsum[c] <= 0.5) continue;
    have[c] = 1;
    for (let k = 0; k < 3; k++) lut[c * 3 + k] = sum[c * 3 + k] / wsum[c];
  }
  // Colours the pairs never show: diffuse outward from the learned cells.
  const near = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (let pass = 0; pass < 64; pass++) {
    const next = have.slice();
    let changed = 0;
    for (let r = 0; r < N; r++)
      for (let g = 0; g < N; g++)
        for (let b = 0; b < N; b++) {
          const c = (r * N + g) * N + b;
          if (have[c]) continue;
          let n = 0;
          const acc = [0, 0, 0];
          for (const [dr, dg, db] of near) {
            const rr = r + dr;
            const gg = g + dg;
            const bb = b + db;
            if (rr < 0 || gg < 0 || bb < 0 || rr >= N || gg >= N || bb >= N) continue;
            const cc = (rr * N + gg) * N + bb;
            if (!have[cc]) continue;
            n++;
            for (let k = 0; k < 3; k++) acc[k] += lut[cc * 3 + k];
          }
          if (!n) continue;
          for (let k = 0; k < 3; k++) lut[c * 3 + k] = acc[k] / n;
          next[c] = 1;
          changed++;
        }
    have = next;
    if (!changed) break;
  }
  return lut;
}

function lookup(lut, r, g, b) {
  const f = [r / STEP, g / STEP, b / STEP];
  const i0 = f.map((v) => Math.min(N - 2, Math.floor(v)));
  const out = [0, 0, 0];
  for (let corner = 0; corner < 8; corner++) {
    const d = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
    let w = 1;
    for (let k = 0; k < 3; k++) {
      const t = f[k] - i0[k];
      w *= d[k] ? t : 1 - t;
    }
    const c = ((i0[0] + d[0]) * N + (i0[1] + d[1])) * N + (i0[2] + d[2]);
    for (let k = 0; k < 3; k++) out[k] += w * lut[c * 3 + k];
  }
  return out;
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Map an atlas: the table colours a blurred copy, the original's own fine
 *  light and shade ride on top. */
async function recolour(img, lut) {
  const sigma = Math.max(0.6, (img.w / 3072) * 3);
  const blurred = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .blur(sigma)
    .raw()
    .toBuffer();
  const out = Buffer.alloc(img.data.length);
  for (let i = 0; i < img.w * img.h; i++) {
    const o = i * 4;
    const base = lookup(lut, blurred[o], blurred[o + 1], blurred[o + 2]);
    const detail =
      (lum(img.data[o], img.data[o + 1], img.data[o + 2]) + 4) /
      (lum(blurred[o], blurred[o + 1], blurred[o + 2]) + 4);
    const gain = Math.max(0.35, Math.min(2.5, detail));
    for (let k = 0; k < 3; k++) out[o + k] = Math.max(0, Math.min(255, Math.round(base[k] * gain)));
    out[o + 3] = img.data[o + 3];
  }
  return { data: out, w: img.w, h: img.h };
}

const luts = {};
for (const part of PARTS) luts[part] = await learn(part);
fs.mkdirSync(path.join(MODELS, 'highwatch'), { recursive: true });
for (const tier of TIERS) {
  const doc = await io.read(path.join(MODELS, `bank${tier}.glb`));
  for (const part of PARTS) {
    const tex = textureNamed(doc, `bank_${part}_color`);
    const tag = `bank${tier}_${part}`;
    const img = await decode(tex.getImage(), tag);
    tex.setImage(await encode(await recolour(img, luts[part]), tag));
  }
  const out = path.join(MODELS, 'highwatch', `bank${tier}.glb`);
  await io.write(out, doc);
  console.log(`wrote ${path.relative(ROOT, out)} (${fs.statSync(out).size} bytes)`);
}
fs.rmSync(work, { recursive: true, force: true });
