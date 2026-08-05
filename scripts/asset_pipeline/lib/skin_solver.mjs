// The weight solver behind the manual-rig lane, as pure geometry: given bone
// segments and points in the same space, decide which bones drive each point and
// how much. No glTF, no Blender, so a Vitest drives it directly
// (tests/asset_pipeline_skin_solver.test.ts); lib/manual_rig.mjs is the thin
// consumer that handles the file I/O and the bind-space transform.
//
// WHY THE KERNEL HAS A RADIUS
//
// The original solver weighted candidates 1/d^4 and normalized. That depends
// only on the RATIOS between distances, never on absolute distance, so it has no
// idea whether a point is deep inside a limb or out in open space equidistant
// from six bones. On a body bulkier than the reference rig, most of the torso is
// far from every bone at once, every candidate distance comes out near-equal,
// and the 4-way blend lands at roughly 0.25 each: nothing owns anything, the
// whole body swims, and the selected bone set flips between neighbouring
// vertices as candidates 4 and 5 swap rank, which tears the mesh.
//
// Measured on the Sundered Horror against the hand-authored KayKit knight: mean
// dominant weight 0.43 vs the knight's 0.82, and 79% of vertices with no bone
// above 0.5 vs the knight's 2.7%.
//
// So each segment gets a RADIUS measured from the mesh itself (the spread of the
// geometry that segment is nearest to) and the kernel is bounded by it: full
// influence on the bone, zero at the radius. A point deep inside a limb then
// resolves to a single owner, and a point outside every radius (a horn, a
// shoulder spike, a claw tip) is assigned RIGIDLY to its nearest bone instead of
// being smeared across whichever bones happen to be least far away. Rigid is the
// correct answer for those: a spike has no articulation to represent, and a
// blended spike is the one that gets flung off the model.

