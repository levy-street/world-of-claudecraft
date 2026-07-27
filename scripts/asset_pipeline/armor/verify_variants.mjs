// Exhaustive verification of the per-piece variant atlases.
// For EVERY (character, piece, theme) in the manifest:
//   1. the atlas PNG exists and matches the base atlas dimensions,
//   2. pixels INSIDE the piece's UV islands differ from base (the variant is
//      really painted, not a silent base-only copy),
//   3. pixels OUTSIDE the islands equal base (so per-piece mixing is safe).
// Exits 1 on any failure. Run from repo root.
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const DIR = 'tmp/asset_pipeline/armor_picker';
const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8'));
const sharp = (await import('sharp')).default;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

function rasterize(uv, indices, W, H) {
  const mask = new Uint8Array(W * H);
  const tri = indices ?? [...Array(uv.length / 2).keys()];
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
    const ax = uv[a * 2] * W;
    const ay = uv[a * 2 + 1] * H;
    const bx = uv[b * 2] * W;
    const by = uv[b * 2 + 1] * H;
    const cx = uv[c * 2] * W;
    const cy = uv[c * 2 + 1] * H;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    const inv = 1 / area;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const sx = x + 0.5;
        const sy = y + 0.5;
        const w0 = ((bx - sx) * (cy - sy) - (cx - sx) * (by - sy)) * inv;
        const w1 = ((cx - sx) * (ay - sy) - (ax - sx) * (cy - sy)) * inv;
        if (w0 >= -0.001 && w1 >= -0.001 && 1 - w0 - w1 >= -0.001) mask[y * W + x] = 1;
      }
  }
  return mask;
}
function grow(mask, W, H, r) {
  for (let p = 0; p < r; p++) {
    const src = mask.slice();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (src[y * W + x]) continue;
        if (
          (x > 0 && src[y * W + x - 1]) ||
          (x < W - 1 && src[y * W + x + 1]) ||
          (y > 0 && src[(y - 1) * W + x]) ||
          (y < H - 1 && src[(y + 1) * W + x])
        )
          mask[y * W + x] = 1;
      }
  }
  return mask;
}

let pass = 0;
let fail = 0;
const failures = [];
for (const [char, def] of Object.entries(manifest.chars)) {
  const doc = await io.read(`${DIR}/${def.glb}`);
  const nodes = new Map();
  for (const n of doc.getRoot().listNodes()) if (n.getMesh()) nodes.set(n.getName(), n);
  for (const [piece, meta] of Object.entries(def.pieces)) {
    const node = nodes.get(piece);
    const prim = node.getMesh().listPrimitives()[0];
    const baseImg = prim.getMaterial().getBaseColorTexture().getImage();
    const baseMeta = await sharp(Buffer.from(baseImg)).metadata();
    const W = baseMeta.width;
    const H = baseMeta.height;
    const baseRaw = await sharp(Buffer.from(baseImg)).ensureAlpha().raw().toBuffer();
    const uvAcc = prim.getAttribute('TEXCOORD_0');
    const uv = new Float32Array(uvAcc.getCount() * 2);
    const el = [0, 0];
    for (let i = 0; i < uvAcc.getCount(); i++) {
      uvAcc.getElement(i, el);
      uv[i * 2] = el[0];
      uv[i * 2 + 1] = el[1];
    }
    const idx = prim.getIndices();
    const inner = rasterize(uv, idx ? Array.from(idx.getArray()) : null, W, H);
    // outside test uses a padded mask (compositor dilates 2px for seams)
    const padded = grow(inner.slice(), W, H, 3);
    const themes = Object.entries(meta.variants);
    if (themes.length !== manifest.themes.length) {
      fail++;
      failures.push(`${char}/${piece}: only ${themes.length}/${manifest.themes.length} themes`);
      continue;
    }
    for (const [theme, rel] of themes) {
      try {
        const varMeta = await sharp(`${DIR}/${rel}`).metadata();
        if (varMeta.width !== W || varMeta.height !== H) throw new Error(`dims ${varMeta.width}x${varMeta.height} != ${W}x${H}`);
        const varRaw = await sharp(`${DIR}/${rel}`).ensureAlpha().raw().toBuffer();
        let inChanged = 0;
        let inTotal = 0;
        let outChanged = 0;
        for (let p = 0; p < W * H; p++) {
          const d =
            Math.abs(varRaw[p * 4] - baseRaw[p * 4]) +
            Math.abs(varRaw[p * 4 + 1] - baseRaw[p * 4 + 1]) +
            Math.abs(varRaw[p * 4 + 2] - baseRaw[p * 4 + 2]);
          if (inner[p]) {
            inTotal++;
            if (d > 24) inChanged++;
          } else if (!padded[p] && d > 24) outChanged++;
        }
        const inPct = (100 * inChanged) / Math.max(1, inTotal);
        const outPct = (100 * outChanged) / (W * H);
        if (inPct < 8) throw new Error(`only ${inPct.toFixed(1)}% of piece texels differ from base (variant missing?)`);
        if (outPct > 0.5) throw new Error(`${outPct.toFixed(2)}% of NON-piece texels differ (would corrupt other pieces)`);
        pass++;
        console.log(`PASS ${char}/${piece}/${theme}: ${inPct.toFixed(0)}% piece texels repainted, outside clean`);
      } catch (err) {
        fail++;
        failures.push(`${char}/${piece}/${theme}: ${err.message}`);
      }
    }
  }
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
