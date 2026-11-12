// Builds the WOC head library's `mullet` hairstyle for both head types, straight into the
// split file the catalog names (woc_head_catalog.ts wocHeadPieceUrl: head_type_<t>_hair_mullet.glb).
//
// Unlike every other hairstyle, this one does not come out of the Face Studio head files
// (woc_head_pack.py, maintainer-local). It is put together here, from files in the repo:
//
//   the TOP   the shipped mohawk's own strands (head_type_a_hair_mohawk.glb), short and spiky,
//             carried onto the type's head (Type B has no mohawk file: the strands move by the
//             offset between the two heads, MULLET_FIT.b.topPlace);
//   the TAIL  the back of a Tripo text-to-model sculpt (mullet_src/tripo_mullet_raw.glb,
//             H-series, generated 2026-11-10 as a long curly mullet wig). The sculpt arrives
//             fused to a blank mannequin head with hair all the way round, so only a sector at
//             the back is kept, from under the mohawk's nape down to the shoulder line.
//
// What the build does, per type:
//   1. fits the sculpt onto the type's head in the rig's rest pose (MULLET_FIT: a similarity
//      per type, found by eye so the mannequin's face sits just inside the real one);
//   2. drops the mannequin: every triangle whose three corners lie on or inside the type's base
//      head (signed distance under HEAD_MARGIN to the head_type_<t>_core.glb base mesh);
//   3. cuts the tail: the sculpt is clipped (triangles split on the cut, not dropped whole) to
//      a sector at the back, below the tail line and above the shoulder line, which also takes
//      off the curled ends;
//   4. lays the tail on the neck: the sculpt's hair stands off its mannequin's neck, so the
//      kept part is drawn in toward the nape and leans forward as it falls (hugTail);
//   5. paints the tail with the mohawk's texture: its uvs are laid over the one broad strand
//      panel of that atlas (TAIL_PANEL), across the head in u and down the fall in v, so the
//      whole style samples one texture and tints as one material;
//   6. hangs it where a hairstyle hangs: the type's `undercut` file gives the rig hierarchy and
//      the node under `head`; its strands and scalp cap are replaced by the one new primitive;
//   7. finishes like the pack's compress step (woc_head_pack_compress.mjs): WOC_lod levels
//      against the fit's pinned anatomyTop, meshopt at 'high', the written file read back and
//      every level held to the deviation it records.
//
//   node scripts/assets/woc_character/build_mullet_hair.mjs [--type a|b] [--out-dir <dir>]
//     [--fit '<json>']
//
// Every input is a committed file and nothing is encoded (the texture is the mohawk's KTX2,
// byte for byte), so a rebuild needs no tool outside the repo. After one:
// node scripts/build_media_manifest.mjs generate, and re-pin the head rows of
// tests/woc_character_size_budget.test.ts and tests/woc_triangle_budget.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dequantize, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { addLodIndices, LOD_VERIFY_TOLERANCE, verifyLodIndices } from './lod_indices.mjs';
import { keepLodIndices, WocLodExtension } from './woc_lod_extension.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const HEAD_DIR = path.join(ROOT, 'public', 'models', 'chars', 'players', 'woc');
const RAW = path.join(SCRIPT_DIR, 'mullet_src', 'tripo_mullet_raw.glb');
export const MULLET_ID = 'mullet';
/** The hairstyle whose file gives the rig hierarchy and the node under `head`. */
const TEMPLATE_ID = 'undercut';
/** The hairstyle whose Type A strands are the top, and whose texture the whole style samples. */
export const MULLET_TOP_ID = 'mohawk';
const HEAD_TYPE_FIT = { a: 'male', b: 'female' };
/** A corner this close outside the base head (rig units) still counts as the mannequin. */
const HEAD_MARGIN = 0.004;
/**
 * The broad strand panel of the mohawk's atlas (uv, v down the image) the tail is painted
 * with: the one island wide enough to lay a whole fall of hair over, its strands running in v.
 * Held a few texels inside the island's edge, so no tap or mip level reaches the background.
 */
export const TAIL_PANEL = { u0: 0.05, u1: 0.215, v0: 0.47, v1: 0.58 };

