// Level-of-detail index lists for the WOC character files (the 2026-10-03 character LOD build),
// written as the WOC_lod extension (woc_lod_extension.mjs, which also holds the file contract).
//
// The settings are the ones the 2026-10-03 LOD study measured on these meshes
// (tmp/size_lab/lod/simplify_lib.mjs buildBounded in the character-pack worktree):
// - every level is ONLY a new index list over the primitive's own vertices, from meshoptimizer's
//   simplifyWithAttributes with the normal at weight 0.5 and the uv at weight 1.0; uv seams kept
//   (no Permissive flag);
// - each level is the SMALLEST result on a ladder of target shares whose MEASURED deviation
//   (every vertex level 0 draws, to the level's surface, in the character's space) stays within
//   a share of the character's height: MID 0.45% with LockBorder and never under 40% of the
//   triangles, FAR 1.25% with the borders free and no floor. meshoptimizer's own error estimate
//   is not trusted here: it collapsed a chest plate to 6 triangles while reporting 1.2%;
// - a level that would not save at least a tenth of the primitive's triangles is left out, and
//   a far level that cannot beat the mid one reuses it, so a primitive carries [mid, far], [far]
//   alone, or nothing.
//
// Measured in CHARACTER units: each instance's vertices are carried into the scene's space
// (a rigid piece through its node's world matrix, which is where meshopt quantization folds its
// dequantization; a skinned one through its rest-pose skin), so a bound reads the same on a head
// piece, a quantized shoulder and a body. The simplifier runs on the first instance's positions;
// a mesh drawn by several nodes is held to the bound in each.
import { Node, Primitive } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import {
  indexFingerprint,
  listLodPrimitives,
  lodIndexArrayFor,
  WOC_LOD,
  WocLodExtension,
} from './woc_lod_extension.mjs';

/** Target triangle shares a level tries, gentle to aggressive (the study's ladder). */
export const LOD_LADDER = Object.freeze([
  0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.33, 0.27, 0.22, 0.18, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05, 0.04,
  0.03, 0.02, 0.01,
]);

/** The two levels, fine to coarse: `limit` is the measured deviation bound as a share of the
 *  character's height, `floor` the smallest triangle share tried. */
export const LOD_LEVELS = Object.freeze([
  Object.freeze({ name: 'mid', limit: 0.0045, floor: 0.4, lockBorder: true }),
  Object.freeze({ name: 'far', limit: 0.0125, floor: 0, lockBorder: false }),
]);

/** simplifyWithAttributes weights: each normal component, each uv component. */
export const LOD_NORMAL_WEIGHT = 0.5;
export const LOD_UV_WEIGHT = 1.0;
/** A level must save at least this share of its primitive's triangles to be kept. */
export const LOD_MIN_SAVING = 0.1;
/** maxDeviation is written rounded UP to a multiple of 1 / this (a micron on a 1.18 m body). */
export const LOD_DEVIATION_STEPS_PER_UNIT = 1e6;
/** A written file's levels re-measured (verifyLodIndices) may exceed what they record by this
 *  share of the character's height: the meshopt step's vertex quantization moves both the
 *  level-0 vertices and the level's surface by a few hundredths of a millimetre. A level drawn
 *  over the wrong vertices misses by centimetres. */
export const LOD_VERIFY_TOLERANCE = 2e-4;

// --- the character space --------------------------------------------------------------------

/** a glTF column-major mat4 as a row-major 3x4 affine [r0 | t0, r1 | t1, r2 | t2] */
function affineOf(m) {
  return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]];
}

function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** An accessor's elements as plain floats (normalized integers decoded). */
function readFloats(accessor) {
  const n = accessor.getCount();
  const k = accessor.getElementSize();
  const out = new Float32Array(n * k);
  const el = [];
  for (let i = 0; i < n; i++) {
    accessor.getElement(i, el);
    for (let j = 0; j < k; j++) out[i * k + j] = el[j];
  }
  return out;
}

