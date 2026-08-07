// Skin-quality metrics: does a rig's SKINNING actually work, measured rather
// than eyeballed. Pure math over plain arrays, no glTF and no Blender, so a
// Vitest drives it directly; `readSkinnedGlb` (lib/glb.mjs) produces the input
// shape from a real file.
//
// Two independent readings, because they fail differently:
//
// - worstEdgeStretch: evaluate every clip, skin the mesh with linear blend
//   skinning, and compare each posed edge against its rest length. A rig whose
//   weights are sane holds every edge near 1.0x (the hand-authored KayKit
//   knight never exceeds 1.04x across its 22 clips). A torn weight field shows
//   up here as an order-of-magnitude outlier and nowhere else, because the rest
//   pose looks perfect no matter how bad the weights are.
//
//   MIN REST LENGTH MATTERS. Tripo meshes carry sliver edges a few thousandths
//   long; a sliver hits 5x while moving a distance nobody can see, so a pure
//   ratio gate fires on noise. `minRestLength` is the absolute-gap half of the
//   test and both halves are required for a verdict (the lesson recorded in
//   scripts/assets/last_bell_crew/void_rigs.py's review tooling notes).
//
// - weightStats: per-bone peak, reach, dominance and share of total weight
//   mass. This catches the failure mode where nothing tears badly enough to
//   trip the stretch gate but no bone OWNS any region either, so the whole body
//   swims: the tell is a low mean dominant weight and bones dominating nothing.
import { MAT4_IDENTITY, mat4ApplyPoint, mat4FromTRS, mat4Multiply } from './glb.mjs';

