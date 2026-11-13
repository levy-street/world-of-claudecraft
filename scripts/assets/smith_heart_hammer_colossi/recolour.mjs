// Recolour the Quarry colossi to the rock around them. ChatGPT recoloured each statue's UV texture
// (the painting project_bake.py writes) to the colours of the cliffs behind it, but a regenerated
// image never keeps every small UV island exactly in place, so its pixels are not pasted back.
// Instead a colour grade is fitted from the painting to ChatGPT's result, over the inside of the
// islands only, and applied to the painting itself: ChatGPT's colours on exactly the original
// islands and brush strokes. The grade is a lookup cube of N points a channel, fitted as a smooth
// offset from the best single linear grade, so a colour the painting barely uses still maps the
// way its neighbours do. One thing a grade cannot do: the forge fire and the molten seams share
// their orange with the warm stone ChatGPT turned grey, so where ChatGPT kept a glow the
// painting keeps its own glowing pixels.
//   node scripts/assets/smith_heart_hammer_colossi/recolour.mjs scripts/assets/smith_heart_hammer_colossi/recolour.json
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const N = 17;
/** How strongly a cube point leans on its neighbours rather than on its own pixels. */
const SMOOTH = 15;
/** Island pixels this close to the background are left out of the fit: ChatGPT's edges drift. */
const ERODE = 2;

/** Is the pixel painted (not the black background between islands)? */
const lit = (b, i) => b[i * 3] + b[i * 3 + 1] + b[i * 3 + 2] > 45;

function erode(mask, W, H, r) {
  const out = new Uint8Array(W * H);
  for (let y = r; y < H - r; y++)
    for (let x = r; x < W - r; x++) {
      let keep = mask[y * W + x] === 1;
      for (let dy = -r; keep && dy <= r; dy++)
        for (let dx = -r; keep && dx <= r; dx++) if (!mask[(y + dy) * W + x + dx]) keep = false;
      out[y * W + x] = keep ? 1 : 0;
    }
  return out;
}

/** Solve the 4 by 4 system a x = b in place (Gaussian elimination with pivoting). */
function solve4(a, b) {
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < 4; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = [0, 0, 0, 0];
  for (let r = 3; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < 4; k++) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}

/** The cube point index and trilinear weights of one colour (channels 0 to 1). */
function corners(r, g, b) {
  const f = [r * (N - 1), g * (N - 1), b * (N - 1)];
  const i0 = f.map((v) => Math.min(N - 2, Math.floor(v)));
  const t = f.map((v, k) => v - i0[k]);
  const out = [];
  for (let c = 0; c < 8; c++) {
    const di = c & 1;
    const dj = (c >> 1) & 1;
    const dk = (c >> 2) & 1;
    const w = (di ? t[0] : 1 - t[0]) * (dj ? t[1] : 1 - t[1]) * (dk ? t[2] : 1 - t[2]);
    out.push([i0[0] + di + N * (i0[1] + dj) + N * N * (i0[2] + dk), w]);
  }
  return out;
}

/** Fit the grade from the painting `src` to ChatGPT's `dst` (both W x H RGB bytes). */
function fitGrade(src, dst, W, H) {
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = lit(src, i) ? 1 : 0;
  const keep = erode(mask, W, H, ERODE);
  // The best single linear grade, the cube's starting point.
  const ata = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  const atb = [0, 1, 2].map(() => [0, 0, 0, 0]);
  let pairs = 0;
  for (let i = 0; i < W * H; i++) {
    if (!keep[i]) continue;
    const v = [src[i * 3] / 255, src[i * 3 + 1] / 255, src[i * 3 + 2] / 255, 1];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) ata[r][c] += v[r] * v[c];
      for (let k = 0; k < 3; k++) atb[k][r] += v[r] * (dst[i * 3 + k] / 255);
    }
    pairs++;
  }
  const affine = atb.map((rhs) =>
    solve4(
      ata.map((row) => [...row]),
      [...rhs],
    ),
  );
  const prior = (c) => affine.map((a) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2] + a[3]);
  // Each pixel's pull on its eight cube points, as an offset from the linear grade.
  const M = N * N * N;
  const acc = new Float64Array(M * 3);
  const weight = new Float64Array(M);
  for (let i = 0; i < W * H; i++) {
    if (!keep[i]) continue;
    const c = [src[i * 3] / 255, src[i * 3 + 1] / 255, src[i * 3 + 2] / 255];
    const p = prior(c);
    for (const [n, w] of corners(c[0], c[1], c[2])) {
      for (let k = 0; k < 3; k++) acc[n * 3 + k] += w * (dst[i * 3 + k] / 255 - p[k]);
      weight[n] += w;
    }
  }
  // The offsets, smoothed across the cube: each point is its pixels' mean pulled toward its
  // neighbours (Jacobi sweeps of the least-squares fit), and a point with no pixels at all
  // takes its neighbours' offset, so far colours fall back to the linear grade.
  const off = new Float64Array(M * 3);
  const next = new Float64Array(M * 3);
  const nbrs = (n) => {
    const i = n % N;
    const j = Math.floor(n / N) % N;
    const k = Math.floor(n / (N * N));
    const out = [];
    if (i > 0) out.push(n - 1);
    if (i < N - 1) out.push(n + 1);
    if (j > 0) out.push(n - N);
    if (j < N - 1) out.push(n + N);
    if (k > 0) out.push(n - N * N);
    if (k < N - 1) out.push(n + N * N);
    return out;
  };
  const around = Array.from({ length: M }, (_, n) => nbrs(n));
  for (let it = 0; it < 600; it++) {
    for (let n = 0; n < M; n++) {
      const ns = around[n];
      for (let k = 0; k < 3; k++) {
        let s = acc[n * 3 + k];
        for (const m of ns) s += SMOOTH * off[m * 3 + k];
        next[n * 3 + k] = s / (weight[n] + SMOOTH * ns.length);
      }
    }
    off.set(next);
  }
  const cube = new Float32Array(M * 3);
  for (let n = 0; n < M; n++) {
    const c = [
      (n % N) / (N - 1),
      (Math.floor(n / N) % N) / (N - 1),
      Math.floor(n / (N * N)) / (N - 1),
    ];
    const p = prior(c);
    for (let k = 0; k < 3; k++) cube[n * 3 + k] = p[k] + off[n * 3 + k];
  }
  return { cube, pairs, affine };
}