/** Per vertex, the 3x4 that carries it from the primitive's space to the scene's: one for a
 *  rigid instance, the weight-blended joint matrices (rest pose) for a skinned one. */
function vertexAffines(prim, node, count) {
  const skin = node?.getSkin();
  if (!skin) {
    const one = affineOf(node ? node.getWorldMatrix() : IDENTITY);
    return { one, per: null };
  }
  const ibm = skin.getInverseBindMatrices();
  const joints = skin.listJoints().map((joint, k) => {
    const inverse = ibm ? ibm.getElement(k, []) : IDENTITY;
    return affineOf(mul4(joint.getWorldMatrix(), inverse));
  });
  const per = new Float64Array(count * 12);
  const sum = new Float64Array(count);
  const je = [];
  const we = [];
  for (let set = 0; prim.getAttribute(`JOINTS_${set}`); set++) {
    const jAcc = prim.getAttribute(`JOINTS_${set}`);
    const wAcc = prim.getAttribute(`WEIGHTS_${set}`);
    if (!wAcc) throw new Error(`JOINTS_${set} without WEIGHTS_${set}`);
    for (let i = 0; i < count; i++) {
      jAcc.getElement(i, je);
      wAcc.getElement(i, we);
      for (let k = 0; k < je.length; k++) {
        const w = we[k];
        if (!w) continue;
        const m = joints[je[k]];
        if (!m) throw new Error(`a vertex weights joint ${je[k]} of ${joints.length}`);
        for (let e = 0; e < 12; e++) per[i * 12 + e] += w * m[e];
        sum[i] += w;
      }
    }
  }
  for (let i = 0; i < count; i++) {
    const s = sum[i];
    if (!(s > 0)) throw new Error(`skinned vertex ${i} carries no weight`);
    for (let e = 0; e < 12; e++) per[i * 12 + e] /= s;
  }
  return { one: null, per };
}

/** One instance of a primitive in the scene's space: positions, unit normals (zero without
 *  NORMAL), and the linear map a morph delta takes. */
export function characterSpace(prim, node) {
  const posAcc = prim.getAttribute('POSITION');
  const count = posAcc.getCount();
  const local = readFloats(posAcc);
  const nrmAcc = prim.getAttribute('NORMAL');
  const localN = nrmAcc ? readFloats(nrmAcc) : null;
  const { one, per } = vertexAffines(prim, node, count);
  const at = (i) => (per ? per.subarray(i * 12, i * 12 + 12) : one);
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const m = at(i);
    const x = local[i * 3];
    const y = local[i * 3 + 1];
    const z = local[i * 3 + 2];
    pos[i * 3] = m[0] * x + m[1] * y + m[2] * z + m[3];
    pos[i * 3 + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    pos[i * 3 + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
    if (!localN) continue;
    // the inverse transpose of the linear part (its cofactors over the determinant)
    const [a, b, c, , d, e, f, , g, h, k] = m;
    const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
    const nx = localN[i * 3];
    const ny = localN[i * 3 + 1];
    const nz = localN[i * 3 + 2];
    const ox = ((e * k - f * h) * nx - (d * k - f * g) * ny + (d * h - e * g) * nz) / det;
    const oy = (-(b * k - c * h) * nx + (a * k - c * g) * ny - (a * h - b * g) * nz) / det;
    const oz = ((b * f - c * e) * nx - (a * f - c * d) * ny + (a * e - b * d) * nz) / det;
    const len = Math.hypot(ox, oy, oz) || 1;
    nrm[i * 3] = ox / len;
    nrm[i * 3 + 1] = oy / len;
    nrm[i * 3 + 2] = oz / len;
  }
  const linear = (delta) => {
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const m = at(i);
      const x = delta[i * 3];
      const y = delta[i * 3 + 1];
      const z = delta[i * 3 + 2];
      out[i * 3] = m[0] * x + m[1] * y + m[2] * z;
      out[i * 3 + 1] = m[4] * x + m[5] * y + m[6] * z;
      out[i * 3 + 2] = m[8] * x + m[9] * y + m[10] * z;
    }
    return out;
  };
  return { count, pos, nrm, linear };
}