/** Unique undirected edges from a triangle index array. */
export function edgesFromIndices(indices) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (const [x, y] of [
      [tri[0], tri[1]],
      [tri[1], tri[2]],
      [tri[2], tri[0]],
    ]) {
      const key = x < y ? `${x},${y}` : `${y},${x}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(x < y ? [x, y] : [y, x]);
    }
  }
  return out;
}

const lerp = (a, b, u) => a + (b - a) * u;

/** Shortest-arc quaternion interpolation (xyzw), matching glTF LINEAR on
 *  rotation channels. Plain lerp on a quaternion takes the long way round on
 *  more than half the sampled frames of a swing and invents deformation that
 *  the runtime never shows. */
function slerp(a, b, u) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let end = b;
  if (dot < 0) {
    end = b.map((v) => -v);
    dot = -dot;
  }
  if (dot > 0.9995) {
    const out = a.map((v, i) => lerp(v, end[i], u));
    const len = Math.hypot(...out) || 1;
    return out.map((v) => v / len);
  }
  const theta = Math.acos(dot);
  const sa = Math.sin((1 - u) * theta) / Math.sin(theta);
  const sb = Math.sin(u * theta) / Math.sin(theta);
  return a.map((v, i) => v * sa + end[i] * sb);
}

/** Sample one animation channel at time `t`. Holds the endpoints outside the
 *  keyed range, the way glTF defines it. CUBICSPLINE output is read as its
 *  keyframe values only (the tangents are ignored): the metric samples 12
 *  frames a clip, so tangent-exact interpolation would change a reading in the
 *  third decimal and never a verdict. */
export function sampleChannel(channel, t) {
  const { times, values, stride, interpolation = 'LINEAR', path } = channel;
  const last = times.length - 1;
  const at = (i) => values.slice(i * stride, i * stride + stride);
  if (t <= times[0]) return at(0);
  if (t >= times[last]) return at(last);
  let i = 0;
  while (i < last && times[i + 1] < t) i++;
  if (interpolation === 'STEP') return at(i);
  const u = (t - times[i]) / (times[i + 1] - times[i]);
  const a = at(i);
  const b = at(i + 1);
  if (path === 'rotation' && stride === 4) return slerp(a, b, u);
  return a.map((v, k) => lerp(v, b[k], u));
}

/** World matrices for every node at clip time `t`.
 *  `skeleton` is { nodes: [{ name, translation, rotation, scale, children }],
 *  roots: [index] }, where `children` holds node indices. */
export function poseSkeletonAt(skeleton, clip, t) {
  const override = new Map();
  for (const ch of clip?.channels ?? []) {
    if (!override.has(ch.node)) override.set(ch.node, {});
    override.get(ch.node)[ch.path] = sampleChannel(ch, t);
  }
  const out = new Map();
  const walk = (index, parent) => {
    const node = skeleton.nodes[index];
    const o = override.get(node.name);
    const local = mat4FromTRS(
      o?.translation ?? node.translation,
      o?.rotation ?? node.rotation,
      o?.scale ?? node.scale,
    );
    const world = mat4Multiply(parent, local);
    out.set(node.name, world);
    for (const c of node.children) walk(c, world);
  };
  for (const r of skeleton.roots) walk(r, MAT4_IDENTITY);
  return out;
}

/** Linear blend skinning for one primitive at a posed skeleton.
 *  Returns positions in the primitive's REAL (dequantized) space, so rest and
 *  posed readings are directly comparable. */
export function skinPositions(prim, posed) {
  const skinMats = prim.jointNames.map((name, i) => {
    const world = posed.get(name);
    // A joint the clip does not key and the tree does not reach cannot deform
    // anything; treat it as its own bind pose (identity skin matrix).
    if (!world) return null;
    return mat4Multiply(world, prim.ibms[i]);
  });
  return prim.verts.map((v) => {
    const acc = [0, 0, 0];
    let wsum = 0;
    for (let k = 0; k < 4; k++) {
      const w = v.w[k];
      if (!w) continue;
      const sm = skinMats[v.j[k]];
      if (!sm) continue;
      const q = mat4ApplyPoint(sm, v.p);
      acc[0] += q[0] * w;
      acc[1] += q[1] * w;
      acc[2] += q[2] * w;
      wsum += w;
    }
    // Renormalize only a genuinely off-budget vertex; the runtime does the same
    // and an unweighted vertex must stay at the origin of its own bind space
    // rather than being scaled up from nothing.
    if (wsum > 1e-6 && Math.abs(wsum - 1) > 1e-4) {
      acc[0] /= wsum;
      acc[1] /= wsum;
      acc[2] /= wsum;
    }
    return prim.dequant ? mat4ApplyPoint(prim.dequant, acc) : acc;
  });
}

const restPositions = (prim) =>
  prim.dequant
    ? prim.verts.map((v) => mat4ApplyPoint(prim.dequant, v.p))
    : prim.verts.map((v) => v.p);

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Worst per-edge stretch relative to the rest pose, over every clip.
 *  Options: samples (frames per clip), minRestLength (ignore slivers shorter
 *  than this in the model's own units), reportRatio (the "how many edges are
 *  visibly torn" tally threshold). */
export function worstEdgeStretch(model, opts = {}) {
  const { samples = 12, minRestLength = 0, reportRatio = 2 } = opts;
  const rest = model.prims.map((p) => restPositions(p));
  const perClip = [];
  let worst = 0;
  let worstClip = null;
  let overRatio = 0;
  let counted = 0;
  for (const clip of model.clips) {
    let clipWorst = 0;
    for (let f = 0; f < samples; f++) {
      const t = clip.duration * (f / samples);
      const posed = poseSkeletonAt(model.skeleton, clip, t);
      for (let pi = 0; pi < model.prims.length; pi++) {
        const prim = model.prims[pi];
        const def = skinPositions(prim, posed);
        for (const [a, b] of prim.edges) {
          const r = dist(rest[pi][a], rest[pi][b]);
          if (r <= minRestLength || r < 1e-9) continue;
          const ratio = dist(def[a], def[b]) / r;
          counted++;
          if (ratio > reportRatio) overRatio++;
          if (ratio > clipWorst) clipWorst = ratio;
        }
      }
    }
    perClip.push({ clip: clip.name, worst: clipWorst });
    if (clipWorst > worst) {
      worst = clipWorst;
      worstClip = clip.name;
    }
  }
  perClip.sort((a, b) => b.worst - a.worst);
  return {
    worst,
    worstClip,
    perClip,
    overRatio,
    overRatioFrac: counted ? overRatio / counted : 0,
    edgeSamples: counted,
    samples,
    minRestLength,
    reportRatio,
  };
}

/** Per-bone weight statistics plus the two whole-rig summaries that separate a
 *  hand-authored skin from a smeared one: mean dominant weight per vertex, and
 *  the fraction of vertices no bone owns above 0.5. */
export function weightStats(model) {
  const names = model.prims[0]?.jointNames ?? [];
  const peak = new Array(names.length).fill(0);
  const touched = new Array(names.length).fill(0);
  const dominated = new Array(names.length).fill(0);
  const mass = new Array(names.length).fill(0);
  let dominantSum = 0;
  let verts = 0;
  let unowned = 0;
  let totalMass = 0;
  for (const prim of model.prims) {
    for (const v of prim.verts) {
      verts++;
      // Sum per joint first: a vertex can list the same joint twice, and the
      // pair is what deforms it, so the per-slot value is not the ownership.
      const perJoint = new Map();
      for (let k = 0; k < 4; k++) {
        if (!v.w[k]) continue;
        perJoint.set(v.j[k], (perJoint.get(v.j[k]) ?? 0) + v.w[k]);
      }
      let best = 0;
      let bestJoint = -1;
      for (const [j, w] of perJoint) {
        touched[j]++;
        mass[j] += w;
        totalMass += w;
        if (w > peak[j]) peak[j] = w;
        if (w > best) {
          best = w;
          bestJoint = j;
        }
      }
      if (bestJoint >= 0) dominated[bestJoint]++;
      dominantSum += best;
      if (best < 0.5) unowned++;
    }
  }
  const bones = names.map((name, i) => ({
    bone: name,
    peak: peak[i],
    touched: touched[i],
    dominated: dominated[i],
    massFrac: totalMass ? mass[i] / totalMass : 0,
  }));
  return {
    verts,
    bones,
    meanDominant: verts ? dominantSum / verts : 0,
    unownedFrac: verts ? unowned / verts : 0,
    deadBones: bones.filter((b) => b.dominated === 0).map((b) => b.bone),
  };
}
