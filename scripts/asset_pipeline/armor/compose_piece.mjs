// Per-piece variant atlas compositor.
//
// From a Tripo /models/texture output (UV-preserving repaint, one baseColor
// texture per mesh, painted in the ORIGINAL material's shared UV space), copy
// ONE named piece's texels onto that piece's base atlas. The result is a
// drop-in atlas for that piece's material: base art everywhere, the theme only
// inside the piece's own UV islands, so per-piece variants mix freely even
// when several pieces share one material atlas.
//
// Usage:
//   node compose_piece.mjs <original.glb> <textured.glb> <pieceNode> <out.png>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [origPath, texturedPath, pieceName, outPath] = process.argv.slice(2);
if (!outPath) {
  console.error('usage: compose_piece.mjs <original.glb> <textured.glb> <pieceNode> <out.png>');
  process.exit(2);
}
const sharp = (await import('sharp')).default;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

function findPiece(doc, name, { fallbackSingle } = {}) {
  const meshNodes = [];
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue;
    meshNodes.push(node);
    if (node.getName() !== name) continue;
    const prim = node.getMesh().listPrimitives()[0];
    return { node, prim, mat: prim.getMaterial() };
  }
  // Tripo merges single-material inputs (the manual-rig 'body' mesh) into one
  // node; its one texture is painted across the full shared UV space, so it
  // serves every piece (coverage comes from the ORIGINAL piece UVs).
  if (fallbackSingle && meshNodes.length === 1) {
    const prim = meshNodes[0].getMesh().listPrimitives()[0];
    return { node: meshNodes[0], prim, mat: prim.getMaterial() };
  }
  throw new Error(`piece node "${name}" not found`);
}

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

/** Grow the mask by r texels (seam padding inside the island gutters). */
function dilateMask(mask, W, H, r) {
  for (let pass = 0; pass < r; pass++) {
    const src = mask.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (src[y * W + x]) continue;
        if (
          (x > 0 && src[y * W + x - 1]) ||
          (x < W - 1 && src[y * W + x + 1]) ||
          (y > 0 && src[(y - 1) * W + x]) ||
          (y < H - 1 && src[(y + 1) * W + x])
        ) {
          mask[y * W + x] = 1;
        }
      }
    }
  }
}

const orig = await io.read(origPath);
const textured = await io.read(texturedPath);
const origPiece = findPiece(orig, pieceName);
const texPiece = findPiece(textured, pieceName, { fallbackSingle: true });

const baseImg = origPiece.mat?.getBaseColorTexture()?.getImage();
if (!baseImg) throw new Error(`no base atlas on material of piece "${pieceName}"`);
const meta = await sharp(Buffer.from(baseImg)).metadata();
const W = meta.width;
const H = meta.height;
const out = await sharp(Buffer.from(baseImg)).ensureAlpha().raw().toBuffer();

const partImg = texPiece.mat?.getBaseColorTexture()?.getImage();
if (!partImg) throw new Error(`no repainted texture on piece "${pieceName}"`);
const raw = await sharp(Buffer.from(partImg))
  .resize(W, H, { fit: 'fill' })
  .ensureAlpha()
  .raw()
  .toBuffer();

// Coverage always comes from the ORIGINAL piece's UVs (the repaint preserves
// the UV layout, and the original prim is the authoritative island set even
// when Tripo welded the textured output into one mesh). Read per element:
// getElement() de-normalizes quantized (KHR_mesh_quantization) accessors,
// where getArray() would return raw uint16s and put every triangle off-atlas.
const uvAcc = origPiece.prim.getAttribute('TEXCOORD_0');
const uv = new Float32Array(uvAcc.getCount() * 2);
{
  const el = [0, 0];
  for (let i = 0; i < uvAcc.getCount(); i++) {
    uvAcc.getElement(i, el);
    uv[i * 2] = el[0];
    uv[i * 2 + 1] = el[1];
  }
}
const idxAcc = origPiece.prim.getIndices();
const indices = idxAcc ? Array.from(idxAcc.getArray()) : null;
const mask = new Uint8Array(W * H);
rasterizeUVCoverage(uv, indices, W, H, mask);
dilateMask(mask, W, H, 2);

let copied = 0;
for (let p = 0; p < W * H; p++) {
  if (!mask[p]) continue;
  const o = p * 4;
  out[o] = raw[o];
  out[o + 1] = raw[o + 1];
  out[o + 2] = raw[o + 2];
  out[o + 3] = 255;
  copied++;
}
await sharp(out, { raw: { width: W, height: H, channels: 4 } })
  .png()
  .toFile(outPath);
console.log(`composed ${pieceName}: ${copied} texels (${W}x${H}) -> ${outPath}`);