// --- the measured deviation -----------------------------------------------------------------

function closestPointTriSq(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx;
  let qy;
  let qz;
  if (d1 <= 0 && d2 <= 0) {
    qx = ax;
    qy = ay;
    qz = az;
  } else {
    const bpx = px - bx;
    const bpy = py - by;
    const bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) {
      qx = bx;
      qy = by;
      qz = bz;
    } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        qx = ax + v * abx;
        qy = ay + v * aby;
        qz = az + v * abz;
      } else {
        const cpx = px - cx;
        const cpy = py - cy;
        const cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) {
          qx = cx;
          qy = cy;
          qz = cz;
        } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            qx = ax + w * acx;
            qy = ay + w * acy;
            qz = az + w * acz;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              qx = bx + w * (cx - bx);
              qy = by + w * (cy - by);
              qz = bz + w * (cz - bz);
            } else {
              const den = 1 / (va + vb + vc);
              const v = vb * den;
              const w = vc * den;
              qx = ax + abx * v + acx * w;
              qy = ay + aby * v + acy * w;
              qz = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  const dx = px - qx;
  const dy = py - qy;
  const dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

const LEAF = 4;

/** A bounding-volume tree over a triangle list (median splits on the longest centroid axis). */
function buildBvh(pos, ix) {
  const nt = ix.length / 3;
  const tmin = new Float64Array(nt * 3);
  const tmax = new Float64Array(nt * 3);
  const cen = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = pos[ix[t * 3] * 3 + k];
      const b = pos[ix[t * 3 + 1] * 3 + k];
      const c = pos[ix[t * 3 + 2] * 3 + k];
      tmin[t * 3 + k] = Math.min(a, b, c);
      tmax[t * 3 + k] = Math.max(a, b, c);
      cen[t * 3 + k] = (a + b + c) / 3;
    }
  }
  const order = new Uint32Array(nt);
  for (let t = 0; t < nt; t++) order[t] = t;
  // a binary tree over nt triangles, every leaf holding at least one: under 2 nt nodes
  const cap = Math.max(1, 2 * nt);
  const bmin = new Float64Array(cap * 3);
  const bmax = new Float64Array(cap * 3);
  const left = new Int32Array(cap).fill(-1);
  const right = new Int32Array(cap).fill(-1);
  const first = new Uint32Array(cap);
  const count = new Uint32Array(cap);
  let nodes = 0;
  const build = (start, end) => {
    const n = nodes++;
    for (let k = 0; k < 3; k++) {
      bmin[n * 3 + k] = Infinity;
      bmax[n * 3 + k] = -Infinity;
    }
    let lo0 = Infinity;
    let lo1 = Infinity;
    let lo2 = Infinity;
    let hi0 = -Infinity;
    let hi1 = -Infinity;
    let hi2 = -Infinity;
    for (let i = start; i < end; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) {
        if (tmin[t * 3 + k] < bmin[n * 3 + k]) bmin[n * 3 + k] = tmin[t * 3 + k];
        if (tmax[t * 3 + k] > bmax[n * 3 + k]) bmax[n * 3 + k] = tmax[t * 3 + k];
      }
      lo0 = Math.min(lo0, cen[t * 3]);
      lo1 = Math.min(lo1, cen[t * 3 + 1]);
      lo2 = Math.min(lo2, cen[t * 3 + 2]);
      hi0 = Math.max(hi0, cen[t * 3]);
      hi1 = Math.max(hi1, cen[t * 3 + 1]);
      hi2 = Math.max(hi2, cen[t * 3 + 2]);
    }
    if (end - start <= LEAF) {
      first[n] = start;
      count[n] = end - start;
      return n;
    }
    const ext = [hi0 - lo0, hi1 - lo1, hi2 - lo2];
    const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
    const slice = Array.from(order.subarray(start, end));
    slice.sort((a, b) => cen[a * 3 + axis] - cen[b * 3 + axis] || a - b);
    order.set(slice, start);
    const mid = (start + end) >> 1;
    left[n] = build(start, mid);
    right[n] = build(mid, end);
    return n;
  };
  if (nt > 0) build(0, nt);
  return { pos, ix, order, bmin, bmax, left, right, first, count, stack: new Int32Array(cap + 1) };
}