const ramp = (lo, hi, v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

/** How much a pixel glows: an orange hue (under 40 degrees; the olive moss sits past 50),
 *  saturated and bright. */
function glow(b, i) {
  const r = b[i * 3];
  const g = b[i * 3 + 1];
  const bl = b[i * 3 + 2];
  if (r < g || g < bl || r === bl) return 0;
  const hue = (60 * (g - bl)) / (r - bl);
  return ramp(0.45, 0.65, (r - bl) / r) * ramp(0.45, 0.65, r / 255) * (1 - ramp(40, 50, hue));
}

/** Where the painting keeps its own pixels: it glows, and ChatGPT kept a glow there (widened
 *  for ChatGPT's drift). Warm stone ChatGPT turned grey glows in the painting alone. */
function glowKeep(src, dst, W, H, reach) {
  const kept = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) kept[i] = glow(dst, i);
  const keep = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const own = glow(src, y * W + x);
      if (own === 0) continue;
      let near = 0;
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < H && xx >= 0 && xx < W) near = Math.max(near, kept[yy * W + xx]);
        }
      keep[y * W + x] = own * near;
    }
  return keep;
}

function applyGrade(cube, src, keep, count) {
  const out = Buffer.alloc(count * 3);
  for (let i = 0; i < count; i++) {
    const v = [0, 0, 0];
    for (const [n, w] of corners(src[i * 3] / 255, src[i * 3 + 1] / 255, src[i * 3 + 2] / 255))
      for (let k = 0; k < 3; k++) v[k] += w * cube[n * 3 + k];
    for (let k = 0; k < 3; k++) {
      const graded = Math.min(1, Math.max(0, v[k])) * 255;
      out[i * 3 + k] = Math.round(graded + keep[i] * (src[i * 3 + k] - graded));
    }
  }
  return out;
}

const mean = (b, mask) => {
  const s = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      for (let k = 0; k < 3; k++) s[k] += b[i * 3 + k];
      n++;
    }
  return s.map((v) => Math.round(v / n));
};

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(cfg.src);
for (const material of doc.getRoot().listMaterials()) {
  const result = cfg.statues[material.getName()];
  const texture = material.getBaseColorTexture();
  if (!result || !texture) throw new Error(`no ChatGPT result for ${material.getName()}`);
  const { data: src, info } = await sharp(Buffer.from(texture.getImage()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const dst = await sharp(result)
    .resize(W, H, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const { cube, pairs } = fitGrade(src, dst, W, H);
  const keep = glowKeep(src, dst, W, H, ERODE);
  const out = applyGrade(cube, src, keep, W * H);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = lit(src, i) ? 1 : 0;
  const glowing = keep.reduce((s, k) => s + (k > 0.5 ? 1 : 0), 0);
  texture.setImage(
    new Uint8Array(
      await sharp(out, { raw: { width: W, height: H, channels: 3 } })
        .png()
        .toBuffer(),
    ),
  );
  texture.setMimeType('image/png');
  if (cfg.preview) {
    fs.mkdirSync(cfg.preview, { recursive: true });
    await sharp(out, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toFile(`${cfg.preview}/${material.getName()}.png`);
  }
  console.log(
    material.getName(),
    `${pairs} pixel pairs`,
    'mean rgb',
    mean(src, mask).join(' '),
    'to',
    mean(out, mask).join(' '),
    `(ChatGPT ${mean(dst, mask).join(' ')})`,
    `${glowing} glowing pixels kept`,
  );
}
await io.write(cfg.out, doc);
console.log('WROTE', cfg.out, fs.statSync(cfg.out).size);
