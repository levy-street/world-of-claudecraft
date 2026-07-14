// Real AI-generated texture-swap skins via Tripo.
//
// Tripo's texture task (POST /v3/models/texture, bake:true) re-paints a model
// while PRESERVING its UV layout, but it splits the model's single palette
// material into one baseColor texture PER skinned mesh (the knight has 9). Each
// part texture is painted in the SAME shared UV space as the game's default
// atlas, so compositing every part's texels back into one atlas yields a genuine
// DROP-IN skin: same UVs, same dims, applied by the game's mat.map swap with
// zero sim/wire changes. This is real spatially-varying AI art, not a recolor.
//
// The compositor rasterizes each mesh's UV triangles into a coverage mask and
// copies only that mesh's texels (largest mesh first, accessories on top), so
// overlapping palette swatches resolve by part instead of washing out (which a
// naive max-blend does on multi-tone themes).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

let ioPromise = null;
async function io() {
  if (!ioPromise) {
    ioPromise = (async () => {
      await MeshoptDecoder.ready;
      return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    })();
  }
  return ioPromise;
}

/** Decode an image buffer to raw RGBA at WxH. */
async function decodeToRaw(sharp, buf, W, H) {
  const { data } = await sharp(buf)
    .resize(W, H, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data; // Uint8, length W*H*4
}

/** Rasterize a set of UV triangles into a boolean coverage mask (WxH). UVs are
 *  in [0,1]; texel (x,y) maps to UV (x/W, y/H) (flipY=false game convention). */
function rasterizeUVCoverage(uv, indices, W, H, mask) {
  const tri = indices ?? [...Array(uv.length / 2).keys()];
  const px = (i) => uv[i * 2] * W;
  const py = (i) => uv[i * 2 + 1] * H;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t];
    const b = tri[t + 1];
    const c = tri[t + 2];
    const ax = px(a);
    const ay = py(a);
    const bx = px(b);
    const by = py(b);
    const cx = px(c);
    const cy = py(c);
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    const inv = 1 / area;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const sx = x + 0.5;
        const sy = y + 0.5;
        const w0 = ((bx - sx) * (cy - sy) - (cx - sx) * (by - sy)) * inv;
        const w1 = ((cx - sx) * (ay - sy) - (ax - sx) * (cy - sy)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 >= -0.001 && w1 >= -0.001 && w2 >= -0.001) mask[y * W + x] = 1;
      }
    }
  }
}

/** Grow the covered region by `r` texels (fills seams/gaps between UV islands so
 *  bilinear sampling at edges does not bleed the untouched base). */
function dilate(out, W, H, r) {
  for (let pass = 0; pass < r; pass++) {
    const src = out.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (src[i + 3] !== 0) continue;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = (ny * W + nx) * 4;
          if (src[j + 3] !== 0) {
            out[i] = src[j];
            out[i + 1] = src[j + 1];
            out[i + 2] = src[j + 2];
            out[i + 3] = 255;
            break;
          }
        }
      }
    }
  }
}

/** Composite a Tripo-textured GLB's per-part baseColor textures into one drop-in
 *  atlas in the shared UV layout, at the base atlas's exact dimensions + alpha. */
export async function compositeAtlasFromTextured(texturedGlbPath, baseAtlasPath, outPath) {
  const sharp = (await import('sharp')).default;
  const doc = await (await io()).read(texturedGlbPath);
  const baseMeta = await sharp(baseAtlasPath).metadata();
  const W = baseMeta.width;
  const H = baseMeta.height;

  // Collect (primitive, part-texture, uv-area) for every textured mesh.
  const parts = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const tex = mat?.getBaseColorTexture();
      const uvAcc = prim.getAttribute('TEXCOORD_0');
      if (!tex || !uvAcc) continue;
      const uv = uvAcc.getArray();
      const idxAcc = prim.getIndices();
      const indices = idxAcc ? Array.from(idxAcc.getArray()) : null;
      // UV-space area as the draw-order key (biggest part painted first).
      let uarea = 0;
      const tri = indices ?? [...Array(uv.length / 2).keys()];
      for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t];
        const b = tri[t + 1];
        const c = tri[t + 2];
        uarea += Math.abs(
          (uv[b * 2] - uv[a * 2]) * (uv[c * 2 + 1] - uv[a * 2 + 1]) -
            (uv[c * 2] - uv[a * 2]) * (uv[b * 2 + 1] - uv[a * 2 + 1]),
        );
      }
      parts.push({ img: Buffer.from(tex.getImage()), uv, indices, uarea });
    }
  }
  if (!parts.length) throw new Error('no textured parts found in the Tripo output');
  parts.sort((a, b) => b.uarea - a.uarea); // largest first, accessories overlay

  const out = Buffer.alloc(W * H * 4); // transparent
  const mask = new Uint8Array(W * H);
  for (const part of parts) {
    mask.fill(0);
    rasterizeUVCoverage(part.uv, part.indices, W, H, mask);
    const raw = await decodeToRaw(sharp, part.img, W, H);
    for (let p = 0; p < W * H; p++) {
      if (!mask[p]) continue;
      const o = p * 4;
      out[o] = raw[o];
      out[o + 1] = raw[o + 1];
      out[o + 2] = raw[o + 2];
      out[o + 3] = 255;
    }
  }
  dilate(out, W, H, 4);

  // Stamp the base atlas's alpha channel so dims + alpha match exactly.
  const baseRaw = await sharp(baseAtlasPath)
    .resize(W, H, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (let p = 0; p < W * H; p++) {
    const a = baseRaw[p * 4 + 3];
    out[p * 4 + 3] = a;
    if (a === 0) {
      out[p * 4] = 0;
      out[p * 4 + 1] = 0;
      out[p * 4 + 2] = 0;
    }
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(outPath);
  return { out: outPath, parts: parts.length, width: W, height: H };
}