function boxDistSq(bvh, n, px, py, pz) {
  let d = 0;
  for (let k = 0; k < 3; k++) {
    const p = k === 0 ? px : k === 1 ? py : pz;
    const lo = bvh.bmin[n * 3 + k];
    const hi = bvh.bmax[n * 3 + k];
    const e = p < lo ? lo - p : p > hi ? p - hi : 0;
    d += e * e;
  }
  return d;
}

/** The squared distance from a point to the tree's surface; the search may stop as soon as it
 *  is known to be at most `enoughSq` (the caller only needs to know it is no larger). */
function nearestSq(bvh, px, py, pz, enoughSq) {
  const { pos, ix, order, left, right, first, count, stack } = bvh;
  let best = Infinity;
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const n = stack[--top];
    if (boxDistSq(bvh, n, px, py, pz) >= best) continue;
    if (left[n] < 0) {
      for (let i = first[n]; i < first[n] + count[n]; i++) {
        const t = order[i];
        const a = ix[t * 3] * 3;
        const b = ix[t * 3 + 1] * 3;
        const c = ix[t * 3 + 2] * 3;
        const d = closestPointTriSq(
          px,
          py,
          pz,
          pos[a],
          pos[a + 1],
          pos[a + 2],
          pos[b],
          pos[b + 1],
          pos[b + 2],
          pos[c],
          pos[c + 1],
          pos[c + 2],
        );
        if (d < best) {
          best = d;
          if (best <= enoughSq) return best;
        }
      }
      continue;
    }
    const dl = boxDistSq(bvh, left[n], px, py, pz);
    const dr = boxDistSq(bvh, right[n], px, py, pz);
    // the nearer child pops first
    if (dl <= dr) {
      if (dr < best) stack[top++] = right[n];
      if (dl < best) stack[top++] = left[n];
    } else {
      if (dl < best) stack[top++] = left[n];
      if (dr < best) stack[top++] = right[n];
    }
  }
  return best;
}

/**
 * The largest distance from the `samples` vertices of `pos` to the surface `lodIndices` draws
 * over the same positions (a vertex the level still uses is on it: distance 0). Stops early once
 * the distance passes `stopAbove` (`exceeded` then says so and `max` is a lower bound).
 */
export function measureDeviation(pos, samples, lodIndices, stopAbove = Infinity) {
  if (lodIndices.length === 0) return { max: Infinity, exceeded: true };
  const used = new Uint8Array(pos.length / 3);
  for (let i = 0; i < lodIndices.length; i++) used[lodIndices[i]] = 1;
  const bvh = buildBvh(pos, lodIndices);
  let maxSq = 0;
  const stopSq = stopAbove * stopAbove;
  for (let s = 0; s < samples.length; s++) {
    const v = samples[s];
    if (used[v]) continue;
    const d = nearestSq(bvh, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], maxSq);
    if (d > maxSq) {
      maxSq = d;
      if (maxSq > stopSq) return { max: Math.sqrt(maxSq), exceeded: true };
    }
  }
  return { max: Math.sqrt(maxSq), exceeded: false };
}

// --- one primitive --------------------------------------------------------------------------

/** Why a primitive gets no levels, or null. */
function skipReason(prim) {
  if (prim.getMode() !== Primitive.Mode.TRIANGLES) return `mode ${prim.getMode()}`;
  if (!prim.getIndices()) return 'not indexed';
  if (!prim.getAttribute('POSITION')) return 'no POSITION';
  if (prim.getIndices().getCount() < 3) return 'no triangles';
  return null;
}

function dropDegenerate(ix) {
  const out = [];
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i];
    const b = ix[i + 1];
    const c = ix[i + 2];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  return Uint32Array.from(out);
}