/**
 * Per head type, where each part sits in the rig's rest pose. The sculpt's own space is a
 * unit-tall box about its origin, y up, turned here so its face looks down +z.
 *   scale, top, cx, cz   the sculpt: uniform scale, the world y of its top, its origin's x, z
 *   tailY, backY         sculpt-space heights the tail starts under and is clipped to
 *   napeY                the height of the top's nape: the tail's root runs from tailY down
 *                        to here inside the top, and is seen from here down
 *   keepDeg, cutDeg      half-angles from straight back: the tail is whole inside keepDeg and
 *                        gone outside cutDeg, its upper edge easing down between them
 *   hug, rise            how far the tail comes forward at napeY, and how much more per unit
 *                        of height above it
 *   lean, curl           how it leans forward as it falls below napeY (linear and squared in
 *                        the drop), sculpt units
 *   narrow               how much the tail narrows per unit of drop below napeY
 *   tuck, tuckDrop       how much narrower the tail is drawn round the nape and above, easing
 *                        back to the sculpt's own width over this much drop
 *   topPlace             the mohawk strands: an offset from their Type A place, and a scale
 *                        about their middle that clears a scalp no mohawk tuck pulls in
 */
export const MULLET_FIT = {
  a: {
    scale: 0.29,
    top: 1.214,
    cx: 0,
    cz: 0,
    tailY: 0.25,
    napeY: 0.04,
    backY: -0.4,
    keepDeg: 50,
    cutDeg: 78,
    hug: 0.045,
    rise: 0.55,
    lean: 0.2,
    curl: 0.3,
    narrow: 0.12,
    tuck: 0.2,
    tuckDrop: 0.2,
    topPlace: { dx: 0, dy: 0, dz: 0, inflate: 1.02 },
  },
  b: {
    scale: 0.29,
    top: 1.226,
    cx: 0.0115,
    cz: -0.037,
    tailY: 0.25,
    napeY: 0.04,
    backY: -0.4,
    keepDeg: 50,
    cutDeg: 78,
    hug: 0.045,
    rise: 0.55,
    lean: 0.2,
    curl: 0.3,
    narrow: 0.12,
    tuck: 0.2,
    tuckDrop: 0.2,
    topPlace: { dx: 0.0118, dy: 0.016, dz: -0.037, inflate: 1.06 },
  },
};