/** Squared length of a - b. */
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Distance from point `p` to the segment `a`->`b`, and the parameter t along it. */
export function distToSegment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  let t = len2 > 1e-12 ? (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Quartic bump: 1 on the bone, 0 at and beyond the radius, smooth in between
 *  (zero derivative at both ends, so the weight field has no crease). */
const bump = (x) => (x >= 1 ? 0 : (1 - x * x) ** 2);

/** Influence of one segment: bounded SUPPORT from the radius, ordering from the
 *  absolute distance.
 *
 *  The radius alone is not enough, and getting this wrong is subtle. Weighting
 *  purely on d/r lets a THICK bone outrank a THIN one over geometry sitting
 *  right on the thin bone, because a big radius makes a large distance look
 *  small: measured on the Horror, a radius-only kernel handed 400 shin vertices
 *  to `toes`, whose stub segment had picked up the whole foot blob as its
 *  bucket. The 1/d^p factor restores "the nearest bone wins" inside the support,
 *  while the bump is what supplies the length scale and forces distant bones to
 *  exactly zero instead of into a 4-way tie. */
const influence = (d, r, pow) => {
  const b = bump(d / r);
  return b === 0 ? 0 : b / (d ** pow + 1e-8);
};

/** Is segment `seg` allowed to influence a point at lateral offset `lx`?
 *  A `.l` bone must never grab -X geometry and vice versa, or the two arms
 *  cross-drive each other through the chest. */
export function sideAllows(seg, lx, sideGuard) {
  if (seg.side === 1 && lx < -sideGuard) return false;
  if (seg.side === -1 && lx > sideGuard) return false;
  return true;
}

const percentile = (sorted, p) => {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
};

/** A per-segment influence radius measured from the mesh: bucket every point by
 *  the segment it is nearest to, then take a high percentile of the distances in
 *  that bucket. Self-calibrating per limb, which one global radius cannot be
 *  (the Horror's upper arm is 4x the thickness of its fist).
 *
 *  The percentile matters and is a real trade-off. At 1.0 the radius swallows
 *  every shoulder spike and horn near a bone, and spikes taking blended arm
 *  weight are what get flung off the model. Too low and the bulk of a limb falls
 *  outside its own bone's radius and lands on the rigid fallback, which is
 *  stiff. `radiusPercentile` around 0.8 keeps the limb body inside and the
 *  outliers out. */
export function segmentRadii(points, segments, opts = {}) {
  const {
    radiusPercentile = 0.8,
    sideGuard = 0,
    centerX = 0,
    // Bound every radius into a band around the median measured one. Both ends
    // matter and both were observed on the Horror:
    //
    // Too SMALL starves a bone. A short link whose nearest-geometry bucket is
    // small measures a tiny radius, its bump falls to zero almost immediately,
    // and a fatter neighbour outvotes it even on its own bone: `foot` ended up
    // with a peak weight of 0.288 and dominating nothing at all.
    //
    // Too LARGE lets a bone reach across the body and swallow decoration that
    // belongs to something else, which is the flung-spike failure.
    //
    // The floor is set on TEARING, measured through the full shipping chain,
    // because that is the failure anyone can see. Raising it does buy dead bones
    // back (on the Horror, 0.4 leaves foot.l and foot.r dominating nothing, and
    // 0.75 is the lowest value where every leg bone owns geometry), and it is
    // still the wrong trade: torn edges over all six reviewed clips go from 473
    // at 0.4 to 538 at 0.75, and Walking_A and Running_A end up WORSE than the
    // unfixed solver they replaced. A bone owning nothing costs an ankle that
    // does not articulate, which no frame shows; a torn walk cycle is visible in
    // every frame of the clip the model spends most of its time in.
    radiusBand = [0.4, 2.5],
    minRadius = 0,
    maxRadius = Infinity,
  } = opts;
  const buckets = segments.map(() => []);
  for (const p of points) {
    const lx = p[0] - centerX;
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!sideAllows(seg, lx, sideGuard)) continue;
      const d = distToSegment(p, seg.a, seg.b);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= 0) buckets[bi].push(bd);
  }
  // A segment nothing is nearest to has no measurable radius of its own; give it
  // the median of the segments that do, so it still participates rather than
  // vanishing (and never dictates the scale).
  const measured = [];
  const radii = buckets.map((b) => {
    if (!b.length) return null;
    b.sort((x, y) => x - y);
    const r = percentile(b, radiusPercentile);
    measured.push(r);
    return r;
  });
  measured.sort((a, b) => a - b);
  // Degenerate guard: with no measured bucket at all (no points, or every point
  // guarded away from every segment) fall back to a unit radius rather than to
  // minRadius, whose default of 0 would zero every radius and turn the whole
  // solve rigid.
  const median = percentile(measured, 0.5) ?? (minRadius > 0 ? minRadius : 1);
  const lo = Math.max(minRadius, median * radiusBand[0]);
  const hi = Math.min(maxRadius, median * radiusBand[1]);
  return radii.map((r) => Math.min(hi, Math.max(lo, r === null || r <= 0 ? median : r)));
}

/** Solve skin weights for `points` against `segments`.
 *
 *  `segments`: [{ joint, a, b, side }] where `joint` is the joint index the
 *  segment is attributed to and `side` is +1 for a `.l` bone, -1 for `.r`, 0 for
 *  a centre bone. Several segments may share a joint; a joint's weight is its
 *  BEST segment, never the sum (see manual_rig.mjs for why summing is a
 *  targeted handicap on `chest` and `hips`).
 *
 *  Returns { joints, weights, rigid } with `influences` entries per point,
 *  weights normalized to sum to 1, and `rigid` a count of points that fell
 *  outside every radius and were assigned to one bone. */
