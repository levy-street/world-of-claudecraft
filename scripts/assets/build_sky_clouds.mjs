// Build the painted cloud atlas the vale's sky dome drifts over its painted day sky
// (src/render/sky_clouds_core.ts holds the layout this writes, src/render/sky.ts draws it).
//
// Source: skies_in/vale_painted_clouds.png, four hand-painted clouds in a 2 x 2 sheet on a
// flat green key (ChatGPT image generation, prompt in scripts/assets/painted_ground/PROMPTS.md).
// Per run, with sharp:
//   1. the green key out: a texel's alpha falls linearly with its green excess (its green over
//      the larger of its red and blue, which a cloud's cream, white, lavender or blue never
//      has), choked a texel at the rim; and NO keyed texel keeps its own colour, since where
//      the painting's blues met the key it came out teal: only texels with no green excess
//      at all are trusted, and every other texel takes the colour of the clean cloud nearest
//      it (step 3), so no edge carries the screen;
//   2. each quadrant's cloud measured: the box of its texels with alpha, padded, which the
//      core takes as that sprite's atlas rectangle (printed below, and written to
//      scripts/assets/vale_painted_clouds.layout.json for the record);
//   3. the colour of every untrusted texel, rim and clear alike, filled from the clean cloud
//      around it (a push-pull pyramid), so neither the key's rim nor filtering ever pulls
//      green or black in, and the rim band's green brought down to the mean of its red and
//      blue, so the cyan the painting laid along its edges reads lavender, not teal;
//   4. a vertical flip (three uploads compressed rows bottom first and ignores flipY, as for
//      the painted skies), then `ktx create` UASTC LDR + zstd, sRGB, RGBA, with the painted
//      skies' own settings (lib/sky_ldr_compression_core.mjs buildKtxLdrSkyArgs). No mips:
//      the dome draws the clouds near one texel a pixel, like the skies it rides on.
//
//   node scripts/assets/build_sky_clouds.mjs [--src skies_in/vale_painted_clouds.png]
//        [--out public/env/vale_painted_clouds.ktx2] [--review <png>]
//   npx @biomejs/biome format --write scripts/assets/vale_painted_clouds.layout.json
//   node scripts/build_media_manifest.mjs generate
//
// then paste the printed rectangles into SKY_CLOUD_SPRITES if the sheet changed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildKtxLdrSkyArgs } from './lib/sky_ldr_compression_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KTX = fs.existsSync(path.join(os.homedir(), '.local/bin/ktx'))
  ? path.join(os.homedir(), '.local/bin/ktx')
  : 'ktx';

/** The measured layout, for the record and for tests/sky_clouds_core.test.ts, which holds
 *  src/render/sky_clouds_core.ts SKY_CLOUD_SPRITES to it. */
const LAYOUT = path.join(ROOT, 'scripts', 'assets', 'vale_painted_clouds.layout.json');

/** Alpha from the green excess as a share of the key's own: opaque at or under LO, clear at
 *  HI, linear between (a mix of a cloud and the key is linear in its share of the key). */
const KEY_LO = 0.02;
const KEY_HI = 0.85;
/** How green a texel may lean before its own colour is distrusted (0 to 1 units, trusted
 *  up to LO, not at all by HI): the larger of its green excess and its MINT lean, how far
 *  its green rises over both its blue (less 0.04) and its red (plus 0.04). A cloud's cream
 *  and white sit under its red, its lavender and blue undersides under its blue; the pale
 *  mint the painting left in a few wispy ends, where its blue met the key, is over both. */
const TRUST_LO = -0.02;
const TRUST_HI = 0.03;
const MINT_SLACK = 0.04;
/** Alpha under which a keyed rim is dropped, eased up to opaque at 1, and the share of a
 *  texel's alpha its 3 x 3 minimum takes (the choke). */