/** Normal + uv per vertex, the simplifier's attribute stream, and its weights. */
function attributeStream(prim, space) {
  const uvAcc = prim.getAttribute('TEXCOORD_0');
  const uv = uvAcc ? readFloats(uvAcc) : null;
  const n = space.count;
  const a = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    a[i * 5] = space.nrm[i * 3];
    a[i * 5 + 1] = space.nrm[i * 3 + 1];
    a[i * 5 + 2] = space.nrm[i * 3 + 2];
    a[i * 5 + 3] = uv ? uv[i * 2] : 0;
    a[i * 5 + 4] = uv ? uv[i * 2 + 1] : 0;
  }
  const wn = LOD_NORMAL_WEIGHT;
  const wu = uv ? LOD_UV_WEIGHT : 0;
  return { attrs: a, weights: [wn, wn, wn, wu, wu] };
}

/** The largest deviation over every instance (each in its own space). */
function deviationOver(spaces, samples, ix, stopAbove) {
  let max = 0;
  for (const space of spaces) {
    const d = measureDeviation(space.pos, samples, ix, stopAbove);
    if (d.max > max) max = d.max;
    if (d.exceeded) return { max, exceeded: true };
  }
  return { max, exceeded: false };
}

/** The smallest ladder result within the level's measured bound (level 0 when none is). */
function boundedLevel(spec, height, base, spaces, samples, stream) {
  const limit = spec.limit * height;
  const triangles = base.length / 3;
  const flags = spec.lockBorder ? ['LockBorder'] : [];
  let best = { indices: base, share: 1, deviation: 0 };
  for (const share of LOD_LADDER) {
    if (share < spec.floor - 1e-9) break;
    const target = 3 * Math.max(0, Math.floor(triangles * share));
    const [raw] = MeshoptSimplifier.simplifyWithAttributes(
      base,
      spaces[0].pos,
      3,
      stream.attrs,
      5,
      stream.weights,
      null,
      target,
      1.0,
      flags,
    );
    const ix = dropDegenerate(raw);
    if (!ix.length || ix.length >= best.indices.length) continue;
    const d = deviationOver(spaces, samples, ix, limit);
    if (!d.exceeded && d.max <= limit) best = { indices: ix, share, deviation: d.max };
  }
  return best;
}

/** The full weights a face control reaches (src/render/characters/woc_head_catalog.ts
 *  WOC_HEAD_MORPH_RANGE): the eye and brow controls push both ways from the sculpt, the chin,
 *  the scalp tucks and the bald crown only one way. */
export function lodMorphWeights(targetName) {
  return /^FS_(Eyes|Brows)_/.test(targetName ?? '') ? [1, -1] : [1];
}

/** Each morph target at the full weights it reaches: the worst deviation of a level from level 0
 *  with the same target applied to both (the face sliders: shapes the level must follow). */
function morphCheck(prim, names, spaces, samples, ix) {
  let worst = null;
  prim.listTargets().forEach((target, t) => {
    const delta = target.getAttribute('POSITION');
    if (!delta) return;
    const local = readFloats(delta);
    for (const space of spaces) {
      const moved = space.linear(local);
      for (const weight of lodMorphWeights(names[t])) {
        const pos = new Float32Array(space.pos.length);
        for (let i = 0; i < pos.length; i++) pos[i] = space.pos[i] + weight * moved[i];
        const d = measureDeviation(pos, samples, ix);
        if (!worst || d.max > worst.deviation) worst = { deviation: d.max, target: t, weight };
      }
    }
  });
  return worst;
}

const roundUp = (x) => Math.ceil(x * LOD_DEVIATION_STEPS_PER_UNIT) / LOD_DEVIATION_STEPS_PER_UNIT;

function disposeLod(lod) {
  const accessors = lod.listLevels().map((level) => level.getIndices());
  lod.dispose();
  for (const accessor of new Set(accessors)) {
    if (accessor && !accessor.listParents().some((p) => p.propertyType !== 'Root')) {
      accessor.dispose();
    }
  }
}