export function solveSkinWeights(points, segments, opts = {}) {
  const {
    influences = 4,
    sideGuard = 0,
    centerX = 0,
    // Drop any candidate weaker than this fraction of the best before
    // truncating to K. Without it, the K-th and (K+1)-th candidates swap rank
    // between neighbouring vertices whenever they are near-equal, the selected
    // bone set changes across that edge, and the mesh tears along it. A
    // candidate this much weaker than the winner cannot matter to the look.
    minWeightFrac = 0.05,
    // Sharpness inside the support. The bump already decides WHICH bones are in
    // the running, so this only shapes the blend among genuine neighbours; the
    // original solver's 4 was doing the whole job alone and could not.
    falloff = 2,
    radii = null,
  } = opts;
  const R = radii ?? segmentRadii(points, segments, opts);
  const joints = new Uint16Array(points.length * influences);
  const weights = new Float32Array(points.length * influences);
  let rigid = 0;
  const cand = [];
  for (let v = 0; v < points.length; v++) {
    const p = points[v];
    const lx = p[0] - centerX;
    cand.length = 0;
    let nearest = -1;
    let nearestX = Infinity;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!sideAllows(seg, lx, sideGuard)) continue;
      const d = distToSegment(p, seg.a, seg.b);
      // The rigid fallback picks by RAW distance, not by d/r: a point outside
      // every radius should ride the bone physically closest to it, and d/r
      // would hand it to whichever bone happens to have the fattest radius.
      if (d < nearestX) {
        nearestX = d;
        nearest = i;
      }
      const w = influence(d, R[i], falloff);
      if (w > 0) cand.push({ joint: seg.joint, w });
    }
    // Outside every radius: a horn tip, a shoulder spike, a claw. One owner,
    // rigidly. Blending these is what flings fragments off the model.
    if (!cand.length) {
      if (nearest >= 0) {
        rigid++;
        joints[v * influences] = segments[nearest].joint;
        weights[v * influences] = 1;
      }
      continue;
    }
    cand.sort((a, b) => b.w - a.w);
    const merged = [];
    for (const c of cand) {
      // Sorted descending, so the first hit for a joint is already its max.
      if (!merged.some((m) => m.joint === c.joint)) merged.push(c);
    }
    const floor = merged[0].w * minWeightFrac;
    const top = merged.filter((m) => m.w >= floor).slice(0, influences);
    const sum = top.reduce((s, c) => s + c.w, 0) || 1;
    for (let k = 0; k < influences; k++) {
      joints[v * influences + k] = top[k]?.joint ?? 0;
      weights[v * influences + k] = (top[k]?.w ?? 0) / sum;
    }
  }
  return { joints, weights, rigid };
}

/** Group points by position so co-located duplicates get identical weights.
 *  Tripo ships a triangle soup: the Sundered Horror carries 4,080 duplicate
 *  vertices at 1,985 distinct positions. Weighting per VERTEX lets two vertices
 *  at one point disagree and pull apart, which cracks the mesh open along every
 *  seam. Returns { nodeOf, nodePos }: nodeOf[v] is v's welded node index. */
export function weldPositions(points, tol = 1e-5) {
  const q = 1 / tol;
  const key = new Map();
  const nodeOf = new Int32Array(points.length);
  const nodePos = [];
  for (let v = 0; v < points.length; v++) {
    const p = points[v];
    const k = `${Math.round(p[0] * q)},${Math.round(p[1] * q)},${Math.round(p[2] * q)}`;
    let n = key.get(k);
    if (n === undefined) {
      n = nodePos.length;
      key.set(k, n);
      nodePos.push(p);
    }
    nodeOf[v] = n;
  }
  return { nodeOf, nodePos };
}

/** Neighbour lists over the welded node graph, from triangle indices. Welding
 *  first is what makes this a connected graph at all: on the raw soup every seam
 *  is a break, so the edges of one triangle never reach the coincident vertex of
 *  its neighbour. */
export function buildAdjacency(nodeCount, indices, nodeOf) {
  const sets = Array.from({ length: nodeCount }, () => new Set());
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const t = [nodeOf[indices[i]], nodeOf[indices[i + 1]], nodeOf[indices[i + 2]]];
    for (const [x, y] of [
      [t[0], t[1]],
      [t[1], t[2]],
      [t[2], t[0]],
    ]) {
      if (x !== y) {
        sets[x].add(y);
        sets[y].add(x);
      }
    }
  }
  return sets.map((s) => [...s]);
}

/** Laplacian smoothing of the weight field over the welded neighbour graph.
 *
 *  This is the one pass that fixes what neither the kernel nor the top-K floor
 *  can. The measured failure mode after those two is a pair of vertices five
 *  MILLIMETRES apart whose weight vectors differ by half: same dominant bone,
 *  wildly different blend, so the edge between them opens up 6cm under a swing.
 *  Nothing about picking better candidates per vertex prevents that, because
 *  each vertex's answer is defensible on its own; only relaxing the field
 *  against its neighbours makes adjacent answers agree.
 *
 *  Blunt and effective, and the same technique the hand-tuned void_rigs.py pass
 *  settled on for this exact mesh. Mutates in place. */
