// Closes a topology hole at the bridge/top of the M_Head mesh's nose in the
// shared modular character GLB (public/models/chars/modular/warrior_modular.glb).
//
// Root cause: the ten vertices ringing the top of the male nose bridge
// (theta ~77 to ~136 in the head's own bounding-sphere frame, |az| <= 20,
// see src/render/characters/stubble.ts `headAngles`) form a closed boundary
// loop with no triangles capping it, so the mesh is open there: looking down
// the nose from above or from the side shows straight into the empty head
// interior. The equivalent loop does not exist on F_Head, which is why the
// defect is male-only. This is a genuine authoring gap in the shipped asset,
// not a winding/culling issue (no inverted triangle normals were found near
// the nose).
//
// Fix: triangulate the existing boundary loop as a fan and append the new
// triangles to the primitive's index buffer. No new vertices, positions,
// normals, UVs or skin weights are added: every loop vertex already carries
// complete, correct per-vertex data from its neighbouring (already-capped)
// triangles, so reusing those same vertex indices for the new cap keeps
// shading, UVs and skinning consistent with the surrounding surface.
//
//   node scripts/fix_male_head_nose_hole.mjs                 # in place
//   node scripts/fix_male_head_nose_hole.mjs <in.glb> [out]  # one model
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const DEFAULT_GLB = 'public/models/chars/modular/warrior_modular.glb';
const HEAD_NODE = 'M_Head';

// The nose-bridge hole loop, in head-local bounding-sphere angles.
const NOSE_WINDOW = { minTheta: 70, maxTheta: 140, maxAz: 25 };

const DEG = 180 / Math.PI;

function headFrame(pos, elSize, count) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) {
      const v = pos[i * elSize + a];
      if (v < lo[a]) lo[a] = v;
      if (v > hi[a]) hi[a] = v;
    }
  }
  const c = lo.map((v, i) => (v + hi[i]) / 2);
  const h = lo.map((v, i) => Math.max(1e-6, (hi[i] - v) / 2));
  return { c, h };
}

function angles(frame, x, y, z) {
  const nx = (x - frame.c[0]) / frame.h[0];
  const ny = (y - frame.c[1]) / frame.h[1];
  const nz = (z - frame.c[2]) / frame.h[2];
  const len = Math.hypot(nx, ny, nz) || 1;
  const theta = Math.acos(Math.max(-1, Math.min(1, ny / len))) * DEG;
  const az = Math.atan2(nx / len, nz / len) * DEG;
  return { theta, az };
}

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function getV(arr, i, stride) {
  return [arr[i * stride], arr[i * stride + 1], arr[i * stride + 2]];
}