/**
 * Adds WOC_lod levels to every eligible primitive of `doc` (triangle lists with indices; other
 * primitives are reported as skipped), measured against `height`, the character's height in
 * the file's scene units. Replaces any levels a primitive already carries. Returns the report:
 * per primitive the triangles at level 0 and at each kept level, with the measured deviations
 * (scene units and share of the height) and, where the primitive has morph targets, the worst
 * deviation of each level under any one target at full weight.
 */
export async function addLodIndices(doc, options = {}) {
  const { height, minSaving = LOD_MIN_SAVING, morphs = true, levels = LOD_LEVELS } = options;
  if (!(height > 0))
    throw new Error('addLodIndices: the character height (scene units) is required');
  if (levels.length !== 2) throw new Error('addLodIndices: the contract has a mid and a far level');
  await MeshoptSimplifier.ready;
  const report = {
    height,
    levels: levels.map((l) => ({ ...l, limitUnits: l.limit * height })),
    primitives: [],
  };
  let ext = null;
  for (const mesh of doc.getRoot().listMeshes()) {
    const nodes = mesh.listParents().filter((p) => p instanceof Node);
    mesh.listPrimitives().forEach((prim, primitive) => {
      const row = {
        mesh: mesh.getName(),
        nodes: nodes.map((n) => n.getName()),
        primitive,
        material: prim.getMaterial()?.getName() ?? null,
      };
      report.primitives.push(row);
      const old = prim.getExtension(WOC_LOD);
      if (old) {
        prim.setExtension(WOC_LOD, null);
        disposeLod(old);
      }
      const skipped = skipReason(prim);
      if (skipped) {
        row.skipped = skipped;
        return;
      }
      const base = Uint32Array.from(prim.getIndices().getArray());
      const vertices = prim.getAttribute('POSITION').getCount();
      const triangles = base.length / 3;
      const spaces = (nodes.length ? nodes : [null]).map((node) => characterSpace(prim, node));
      const drawn = new Uint8Array(vertices);
      for (let i = 0; i < base.length; i++) drawn[base[i]] = 1;
      const samples = [];
      for (let v = 0; v < vertices; v++) if (drawn[v]) samples.push(v);
      const stream = attributeStream(prim, spaces[0]);
      const [midSpec, farSpec] = levels;
      const mid = boundedLevel(midSpec, height, base, spaces, samples, stream);
      let far = boundedLevel(farSpec, height, base, spaces, samples, stream);
      // a far level is never kept coarser than the mid one: the mid level is within the far
      // bound too, so a far run that cannot beat it reuses it
      if (far.indices.length >= mid.indices.length) far = { ...mid, sharesMid: true };
      const keep = (level) => level.indices.length / 3 <= (1 - minSaving) * triangles + 1e-9;
      Object.assign(row, { vertices, triangles, spaces: spaces.length, mid: null, far: null });
      const kept = [];
      if (keep(mid)) kept.push(['mid', mid]);
      if (keep(far)) kept.push(['far', far]);
      if (!kept.length) return;
      ext ??= doc.createExtension(WocLodExtension);
      const lod = ext.createLod();
      const buffer = prim.getIndices().getBuffer() ?? doc.getRoot().listBuffers()[0];
      const made = new Map();
      const morphed = new Map();
      for (const [name, level] of kept) {
        let accessor = made.get(level.indices);
        if (!accessor) {
          accessor = doc
            .createAccessor('', buffer)
            .setType('SCALAR')
            .setArray(lodIndexArrayFor(vertices, level.indices));
          made.set(level.indices, accessor);
        }
        const maxDeviation = roundUp(level.deviation);
        lod.addLevel(ext.createLevel().setIndices(accessor).setMaxDeviation(maxDeviation));
        row[name] = {
          triangles: level.indices.length / 3,
          share: +(level.indices.length / base.length).toFixed(4),
          ladder: level.share,
          maxDeviation,
          deviationShare: +(level.deviation / height).toFixed(6),
          ...(level.sharesMid ? { sharesMid: true } : {}),
        };
        if (morphs && prim.listTargets().length) {
          const names = mesh.getExtras()?.targetNames ?? [];
          if (!morphed.has(level.indices)) {
            morphed.set(level.indices, morphCheck(prim, names, spaces, samples, level.indices));
          }
          const worst = morphed.get(level.indices);
          if (worst) {
            row.morph ??= { targets: prim.listTargets().length };
            row.morph[name] = {
              deviation: +worst.deviation.toPrecision(6),
              deviationShare: +(worst.deviation / height).toFixed(6),
              extraShare: +((worst.deviation - level.deviation) / height).toFixed(6),
              target: names[worst.target] ?? worst.target,
              weight: worst.weight,
            };
          }
        }
      }
      lod.setBaseIndexHash(indexFingerprint(prim.getIndices()));
      prim.setExtension(WOC_LOD, lod);
    });
  }
  report.totals = lodTotals(report);
  return report;
}

