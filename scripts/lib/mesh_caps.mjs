// Find and cap the open boundary loops of a triangle mesh.
//
// Why this exists
// ---------------
// The level-20 armor sets ship as separate pieces (Torso, Legs, Arms, ...) that
// were cut apart by the forge, and three of the five are OPEN shells: the torso
// has no bottom, the legs have no top, the sleeves have no shoulder end. With
// front-face culling that is not a subtle seam, it is a hole you see the sky
// through, worst at the waist where the torso's and the legs' rims face each
// other across a gap.
//
// Capping each rim with a fan makes every piece a closed shell, so the worst case
// becomes a glimpse of the armor's own interior instead of the skybox. It does NOT
// move, resize or reshape anything and adds no vertices: the visible silhouette is
// untouched, and the added faces sit inside the model.
//
// Pure and dependency-free: callers pass plain arrays, so the CLI and the Vitest
// guard drive identical math.

/**
 * Collapse vertices that share a position. Boundary detection has to run on
 * welded ids or every UV/normal split would read as a hole in the surface.
 */
export function weldVertices(position, eps = 1e-5) {
  const map = new Map();
  const count = Math.floor(position.length / 3);
  const remap = new Int32Array(count);
  /** One original index per welded id, so cap triangles can reference real
   *  vertices that already carry UVs and skin weights. */
  const representative = [];
  const quant = (v) => Math.round(v / eps);
  for (let i = 0; i < count; i++) {
    const key = `${quant(position[i * 3])},${quant(position[i * 3 + 1])},${quant(position[i * 3 + 2])}`;
    let id = map.get(key);
    if (id === undefined) {
      id = representative.length;
      map.set(key, id);
      representative.push(i);
    }
    remap[i] = id;
  }
  return { remap, representative, uniqueCount: representative.length };
}

/** Triangle count for an indexed or non-indexed mesh. */
export function triangleCount(indices, positionLength) {
  return indices ? Math.floor(indices.length / 3) : Math.floor(positionLength / 9);
}

/**
 * The open boundary of a mesh, split into clean CYCLES and everything else.
 *
 * An edge is a boundary when exactly one triangle uses it, and that triangle
 * traverses it one specific way. A cap must traverse it the other way, or the
 * closed shell ends up with two faces pointing the same direction through one edge.
 *
 * Only a rim that forms a single closed cycle can be fanned from one of its own
 * vertices and provably come out watertight: the edges touching the fan hub are
 * closed by their two neighbouring triangles, which needs each rim vertex to have
 * exactly one incoming and one outgoing boundary edge. A branching or pinched rim
 * does not, so it is reported in `open` rather than capped crooked.
 */
export function boundaryRims(indices, remap, triCount) {
  const useCount = new Map();
  const directed = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < triCount; t++) {
    const v = [0, 1, 2].map((k) => remap[indices ? indices[t * 3 + k] : t * 3 + k]);
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue; // degenerate
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      const key = edgeKey(a, b);
      useCount.set(key, (useCount.get(key) ?? 0) + 1);
      if (!directed.has(key)) directed.set(key, [a, b]);
    }
  }

  const outgoing = new Map();
  const indegree = new Map();
  const edges = [];
  for (const [key, n] of useCount) {
    if (n !== 1) continue;
    const [a, b] = directed.get(key);
    edges.push([a, b]);
    outgoing.set(a, outgoing.has(a) ? null : b); // null marks a branch point
    indegree.set(b, (indegree.get(b) ?? 0) + 1);
  }

  const cycles = [];
  const consumed = new Set();
  for (const [start, step] of outgoing) {
    if (consumed.has(start) || step === null) continue;
    const walk = [];
    let cursor = start;
    let ok = true;
    while (true) {
      if (cursor === start && walk.length > 0) break; // closed
      if (consumed.has(cursor) || walk.length > outgoing.size) {
        ok = false;
        break;
      }
      const nxt = outgoing.get(cursor);
      if (nxt === undefined || nxt === null || (indegree.get(cursor) ?? 0) !== 1) {
        ok = false;
        break;
      }
      walk.push(cursor);
      cursor = nxt;
    }
    if (ok && walk.length >= 3) {
      for (const v of walk) consumed.add(v);
      cycles.push(walk);
    }
  }

  const open = edges.filter(([a, b]) => !consumed.has(a) || !consumed.has(b));
  return { cycles, open, slivers: cycles.filter((c) => c.length < 3).length };
}

/**
 * Fan-cap every clean cycle, using an EXISTING rim vertex as the hub.
 *
 * Adding a fresh centroid vertex would mean inventing its skin weights, and these
 * rims span most of the waist: a large cap rigidly bound to one guessed weight set
 * swings out through the plates as soon as the character bends. Fanning from a
 * vertex the rim already owns means every cap vertex carries the artist's own
 * binding, so the cap deforms exactly with the hole it fills, and the file gains no
 * vertices at all.
 *
 * Returns triangles in original-index space.
 */
export function capCycles(mesh, cycles) {
  const { position, representative } = mesh;
  const triangles = [];
  for (const cycle of cycles) {
    const centroid = [0, 0, 0];
    for (const id of cycle) {
      const o = representative[id];
      centroid[0] += position[o * 3];
      centroid[1] += position[o * 3 + 1];
      centroid[2] += position[o * 3 + 2];
    }
    for (let k = 0; k < 3; k++) centroid[k] /= cycle.length;

    // The most central rim vertex keeps the fan's triangles as fat as possible.
    let hubAt = 0;
    let best = Infinity;
    for (let i = 0; i < cycle.length; i++) {
      const o = representative[cycle[i]];
      const d = Math.hypot(
        position[o * 3] - centroid[0],
        position[o * 3 + 1] - centroid[1],
        position[o * 3 + 2] - centroid[2],
      );
      if (d < best) {
        best = d;
        hubAt = i;
      }
    }
    const hub = representative[cycle[hubAt]];
    // The rim traverses v[i] -> v[i+1], so each cap triangle traverses it back.
    for (let step = 1; step < cycle.length - 1; step++) {
      const a = representative[cycle[(hubAt + step) % cycle.length]];
      const b = representative[cycle[(hubAt + step + 1) % cycle.length]];
      triangles.push(b, a, hub);
    }
  }
  return { triangles };
}

/**
 * Edges that break the closed-orientable contract: used other than exactly twice,
 * or used twice in the SAME direction. Zero of both means the shell is watertight
 * and consistently wound, which is the whole point of capping.
 */
export function orientationDefects(indices, remap, triCount) {
  const seen = new Map();
  let boundary = 0;
  let flipped = 0;
  for (let t = 0; t < triCount; t++) {
    const v = [0, 1, 2].map((k) => remap[indices ? indices[t * 3 + k] : t * 3 + k]);
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      seen.set(`${a}>${b}`, (seen.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  for (const [key, n] of seen) {
    const [a, b] = key.split('>');
    if (n > 1) flipped += n - 1;
    if (!seen.has(`${b}>${a}`)) boundary++;
  }
  return { boundary, flipped };
}