const RIM_LO = 0.15;
const CHOKE = 0.5;
/** Texels in from the clear sky the rim band reaches. */
const RIM_BAND = 3;
/** Texels of padding round each cloud's measured box. */
const PAD = 6;
/** Alpha that counts as cloud when the boxes are measured. */
const BOX_ALPHA = 0.03;

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function parseArgs(argv) {
  const opts = {
    src: path.join(ROOT, 'skies_in', 'vale_painted_clouds.png'),
    out: path.join(ROOT, 'public', 'env', 'vale_painted_clouds.ktx2'),
    review: null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src') opts.src = path.resolve(argv[++i]);
    else if (argv[i] === '--out') opts.out = path.resolve(argv[++i]);
    else if (argv[i] === '--review') opts.review = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return opts;
}

/** The key colour: the median of the texels that are plainly green screen. */
function keyColour(px, n) {
  const rs = [];
  const gs = [];
  const bs = [];
  for (let i = 0; i < n; i++) {
    const r = px[i * 4] / 255;
    const g = px[i * 4 + 1] / 255;
    const b = px[i * 4 + 2] / 255;
    if (g > 0.7 && r < 0.35 && b < 0.35) {
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  }
  if (rs.length < n * 0.2) throw new Error('the sheet shows too little green key to measure');
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/** Fill the colour of every texel with no weight from the weighted texels around it: a
 *  pyramid of weighted 2 x 2 means down, each level's gaps filled from the one below on the
 *  way up. Texels with weight 1 come back exactly. */
function pushPull(rgb, w, width, height) {
  const levels = [
    { rgb: rgb.map((v, i) => v * w[Math.floor(i / 3)]), w: w.slice(), width, height },
  ];
  while (levels.at(-1).width > 1 && levels.at(-1).height > 1) {
    const top = levels.at(-1);
    const nw = Math.ceil(top.width / 2);
    const nh = Math.ceil(top.height / 2);
    const s = new Float64Array(nw * nh * 3);
    const ww = new Float64Array(nw * nh);
    for (let y = 0; y < top.height; y++) {
      for (let x = 0; x < top.width; x++) {
        const i = y * top.width + x;
        const o = (y >> 1) * nw + (x >> 1);
        ww[o] += top.w[i];
        for (let c = 0; c < 3; c++) s[o * 3 + c] += top.rgb[i * 3 + c];
      }
    }
    levels.push({ rgb: s, w: ww, width: nw, height: nh });
  }
  let filled = null;
  for (let l = levels.length - 1; l >= 0; l--) {
    const lv = levels[l];
    const out = new Float64Array(lv.width * lv.height * 3);
    for (let y = 0; y < lv.height; y++) {
      for (let x = 0; x < lv.width; x++) {
        const i = y * lv.width + x;
        const k = Math.min(1, lv.w[i]);
        for (let c = 0; c < 3; c++) {
          const mean = lv.w[i] > 1e-9 ? lv.rgb[i * 3 + c] / lv.w[i] : 0;
          const coarse = filled ? filled.data[((y >> 1) * filled.width + (x >> 1)) * 3 + c] : mean;
          out[i * 3 + c] = mean * k + coarse * (1 - k);
        }
      }
    }
    filled = { data: out, width: lv.width };
  }
  const result = new Float64Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      result[i * 3 + c] = w[i] >= 1 ? rgb[i * 3 + c] : filled.data[i * 3 + c];
    }
  }
  return result;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${code}: ${err}`)),
    );
  });
}

export async function buildSkyClouds(opts) {
  const { data, info } = await sharp(opts.src)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const n = W * H;
  if (W % 4 || H % 4) throw new Error(`the sheet is ${W}x${H}: UASTC wants a multiple of 4`);
  const key = keyColour(data, n);
  const keyGreen = key[1] - Math.max(key[0], key[2]);
  const rgb = new Float64Array(n * 3);
  const raw = new Float64Array(n);
  const trust = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = [data[i * 4] / 255, data[i * 4 + 1] / 255, data[i * 4 + 2] / 255];
    const excess = p[1] - Math.max(p[0], p[2]);
    const t = Math.min(1, Math.max(0, (excess / keyGreen - KEY_LO) / (KEY_HI - KEY_LO)));
    raw[i] = smoothstep(RIM_LO, 1, 1 - t);
    const mint = Math.min(p[1] - p[2] + MINT_SLACK, p[1] - p[0] - MINT_SLACK);
    trust[i] = 1 - smoothstep(TRUST_LO, TRUST_HI, Math.max(excess, mint));
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] = p[k];
  }
  // the choke: a texel's alpha leans toward its 3 x 3 minimum, so the outermost keyed ring
  // (where the key's green and the painting's blue mixed most) thins away
  const alpha = new Float64Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let lo = 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = Math.min(H - 1, Math.max(0, y + dy));
          const xx = Math.min(W - 1, Math.max(0, x + dx));
          lo = Math.min(lo, raw[yy * W + xx]);
        }
      }
      const i = y * W + x;
      alpha[i] = raw[i] + (lo - raw[i]) * CHOKE;
    }
  }
  // one cloud per quadrant of the 2 x 2 sheet: its padded box
  const sprites = [];
  for (const [qx, qy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const xa = (qx * W) / 2;
    const ya = (qy * H) / 2;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let y = ya; y < ya + H / 2; y++) {
      for (let x = xa; x < xa + W / 2; x++) {
        if (alpha[y * W + x] > BOX_ALPHA) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    }
    if (x1 < 0) throw new Error(`quadrant ${qx},${qy} holds no cloud`);
    x0 = Math.max(xa, x0 - PAD);
    y0 = Math.max(ya, y0 - PAD);
    x1 = Math.min(xa + W / 2, x1 + 1 + PAD);
    y1 = Math.min(ya + H / 2, y1 + 1 + PAD);
    // texture space after the flip: u right, v UP from the atlas's bottom row
    sprites.push({
      u0: +(x0 / W).toFixed(5),
      v0: +(1 - y1 / H).toFixed(5),
      du: +((x1 - x0) / W).toFixed(5),
      dv: +((y1 - y0) / H).toFixed(5),
      px: [x1 - x0, y1 - y0],
    });
  }
  // the colour of every untrusted texel comes from the clean cloud around it, so a keyed rim
  // (where the painting's own blues met the key) carries the cloud's colour, never teal
  const filled = pushPull(rgb, trust, W, H);
  // the rim band (RIM_BAND texels in from the clear sky, by a min filter of the alpha) leans
  // lavender: its green comes down to the mean of its red and blue, so the cyan the painting
  // laid along its edges where blue met the key never reads as a teal outline on the sky
  let edge = alpha;
  for (let it = 0; it < RIM_BAND; it++) {
    const next = new Float64Array(n);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let lo = edge[y * W + x];
        if (x > 0) lo = Math.min(lo, edge[y * W + x - 1]);
        if (x < W - 1) lo = Math.min(lo, edge[y * W + x + 1]);
        if (y > 0) lo = Math.min(lo, edge[(y - 1) * W + x]);
        if (y < H - 1) lo = Math.min(lo, edge[(y + 1) * W + x]);
        next[y * W + x] = lo;
      }
    }
    edge = next;
  }
  for (let i = 0; i < n; i++) {
    const rim = 1 - smoothstep(0.6, 1, edge[i]);
    const lean = (filled[i * 3] + filled[i * 3 + 2]) / 2;
    if (filled[i * 3 + 1] > lean) filled[i * 3 + 1] -= rim * (filled[i * 3 + 1] - lean);
  }
  const outPx = Buffer.alloc(n * 4);
  for (let y = 0; y < H; y++) {
    const src = H - 1 - y; // the vertical flip
    for (let x = 0; x < W; x++) {
      const i = src * W + x;
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++)
        outPx[o + k] = Math.round(Math.min(1, Math.max(0, filled[i * 3 + k])) * 255);
      outPx[o + 3] = Math.round(alpha[i] * 255);
    }
  }
  const tmp = path.join(os.tmpdir(), `vale_painted_clouds.${process.pid}.png`);
  await sharp(outPx, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(tmp);
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.rmSync(opts.out, { force: true });
  await run(KTX, buildKtxLdrSkyArgs({ srcPath: tmp, dstPath: opts.out, alpha: true }));
  fs.rmSync(tmp, { force: true });
  const layout = { source: path.relative(ROOT, opts.src), size: [W, H], key, sprites };
  fs.writeFileSync(LAYOUT, `${JSON.stringify(layout, null, 1)}\n`);
  if (opts.review) {
    // the keyed clouds over a sky blue, unflipped, for a look
    const rev = Buffer.alloc(n * 3);
    const sky = [0.36, 0.6, 0.86];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        rev[i * 3 + k] = Math.round((filled[i * 3 + k] * alpha[i] + sky[k] * (1 - alpha[i])) * 255);
      }
    }
    await sharp(rev, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toFile(opts.review);
  }
  return layout;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const layout = await buildSkyClouds(opts);
  console.log(
    `wrote ${path.relative(ROOT, opts.out)} (${fs.statSync(opts.out).size} bytes), key ${layout.key.map((v) => v.toFixed(3)).join(',')}`,
  );
  for (const [i, s] of layout.sprites.entries()) {
    console.log(
      `  sprite ${i}: { u0: ${s.u0}, v0: ${s.v0}, du: ${s.du}, dv: ${s.dv} } (${s.px.join('x')} px)`,
    );
  }
}