function parseArgs(argv) {
  const opts = { types: ['a', 'b'], outDir: HEAD_DIR, fit: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--type') opts.types = [argv[++i]];
    else if (a === '--out-dir') opts.outDir = path.resolve(argv[++i]);
    else if (a === '--fit') opts.fit = JSON.parse(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  for (const t of opts.types) if (!MULLET_FIT[t]) throw new Error(`unknown head type ${t}`);
  return opts;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Degrees round the head from straight back, 0 to 180, in the sculpt's space. */
const degFromBack = (m) => (Math.abs(Math.atan2(m[0], -m[2])) * 180) / Math.PI;

/** The sculpt's vertices in its own space, face down +z (the raw file faces +x). */
export function readSculpt(doc) {
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION');
  const nor = prim.getAttribute('NORMAL');
  const vertices = [];
  for (let k = 0; k < pos.getCount(); k++) {
    const p = pos.getElement(k, []);
    const n = nor.getElement(k, []);
    vertices.push({ m: [-p[2], p[1], p[0]], n: [-n[2], n[1], n[0]] });
  }
  return { vertices, indices: Uint32Array.from(prim.getIndices().getArray()) };
}

/** A node's primitives in world space (the rig's rest pose), each a triangle soup of
 *  { p, n, t } corners. */
function worldSoup(node) {
  const m = node.getWorldMatrix();
  const at = (v, w) =>
    [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);
  return node
    .getMesh()
    .listPrimitives()
    .map((prim) => {
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const uv = prim.getAttribute('TEXCOORD_0');
      const corners = [];
      for (const k of prim.getIndices().getArray()) {
        const n = nor ? at(nor.getElement(k, []), 0) : [0, 1, 0];
        const len = Math.hypot(n[0], n[1], n[2]) || 1;
        corners.push({
          p: at(pos.getElement(k, []), 1),
          n: [n[0] / len, n[1] / len, n[2] / len],
          t: uv ? uv.getElement(k, []) : [0, 0],
        });
      }
      return { material: prim.getMaterial(), corners };
    });
}

/** The closest point of triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(p, [a, b, c]) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den;
  const w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

/** Signed distance from p to a closed-enough triangle mesh: negative inside. */
function signedDistance(p, triangles, normals) {
  let best = Infinity;
  let sign = 1;
  for (let k = 0; k < triangles.length; k++) {
    const d = sub(p, closestOnTriangle(p, triangles[k]));
    const d2 = dot(d, d);
    if (d2 < best) {
      best = d2;
      sign = Math.sign(dot(d, normals[k])) || 1;
    }
  }
  return sign * Math.sqrt(best);
}

/** The tail's upper edge at a point of the sculpt: tailY at the back, falling away to the
 *  shoulder line (nothing kept) by cutDeg. */
function tailCeiling(m, fit) {
  return fit.tailY - (fit.tailY - fit.backY) * smoothstep(fit.keepDeg, fit.cutDeg, degFromBack(m));
}

/**
 * A sculpt-space point of the tail, moved so the tail carries on the line of the top's back.
 * The sculpt's hair stands well off its mannequin, so every point comes forward: by `hug` at
 * the nape line, where the tail must sit just proud of the top's nape; by more above it
 * (`rise`), so the root runs up INSIDE the top and the tail comes out through its surface with
 * no edge of its own showing; and by more below it (`lean`, `curl`), so the fall settles toward
 * the neck instead of hanging off it. Round the nape it is also drawn in sideways (`tuck`),
 * the sculpt being wider there than the top, and it narrows a little toward its ends.
 */
export function hugTail(m, fit) {
  const above = Math.max(0, m[1] - fit.napeY);
  const below = Math.max(0, fit.napeY - m[1]);
  const forward = fit.hug + fit.rise * above + fit.lean * below + fit.curl * below * below;
  const tuck = 1 - fit.tuck * smoothstep(fit.napeY - fit.tuckDrop, fit.napeY + 0.06, m[1]);
  return [m[0] * tuck * (1 - fit.narrow * below), m[1], m[2] + forward];
}

/** Where a sculpt-space point sits in the rig's rest pose. */
function placeSculpt(m, fit) {
  return [fit.cx + m[0] * fit.scale, fit.top + (m[1] - 0.5) * fit.scale, fit.cz + m[2] * fit.scale];
}

/** The tail's uv at a sculpt-space point: across the kept sector in u, down the fall in v. */
export function tailUv(m, fit) {
  const deg = (Math.atan2(m[0], -m[2]) * 180) / Math.PI;
  const side = Math.min(1, Math.max(-1, deg / fit.cutDeg));
  const fall = Math.min(1, Math.max(0, (fit.tailY - m[1]) / (fit.tailY - fit.backY)));
  return [
    TAIL_PANEL.u0 + (TAIL_PANEL.u1 - TAIL_PANEL.u0) * (side * 0.5 + 0.5),
    TAIL_PANEL.v0 + (TAIL_PANEL.v1 - TAIL_PANEL.v0) * fall,
  ];
}

/**
 * The tail: the sculpt fitted, the mannequin dropped, the back sector cut out and laid on the
 * neck, in world space, as a triangle soup of { m, p, n, t } (weld joins it again). `m` is the
 * corner's place in the sculpt before the tail was drawn in.
 */
export function cutTail(sculpt, fit, headTriangles) {
  const headNormals = headTriangles.map(([a, b, c]) => cross(sub(b, a), sub(c, a)));
  const placed = sculpt.vertices.map((v) => ({
    ...v,
    onHead: signedDistance(placeSculpt(v.m, fit), headTriangles, headNormals) < HEAD_MARGIN,
  }));
  const lerp = (a, b, s) => {
    const mix = (key) => a[key].map((x, c) => x + (b[key][c] - x) * s);
    return { m: mix('m'), n: mix('n') };
  };
  /** Sutherland-Hodgman against one curved field: the crossing is found by bisection. */
  const clip = (poly, kept) => {
    const out = [];
    for (let e = 0; e < poly.length; e++) {
      const a = poly[e];
      const b = poly[(e + 1) % poly.length];
      const ka = kept(a);
      if (ka) out.push(a);
      if (ka !== kept(b)) {
        let lo = 0;
        let hi = 1;
        for (let s = 0; s < 14; s++) {
          const mid = (lo + hi) / 2;
          if (kept(lerp(a, b, mid)) === ka) lo = mid;
          else hi = mid;
        }
        out.push(lerp(a, b, (lo + hi) / 2));
      }
    }
    return out;
  };
  const underCeiling = (v) => v.m[1] <= tailCeiling(v.m, fit);
  const aboveShoulders = (v) => v.m[1] >= fit.backY;
  const soup = [];
  let mannequin = 0;
  for (let k = 0; k < sculpt.indices.length; k += 3) {
    const tri = [0, 1, 2].map((c) => placed[sculpt.indices[k + c]]);
    if (tri.every((v) => v.onHead)) {
      mannequin++;
      continue;
    }
    const poly = clip(clip(tri, underCeiling), aboveShoulders);
    for (let e = 1; e + 1 < poly.length; e++) {
      for (const v of [poly[0], poly[e], poly[e + 1]]) {
        const len = Math.hypot(v.n[0], v.n[1], v.n[2]) || 1;
        soup.push({
          m: v.m,
          p: placeSculpt(hugTail(v.m, fit), fit),
          n: [v.n[0] / len, v.n[1] / len, v.n[2] / len],
          t: tailUv(v.m, fit),
        });
      }
    }
  }
  return { soup: dropLooseBits(soup), mannequin };
}

/** Triangle islands smaller than this are curl ends the cut left hanging in the air. */
const LOOSE_BIT_TRIANGLES = 40;

/** A soup without its small islands (corners joined where their sculpt points coincide). */
function dropLooseBits(soup) {
  const ids = new Map();
  const parent = [];
  const find = (a) => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== r) [parent[a], a] = [r, parent[a]];
    return r;
  };
  const corner = soup.map((v) => {
    const key = v.m.map((x) => Math.round(x * 1e5)).join(',');
    if (!ids.has(key)) {
      ids.set(key, parent.length);
      parent.push(parent.length);
    }
    return ids.get(key);
  });
  for (let k = 0; k < soup.length; k += 3) {
    parent[find(corner[k + 1])] = find(corner[k]);
    parent[find(corner[k + 2])] = find(corner[k]);
  }
  const size = new Map();
  for (let k = 0; k < soup.length; k += 3) {
    const island = find(corner[k]);
    size.set(island, (size.get(island) ?? 0) + 1);
  }
  return soup.filter((_v, k) => size.get(find(corner[k - (k % 3)])) >= LOOSE_BIT_TRIANGLES);
}

/** The mohawk's strands on a type's head: scaled about their own middle, then moved by the
 *  type's offset from Type A. */
export function placeTop(corners, place) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const c of corners) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], c.p[a]);
      hi[a] = Math.max(hi[a], c.p[a]);
    }
  }
  const mid = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
  const offset = [place.dx, place.dy, place.dz];
  return corners.map((c) => ({
    ...c,
    p: c.p.map((x, a) => mid[a] + (x - mid[a]) * place.inflate + offset[a]),
  }));
}