/** What a file draws at each level: the triangles of every primitive at level 0, at the mid
 *  level (level 0 where it has none) and at the far level (level 0 where it has none), each
 *  counted once per node that draws it (dedup leaves a mirrored left and right piece one mesh),
 *  with the worst measured deviations and the worst morphed one. */
export function lodTotals(report) {
  const t = {
    primitives: 0,
    withMid: 0,
    withFar: 0,
    triangles: 0,
    mid: 0,
    far: 0,
    worstMidShare: 0,
    worstFarShare: 0,
    worstMorphExtraShare: 0,
  };
  for (const row of report.primitives) {
    if (row.skipped) continue;
    const drawn = row.spaces ?? 1;
    t.primitives++;
    t.triangles += drawn * row.triangles;
    t.mid += drawn * (row.mid?.triangles ?? row.triangles);
    t.far += drawn * (row.far?.triangles ?? row.triangles);
    if (row.mid) t.withMid++;
    if (row.far) t.withFar++;
    t.worstMidShare = Math.max(t.worstMidShare, row.mid?.deviationShare ?? 0);
    t.worstFarShare = Math.max(t.worstFarShare, row.far?.deviationShare ?? 0);
    for (const level of ['mid', 'far']) {
      t.worstMorphExtraShare = Math.max(
        t.worstMorphExtraShare,
        row.morph?.[level]?.extraShare ?? 0,
      );
    }
  }
  return t;
}

/**
 * Re-measures every WOC_lod level of `doc` (a written file read back: quantized vertices land in
 * the scene's space through their node or skin, as above) and holds each to the deviation it
 * records, plus `tolerance` scene units (the vertex quantization). Returns the rows and the
 * failures; a level drawn over the wrong vertices measures far past any bound.
 */
export function verifyLodIndices(doc, { tolerance }) {
  const rows = [];
  const failures = [];
  for (const { mesh, prim, lod } of listLodPrimitives(doc)) {
    const primitive = mesh.listPrimitives().indexOf(prim);
    const nodes = mesh.listParents().filter((p) => p instanceof Node);
    const spaces = (nodes.length ? nodes : [null]).map((node) => characterSpace(prim, node));
    const base = prim.getIndices().getArray();
    const drawn = new Uint8Array(spaces[0].count);
    for (let i = 0; i < base.length; i++) drawn[base[i]] = 1;
    const samples = [];
    for (let v = 0; v < drawn.length; v++) if (drawn[v]) samples.push(v);
    lod.listLevels().forEach((level, index) => {
      const ix = level.getIndices().getArray();
      const recorded = level.getMaxDeviation();
      const measured = deviationOver(spaces, samples, ix, Infinity).max;
      const row = {
        mesh: mesh.getName(),
        primitive,
        level: index,
        triangles: ix.length / 3,
        recorded,
        measured,
      };
      rows.push(row);
      if (!(measured <= recorded + tolerance)) {
        failures.push(
          `${mesh.getName()} primitive ${primitive} level ${index}: measured ${measured} over ` +
            `the recorded ${recorded} (+${tolerance})`,
        );
      }
    });
  }
  return { rows, failures };
}