function cross(u, v) {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

function dot(u, v) {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}

async function main() {
  const inFile = process.argv[2] || DEFAULT_GLB;
  const outFile = process.argv[3] || inFile;

  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const doc = await io.read(inFile);
  const root = doc.getRoot();
  const node = root.listNodes().find((n) => n.getName() === HEAD_NODE);
  if (!node) throw new Error(`no ${HEAD_NODE} node in ${inFile}`);
  const mesh = node.getMesh();
  const prim = mesh.listPrimitives()[0];

  const posAcc = prim.getAttribute('POSITION');
  const normAcc = prim.getAttribute('NORMAL');
  const idxAcc = prim.getIndices();

  const pos = posAcc.getArray();
  const posEl = posAcc.getElementSize();
  const norm = normAcc.getArray();
  const normEl = normAcc.getElementSize();
  const vcount = posAcc.getCount();
  const idx = Array.from(idxAcc.getArray());

  const frame = headFrame(pos, posEl, vcount);

  // Find boundary edges (used by exactly one triangle) inside the nose window.
  const edgeCount = new Map();
  const triCount = idx.length / 3;
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3];
    const b = idx[t * 3 + 1];
    const c = idx[t * 3 + 2];
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = edgeKey(x, y);
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    }
  }

  const inWindow = (i) => {
    const [x, y, z] = getV(pos, i, posEl);
    const { theta, az } = angles(frame, x, y, z);
    return (
      theta >= NOSE_WINDOW.minTheta &&
      theta <= NOSE_WINDOW.maxTheta &&
      Math.abs(az) <= NOSE_WINDOW.maxAz
    );
  };

  const adjacency = new Map();
  for (const [k, count] of edgeCount) {
    if (count !== 1) continue;
    const [aStr, bStr] = k.split('_');
    const a = Number(aStr);
    const b = Number(bStr);
    if (!inWindow(a) && !inWindow(b)) continue;
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }

  if (adjacency.size === 0) {
    console.log(`no open boundary loop found near the nose in ${HEAD_NODE}; nothing to fix`);
    return;
  }

  // The nose window can straddle TWO separate boundary loops: the nostril
  // underside cut (intentional, low on the nose, theta >= ~118) and the
  // nose-bridge hole this fix targets (theta reaching much higher, into the
  // bridge/forehead transition). Split into connected components and pick
  // the one that reaches furthest up the head (lowest theta): that is the
  // bridge hole, never the nostril cut.
  const visited = new Set();
  const components = [];
  for (const v of adjacency.keys()) {
    if (visited.has(v)) continue;
    const comp = [];
    const stack = [v];
    visited.add(v);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      for (const nb of adjacency.get(cur)) {
        if (!visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      }
    }
    components.push(comp);
  }
  const minTheta = (comp) =>
    Math.min(
      ...comp.map((i) => {
        const [x, y, z] = getV(pos, i, posEl);
        return angles(frame, x, y, z).theta;
      }),
    );
  components.sort((a, b) => minTheta(a) - minTheta(b));
  const target = new Set(components[0]);
  console.log(
    `found ${components.length} boundary loop(s) near the nose; targeting the one reaching theta=${minTheta(
      components[0],
    ).toFixed(1)} (${target.size} vertices)`,
  );

  // Walk the (single, closed) target loop into vertex order.
  const start = [...target][0];
  const loop = [start];
  let prev = null;
  let cur = start;
  while (true) {
    const neighbors = adjacency.get(cur).filter((n) => target.has(n));
    if (!neighbors || neighbors.length !== 2) {
      throw new Error(`boundary near the nose is not a simple closed loop at vertex ${cur}`);
    }
    const next = neighbors[0] === prev ? neighbors[1] : neighbors[0];
    if (next === start) break;
    loop.push(next);
    prev = cur;
    cur = next;
  }
  if (loop.length !== target.size) {
    throw new Error(
      `boundary walk visited ${loop.length} of ${target.size} vertices; loop is not simple`,
    );
  }
  console.log(`nose-bridge hole loop: ${loop.length} vertices`, loop);

  // Fan-triangulate from loop[0]; pick winding per triangle so the face
  // normal agrees with the averaged vertex normals it spans (outward-facing,
  // matching the rest of the head surface).
  const newTris = [];
  for (let i = 1; i < loop.length - 1; i++) {
    const a = loop[0];
    const b = loop[i];
    const c = loop[i + 1];
    const pa = getV(pos, a, posEl);
    const pb = getV(pos, b, posEl);
    const pc = getV(pos, c, posEl);
    const faceNormal = cross(
      [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]],
      [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]],
    );
    const vn = [0, 0, 0];
    for (const vi of [a, b, c]) {
      const n = getV(norm, vi, normEl);
      vn[0] += n[0];
      vn[1] += n[1];
      vn[2] += n[2];
    }
    if (dot(faceNormal, vn) >= 0) {
      newTris.push(a, b, c);
    } else {
      newTris.push(a, c, b);
    }
  }
  console.log(`capping with ${newTris.length / 3} triangles`);

  const outIdx = idx.concat(newTris);
  const IndexArrayType = vcount > 65535 ? Uint32Array : Uint16Array;
  const newIdxAcc = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new IndexArrayType(outIdx))
    .setBuffer(idxAcc.getBuffer());
  prim.setIndices(newIdxAcc);
  idxAcc.dispose();

  await io.write(outFile, doc);
  console.log(`wrote ${outFile}`);
}

await main();
