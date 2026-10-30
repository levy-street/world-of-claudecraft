#!/usr/bin/env node
// Top-down lookdev preview of the painted ground, with no browser and no dev
// server: composites the SHIPPED painted layers (public/textures/terrain/
// Painted*) through the same cover masks and height blend the splat shader
// runs (the JS twins in src/render/terrain_painted_ground_core.ts) over a
// synthetic Eastbrook-like patch: meadow, a dirt road with a feathered
// margin, a town plaza inside the cobble footprint and a strip of strand.
// Albedo only by default (no fog, no blade carpet, no baked strokes), so it
// judges the paintings, the seams, the repeat and the edges, not the final
// frame. --lit adds a low sun from the upper left over the painted relief:
// the grass and dirt NormalGL maps (each following its albedo's anti-repeat
// copy) plus the height relief the shader derives from the composite painted
// height (paintedBumpHeight, here differenced on the pixel grid), so the
// cobbles' and the litter's form can be judged without a browser.
//
// Usage (repo root):
//   npx tsx scripts/assets/painted_ground/preview_painted_ground.mjs <out.png> [--ppy 12] [--window x,z,w,h] [--lit]
// The patch is 72 x 48 yards; --window crops a sub-rectangle of it (yards),
// for a close look at an edge at a higher --ppy (pixels per yard).
// The macro noise is an EMULATION of textures.ts macroNoiseTexture (same blob
// recipe, its own LCG start), so mask coverage matches the game's in
// distribution, not blob for blob.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  coverMasksAt,
  macroStatsOf,
  PAINTED_GROUND_LAYERS,
  PAINTED_GROUND_TUNING,
  PAINTED_TAP_ROT,
  paintedBumpHeight,
  paintedGroundFiles,
  paintedHeightBlend,
  resolveCobbleTowns,
  rotateBack,
  TERRAIN_BASE_UV_PER_YARD,
  townCobbleAt,
} from '../../../src/render/terrain_painted_ground_core.ts';
import { emulateMacroNoise, linearToSrgb, srgbToLinear } from './lib/painted_ground_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PUBLIC = path.join(ROOT, 'public');

// ---- texture with a box mip chain, linear RGB + height --------------------
async function loadLayer(layer) {
  const files = paintedGroundFiles(layer);
  const { data: c, info } = await sharp(path.join(PUBLIC, files.color))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const size = info.width;
  const { data: hb } = await sharp(path.join(PUBLIC, files.height))
    .resize(size, size, { kernel: 'cubic' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const level0 = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    level0[i * 4] = srgbToLinear(c[i * 3] / 255);
    level0[i * 4 + 1] = srgbToLinear(c[i * 3 + 1] / 255);
    level0[i * 4 + 2] = srgbToLinear(c[i * 3 + 2] / 255);
    level0[i * 4 + 3] = hb[i] / 255;
  }
  const mips = [{ size, data: level0 }];
  while (mips[mips.length - 1].size > 1) {
    const prev = mips[mips.length - 1];
    const n = prev.size >> 1;
    const d = new Float32Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        for (let k = 0; k < 4; k++) {
          const at = (xx, yy) => prev.data[(yy * prev.size + xx) * 4 + k];
          d[(y * n + x) * 4 + k] =
            (at(2 * x, 2 * y) +
              at(2 * x + 1, 2 * y) +
              at(2 * x, 2 * y + 1) +
              at(2 * x + 1, 2 * y + 1)) /
            4;
        }
      }
    }
    mips.push({ size: n, data: d });
  }
  return mips;
}

/** A NormalGL map as a mip chain of tangent (x, y, 0, 0), in THIS preview's
 *  uv frame: the preview samples rows top-down where the game samples them
 *  flipY, so the map's green (up the image) is the preview's -v. */