/** The inverse of an affine 4x4 (column major), applied to points and to directions. */
export function invertAffine(m) {
  const a = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const det =
    a[0] * (a[4] * a[8] - a[5] * a[7]) -
    a[1] * (a[3] * a[8] - a[5] * a[6]) +
    a[2] * (a[3] * a[7] - a[4] * a[6]);
  const inv = [
    (a[4] * a[8] - a[5] * a[7]) / det,
    (a[2] * a[7] - a[1] * a[8]) / det,
    (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det,
    (a[0] * a[8] - a[2] * a[6]) / det,
    (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det,
    (a[1] * a[6] - a[0] * a[7]) / det,
    (a[0] * a[4] - a[1] * a[3]) / det,
  ];
  const t = [m[12], m[13], m[14]];
  const apply = (d) =>
    [0, 1, 2].map((r) => inv[r * 3] * d[0] + inv[r * 3 + 1] * d[1] + inv[r * 3 + 2] * d[2]);
  return {
    point: (p) => apply(sub(p, t)),
    direction: (n) => {
      const d = apply(n);
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      return [d[0] / len, d[1] / len, d[2] / len];
    },
  };
}

/** The triangles of a head type's base head in world space (the rig's rest pose). */
export async function readHeadTriangles(io, type) {
  const core = await io.read(path.join(HEAD_DIR, `head_type_${type}_core.glb`));
  const base = core
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === `WocHead_${type.toUpperCase()}_base`);
  if (!base) throw new Error(`head type ${type}: no base head in the core file`);
  const triangles = [];
  for (const { corners } of worldSoup(base)) {
    for (let k = 0; k < corners.length; k += 3) {
      triangles.push([corners[k].p, corners[k + 1].p, corners[k + 2].p]);
    }
  }
  return triangles;
}

/** A signed-distance probe of a triangle mesh (negative inside): p -> distance. */
export function distanceProbe(triangles) {
  const normals = triangles.map(([a, b, c]) => cross(sub(b, a), sub(c, a)));
  return (p) => signedDistance(p, triangles, normals);
}

/**
 * Writes one in-repo hairstyle's file for a head type: `soup` (world-space corners of
 * { p, n, t }) becomes the one primitive of `WocHead_<T>_hair_<id>`, hung where the template
 * hairstyle hangs, on `top`'s texture and roughness, then finished like the pack's compress
 * step (WOC_lod levels, meshopt, the written file read back and every level checked).
 */
export async function writeHairPiece(io, type, id, soup, top, outDir) {
  const T = type.toUpperCase();
  const doc = await io.read(path.join(HEAD_DIR, `head_type_${type}_hair_${TEMPLATE_ID}.glb`));
  await doc.transform(dequantize());
  const root = doc.getRoot();
  const node = root.listNodes().find((n) => n.getName() === `WocHead_${T}_hair_${TEMPLATE_ID}`);
  if (!node) throw new Error(`head type ${type}: the template has no ${TEMPLATE_ID} piece`);
  const mesh = node.getMesh();
  const [strands, ...others] = mesh.listPrimitives();
  for (const other of others) {
    mesh.removePrimitive(other);
    other.dispose();
  }

  const local = invertAffine(node.getWorldMatrix());
  const buffer = root.listBuffers()[0];
  const accessor = (kind, array) =>
    doc.createAccessor().setType(kind).setArray(array).setBuffer(buffer);
  for (const semantic of strands.listSemantics()) strands.setAttribute(semantic, null);
  strands
    .setAttribute(
      'POSITION',
      accessor('VEC3', new Float32Array(soup.flatMap((v) => local.point(v.p)))),
    )
    .setAttribute(
      'NORMAL',
      accessor('VEC3', new Float32Array(soup.flatMap((v) => local.direction(v.n)))),
    )
    .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(soup.flatMap((v) => v.t))))
    .setIndices(accessor('SCALAR', Uint32Array.from(soup.keys())));

  node.setName(`WocHead_${T}_hair_${id}`);
  mesh.setName(`WocHead_${T}_hair_${id}`);
  const paint = doc
    .createTexture(top.texture.name)
    .setImage(top.texture.image)
    .setMimeType(top.texture.mimeType)
    .setURI(`${top.texture.name}.ktx2`);
  strands
    .getMaterial()
    .setName(`hair_${id}`)
    .setRoughnessFactor(top.roughness)
    .setBaseColorTexture(paint);
  doc.createExtension(KHRTextureBasisu).setRequired(true);

  await doc.transform(weld(), prune({ keepLeaves: true }));
  const height = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'export_split.json'), 'utf8'))
    .anatomyTop[HEAD_TYPE_FIT[type]];
  const lod = await addLodIndices(doc, { height });
  const step = meshopt({ encoder: MeshoptEncoder, level: 'high' });
  await doc.transform(keepLodIndices([step], { encoder: MeshoptEncoder }));
  const out = await io.writeBinary(doc);
  const check = verifyLodIndices(await io.readBinary(out), {
    tolerance: LOD_VERIFY_TOLERANCE * height,
  });
  if (check.failures.length) {
    throw new Error(`WOC_lod levels fail their check:\n  ${check.failures.join('\n  ')}`);
  }
  const file = path.join(outDir, `head_type_${type}_hair_${id}.glb`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, out);
  return { type, file: path.relative(ROOT, file), bytes: out.length, lod: lod.totals };
}