export function smoothWeights(joints, weights, adj, opts = {}) {
  const { iters = 8, mix = 0.5, influences = 4 } = opts;
  const n = adj.length;
  let cur = [];
  for (let i = 0; i < n; i++) {
    const m = new Map();
    for (let k = 0; k < influences; k++) {
      const w = weights[i * influences + k];
      if (w > 0) m.set(joints[i * influences + k], (m.get(joints[i * influences + k]) ?? 0) + w);
    }
    cur.push(m);
  }
  for (let it = 0; it < iters; it++) {
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      const ns = adj[i];
      if (!ns.length) {
        next[i] = cur[i];
        continue;
      }
      const acc = new Map();
      for (const j of ns) {
        for (const [b, w] of cur[j]) acc.set(b, (acc.get(b) ?? 0) + w / ns.length);
      }
      const out = new Map();
      for (const b of new Set([...acc.keys(), ...cur[i].keys()])) {
        out.set(b, (1 - mix) * (cur[i].get(b) ?? 0) + mix * (acc.get(b) ?? 0));
      }
      next[i] = out;
    }
    cur = next;
  }
  // Back to the fixed-width glTF budget: top K, renormalized.
  for (let i = 0; i < n; i++) {
    const top = [...cur[i].entries()].sort((a, b) => b[1] - a[1]).slice(0, influences);
    const sum = top.reduce((s, e) => s + e[1], 0) || 1;
    for (let k = 0; k < influences; k++) {
      joints[i * influences + k] = top[k]?.[0] ?? 0;
      weights[i * influences + k] = (top[k]?.[1] ?? 0) / sum;
    }
  }
}

/** Connected components over the welded node graph.
 *  Returns { label, count } with label[node] the component id. */
export function connectedComponents(nodeCount, indices, nodeOf, adjacency = null) {
  const adj = adjacency ?? buildAdjacency(nodeCount, indices, nodeOf);
  const label = new Int32Array(nodeCount).fill(-1);
  let count = 0;
  const stack = [];
  for (let s = 0; s < nodeCount; s++) {
    if (label[s] !== -1) continue;
    label[s] = count;
    stack.length = 0;
    stack.push(s);
    while (stack.length) {
      const x = stack.pop();
      for (const y of adj[x]) {
        if (label[y] === -1) {
          label[y] = count;
          stack.push(y);
        }
      }
    }
    count++;
  }
  return { label, count };
}

/** Make every small disconnected shell travel as one rigid piece.
 *
 *  After welding, the Horror still has 58 separate shells: the horn thicket is
 *  loose geometry with no topological path to the head. A shell whose vertices
 *  each pick their own bone shears itself apart under animation, and a
 *  diffusion solver orphans it entirely. So a shell is given the weights that
 *  the bone owning its CENTROID would give, applied to every vertex in it: the
 *  shell then rides that bone as one piece, which is what a horn does.
 *
 *  Shells bigger than `maxShellNodes` are left alone: a large component is real
 *  articulated body, not a decoration, and rigidifying it would freeze a limb.
 *  Mutates `joints`/`weights` in place and returns how many shells it rewrote. */
export function rigidifyShells(nodeJoints, nodeWeights, label, count, influences, opts = {}) {
  const { maxShellNodes = Infinity, nodePos = null } = opts;
  const members = Array.from({ length: count }, () => []);
  for (let n = 0; n < label.length; n++) members[label[n]].push(n);
  let rewritten = 0;
  for (let c = 0; c < count; c++) {
    const nodes = members[c];
    if (nodes.length > maxShellNodes) continue;
    // The shell's representative weights: the member nearest the centroid, so
    // the choice reflects the shell as a whole rather than one arbitrary corner.
    let src = nodes[0];
    if (nodePos) {
      const c0 = [0, 0, 0];
      for (const n of nodes) {
        c0[0] += nodePos[n][0] / nodes.length;
        c0[1] += nodePos[n][1] / nodes.length;
        c0[2] += nodePos[n][2] / nodes.length;
      }
      let bd = Infinity;
      for (const n of nodes) {
        const d = dist2(nodePos[n], c0);
        if (d < bd) {
          bd = d;
          src = n;
        }
      }
    }
    const base = Array.from({ length: influences }, (_, k) => [
      nodeJoints[src * influences + k],
      nodeWeights[src * influences + k],
    ]);
    for (const n of nodes) {
      if (n === src) continue;
      for (let k = 0; k < influences; k++) {
        nodeJoints[n * influences + k] = base[k][0];
        nodeWeights[n * influences + k] = base[k][1];
      }
    }
    rewritten++;
  }
  return rewritten;
}