async function loadNormal(layer) {
  const files = paintedGroundFiles(layer);
  if (!files.normal) return null;
  const { data, info } = await sharp(path.join(PUBLIC, files.normal))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const size = info.width;
  const level0 = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    level0[i * 4] = (data[i * 3] / 255) * 2 - 1;
    level0[i * 4 + 1] = -((data[i * 3 + 1] / 255) * 2 - 1);
  }
  const mips = [{ size, data: level0 }];
  while (mips[mips.length - 1].size > 1) {
    const prev = mips[mips.length - 1];
    const n = prev.size >> 1;
    const d = new Float32Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        for (let k = 0; k < 2; k++) {
          const at = (xx, yy) => prev.data[(yy * prev.size + xx) * 4 + k];
          d[(y * n + x) * 4 + k] =
            (at(2 * x, 2 * y) +
              at(2 * x + 1, 2 * y) +
              at(2 * x, 2 * y + 1) +
              at(2 * x + 1, 2 * y + 1)) /
            4;
        }
      }
    }
    mips.push({ size: n, data: d });
  }
  return mips;
}

/** Bilinear tap at uv (tiles), on the mip whose texel best fits `texPerPx`. */
function tap(mips, u, v, texPerPx) {
  const level = Math.min(
    mips.length - 1,
    Math.max(0, Math.round(Math.log2(Math.max(1, texPerPx)))),
  );
  const { size, data } = mips[level];
  const x = (((u % 1) + 1) % 1) * size - 0.5;
  const y = (((v % 1) + 1) % 1) * size - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const out = [0, 0, 0, 0];
  const wrap = (q) => ((q % size) + size) % size;
  for (const [xx, yy, wgt] of [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ]) {
    const i = (wrap(yy) * size + wrap(xx)) * 4;
    for (let k = 0; k < 4; k++) out[k] += data[i + k] * wgt;
  }
  return out;
}

/** wocPaintedTap: the tap and its rotated copy, chosen by field + height.
 *  Returns the blend with the copy weight appended (index 4). */
function paintedTap(mips, u, v, repeatZ, rot, texPerPx) {
  const a = tap(mips, u, v, texPerPx);
  const b = tap(mips, u * rot[0] - v * rot[1] + rot[2], u * rot[1] + v * rot[0] + rot[3], texPerPx);
  const T = PAINTED_GROUND_TUNING;
  const t = Math.min(
    1,
    Math.max(0, repeatZ * T.antiRepeatSharp + (b[3] - a[3]) * T.antiRepeatHeight + 0.5),
  );
  return [...a.map((va, k) => va * (1 - t) + b[k] * t), t];
}

/** The painted detail normal of one layer: its map at both anti-repeat UVs,
 *  the copy turned back into the base frame, mixed by the albedo's weight. */
function detailNormal(nmips, u, v, rot, t, texPerPx) {
  const a = tap(nmips, u, v, texPerPx);
  const b = tap(
    nmips,
    u * rot[0] - v * rot[1] + rot[2],
    u * rot[1] + v * rot[0] + rot[3],
    texPerPx,
  );
  const [bx, by] = rotateBack(b[0], b[1], rot);
  return [a[0] * (1 - t) + bx * t, a[1] * (1 - t) + by * t];
}

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => srgbToLinear(v / 255));
const mix3 = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function parseArgs(argv) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const flagValues = new Set([value('--ppy'), value('--window')]);
  const out = argv.find((a) => !a.startsWith('--') && !flagValues.has(a));
  if (!out)
    throw new Error(
      'usage: preview_painted_ground.mjs <out.png> [--ppy 12] [--window x,z,w,h] [--lit]',
    );
  const win = value('--window')?.split(',').map(Number) ?? [0, 0, 72, 48];
  return {
    out: path.resolve(out),
    ppy: Number(value('--ppy') ?? 12),
    win,
    lit: argv.includes('--lit'),
  };
}