async function buildType(io, type, sculpt, top, fit, outDir) {
  const tail = cutTail(sculpt, fit, await readHeadTriangles(io, type));
  const soup = [...placeTop(top.corners, fit.topPlace), ...tail.soup];
  const written = await writeHairPiece(io, type, MULLET_ID, soup, top, outDir);
  return {
    type,
    file: written.file,
    bytes: written.bytes,
    mannequinTriangles: tail.mannequin,
    topTriangles: top.corners.length / 3,
    tailTriangles: tail.soup.length / 3,
    lod: written.lod,
  };
}

/** The mohawk's Type A strands in world space, with the texture the whole style samples. */
export async function readTop(io) {
  const doc = await io.read(path.join(HEAD_DIR, `head_type_a_hair_${MULLET_TOP_ID}.glb`));
  await doc.transform(dequantize());
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === `WocHead_A_hair_${MULLET_TOP_ID}`);
  if (!node) throw new Error(`no ${MULLET_TOP_ID} piece in the Type A file`);
  const [strands, ...others] = worldSoup(node);
  if (others.length) throw new Error(`the ${MULLET_TOP_ID} file grew a second primitive`);
  const texture = strands.material.getBaseColorTexture();
  return {
    corners: strands.corners,
    roughness: strands.material.getRoughnessFactor(),
    texture: {
      name: texture.getName(),
      image: texture.getImage(),
      mimeType: texture.getMimeType(),
    },
  };
}

/** A NodeIO that reads and writes the head files (meshopt, the WOC_lod extension). */
export async function headFileIo() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, WocLodExtension])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const io = await headFileIo();
  const sculpt = readSculpt(await io.read(RAW));
  const top = await readTop(io);
  const built = [];
  for (const type of opts.types) {
    const fit = { ...MULLET_FIT[type], ...opts.fit };
    built.push(await buildType(io, type, sculpt, top, fit, opts.outDir));
  }
  console.log(JSON.stringify({ built }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