async function main() {
  const { out, ppy, win, lit } = parseArgs(process.argv.slice(2));
  const layers = Object.fromEntries(
    await Promise.all(PAINTED_GROUND_LAYERS.map(async (l) => [l.source, await loadLayer(l)])),
  );
  const normals = Object.fromEntries(
    await Promise.all(PAINTED_GROUND_LAYERS.map(async (l) => [l.source, await loadNormal(l)])),
  );
  const tile = Object.fromEntries(PAINTED_GROUND_LAYERS.map((l) => [l.source, l.tileYards]));
  const noise = emulateMacroNoise();
  const macro = { sample: noise.sample, stats: macroStatsOf(noise.bytes) };
  // the patch: 72 x 48 yards, the plaza centred in the town footprint
  const [X0, Z0, W, H] = win;
  const hub = { x: 22, z: 24 };
  const towns = resolveCobbleTowns([
    { id: 'eastbrook_vale', hub: { x: hub.x, z: hub.z, radius: 26 } },
  ]);
  const road = (x) => 24 + Math.sin(x * 0.09) * 6 + (x > 40 ? (x - 40) * 0.35 : 0);
  const grassPal = { grass: hex(0x72b444), dark: hex(0x468844), yellow: hex(0xadd058) };
  const dirtPal = hex(0xb49668);
  const sandPal = hex(0xe4d4a8);
  const pxW = W * ppy;
  const pxH = H * ppy;
  const img = Buffer.alloc(pxW * pxH * 3);
  const albedo = new Float32Array(pxW * pxH * 3);
  const bump = new Float32Array(pxW * pxH);
  const detail = new Float32Array(pxW * pxH * 2);
  const grassLift = 0.9 / 0.42; // a near-white bake mean over the neutral grass mean
  for (let py = 0; py < pxH; py++) {
    for (let px = 0; px < pxW; px++) {
      const x = X0 + (px + 0.5) / ppy;
      const z = Z0 + (py + 0.5) / ppy;
      // splat weights the way terrain_chunk_build lays them (grass, dirt, rock, sand)
      const rd = Math.abs(z - road(x));
      let dirt = rd < 1.9 ? 0.88 : rd < 3.6 ? 0.88 * smooth(1 - (rd - 1.9) / 1.7) : 0;
      const dHub = Math.hypot(x - hub.x, z - hub.z);
      if (dHub < 14) dirt = Math.max(dirt, 0.75 * Math.min(1, (14 - dHub) / 3));
      const sand = Math.min(1, Math.max(0, (z - 41) / 3));
      let grass = Math.max(0, 1 - dirt - sand);
      const total = grass + dirt + sand;
      grass /= total;
      dirt /= total;
      const sandW = sand / total;
      // vertex colour: zone palette, the road and plaza lerp toward dirt
      const lush = macro.sample(x * 0.045, z * 0.045);
      let vColor = mix3(grassPal.grass, grassPal.dark, Math.min(1, Math.max(0, (lush - 0.4) * 3)));
      vColor = mix3(vColor, grassPal.yellow, 0.15);
      vColor = mix3(vColor, dirtPal, dirt);
      vColor = mix3(vColor, sandPal, sandW);
      const vtint = vColor.map((v) => Math.min(2, v * 2));
      const vtint35 = vtint.map((v) => 1 + (v - 1) * 0.35);
      // masks and taps
      const m = coverMasksAt(x, z, 1, macro.sample, macro.stats);
      const tuv = [x * TERRAIN_BASE_UV_PER_YARD, z * TERRAIN_BASE_UV_PER_YARD];
      const texPer = (src) => 1024 / (tile[src] * ppy);
      const uv = (src) => [x / tile[src], z / tile[src]];
      const pg = paintedTap(
        layers.grass,
        ...uv('grass'),
        m.repeatZ,
        PAINTED_TAP_ROT.grass,
        texPer('grass'),
      );
      const pd = paintedTap(
        layers.dirt,
        ...uv('dirt'),
        m.repeatZ,
        PAINTED_TAP_ROT.dirt,
        texPer('dirt'),
      );
      const pl = paintedTap(
        layers.leaves,
        ...uv('leaves'),
        m.repeatZ,
        PAINTED_TAP_ROT.leaves,
        texPer('leaves'),
      );
      const pc = paintedTap(
        layers.cobble,
        ...uv('cobble'),
        m.repeatZ,
        PAINTED_TAP_ROT.cobble,
        texPer('cobble'),
      );
      void tuv;
      const cob = townCobbleAt(x, z, towns, m.repeatZ);
      // carve and blend (lanes: grass, dirt, rock, sand, leaf, earth, cobble)
      const wLe = grass * m.leaf;
      const wEa = grass * m.earth;
      const wCo = dirt * cob;
      const w = [grass - wLe - wEa, dirt - wCo, 0, sandW, wLe, wEa, wCo];
      const h = [pg[3], pd[3], 0.5, 0.5, pl[3], pd[3], pc[3]].map((v) => v - 0.5);
      const b = paintedHeightBlend(w, h, m.rag);
      const drift = mix3(PAINTED_GROUND_TUNING.mossTint, PAINTED_GROUND_TUNING.yellowTint, m.drift);
      const grassAlb = pg.slice(0, 3).map((v, i) => v * grassLift * drift[i] * vtint[i] * 0.472);
      const dirtAlb = pd.slice(0, 3).map((v, i) => v * vtint35[i]);
      const valTint = luma(vtint35);
      const sandAlb = vColor.map((v) => v * 0.46);
      const alb = [0, 1, 2].map(
        (i) =>
          grassAlb[i] * b[0] +
          dirtAlb[i] * b[1] +
          sandAlb[i] * b[3] +
          (pl[i] * b[4] + pd[i] * b[5] + pc[i] * b[6]) * valTint,
      );
      const p = py * pxW + px;
      albedo.set(alb, p * 3);
      if (lit) {
        bump[p] = paintedBumpHeight(w, h, m.rag);
        const T = PAINTED_GROUND_TUNING;
        const gn = detailNormal(
          normals.grass,
          ...uv('grass'),
          PAINTED_TAP_ROT.grass,
          pg[4],
          texPer('grass'),
        );
        const dn = detailNormal(
          normals.dirt,
          ...uv('dirt'),
          PAINTED_TAP_ROT.dirt,
          pd[4],
          texPer('dirt'),
        );
        const wg = b[0] * T.normalGainGrass;
        const wd = (b[1] + b[5]) * T.normalGainDirt;
        detail[p * 2] = gn[0] * wg + dn[0] * wd;
        detail[p * 2 + 1] = gn[1] * wg + dn[1] * wd;
      }
    }
  }
  // a low sun from the upper left (preview x right, z down the image)
  const sun = [-0.5, 0.72, -0.48];
  const sl = Math.hypot(...sun);
  for (let py = 0; py < pxH; py++) {
    for (let px = 0; px < pxW; px++) {
      const p = py * pxW + px;
      let shade = 1;
      if (lit) {
        const at = (xx, yy) =>
          bump[Math.min(pxH - 1, Math.max(0, yy)) * pxW + Math.min(pxW - 1, Math.max(0, xx))];
        let gx = ((at(px + 1, py) - at(px - 1, py)) * ppy) / 2;
        let gz = ((at(px, py + 1) - at(px, py - 1)) * ppy) / 2;
        const gl = Math.hypot(gx, gz);
        const k = Math.min(1, PAINTED_GROUND_TUNING.bumpMaxSlope / Math.max(gl, 1e-6));
        gx *= k * PAINTED_GROUND_TUNING.bumpStrength;
        gz *= k * PAINTED_GROUND_TUNING.bumpStrength;
        const n = [detail[p * 2] - gx, 1, detail[p * 2 + 1] - gz];
        const nl = Math.hypot(...n);
        const ndl = Math.max(0, (n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) / (nl * sl));
        shade = 0.42 + 0.95 * ndl;
      }
      // display: a gentle exposure and shoulder in lieu of the game's light
      for (let i = 0; i < 3; i++) {
        const e = albedo[p * 3 + i] * 1.9 * shade;
        img[p * 3 + i] = Math.round(linearToSrgb(e / (1 + e * 0.25)) * 255);
      }
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(img, { raw: { width: pxW, height: pxH, channels: 3 } })
    .png()
    .toFile(out);
  console.log(`[painted-ground] preview ${pxW}x${pxH} -> ${out}`);
}

function smooth(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

main().catch((err) => {
  console.error('[painted-ground] preview failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
