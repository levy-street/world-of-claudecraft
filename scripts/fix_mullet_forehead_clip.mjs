// Pulls back a single overshot vertex on the H2_mullet hairstyle (the shared
// modular character GLB) that clipped into the forehead.
//
// Root cause: H2_mullet's front fringe is a chain of vertices running down the
// centerline of the face (small |x|, near the mesh's own front-facing extreme
// on its local Z axis) from the crown down to the browline. One vertex in that
// chain, index 253, sits noticeably further down that chain than its four
// direct neighbors: decoded (per-primitive-normalized) position [0.025,
// -0.198, -0.769] against a neighbor average around [0.013, -0.033, -0.717].
// Every other vertex in the chain sits close to its own neighbor average; only
// v253 overshoots past the browline, reading on screen as a sharp downward
// notch cutting into the center of the forehead (the reported "bump"; a
// neighbouring peak looking taller by contrast is the same artifact seen from
// the other side). This is a genuine single-vertex authoring outlier, not a
// stylistic spike: the surrounding fringe silhouette is otherwise even.
//
// Fix: Laplacian-smooth v253 toward the average of its own topological
// neighbors (blended, not fully snapped, so it keeps its own character
// instead of being flattened into its neighbors). No vertices or triangles
// are added or removed, and no other primitive is touched: the position is
// written directly into H2_mullet's own quantized POSITION accessor (raw =
// round(real * 32767), the same normalized-SHORT decode this accessor
// already uses), then the file is re-serialized through the same
// meshopt encoder path every modular-GLB fixer in this repo uses, so every
// untouched byte in the file is unaffected.
//
//   node scripts/fix_mullet_forehead_clip.mjs                 # in place
//   node scripts/fix_mullet_forehead_clip.mjs <in.glb> [out]  # one model
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const DEFAULT_GLB = 'public/models/chars/modular/warrior_modular.glb';
const HAIR_NODE = 'H2_mullet';
const TARGET_VERTEX = 253;
const BLEND = 0.7;

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
  const node = root.listNodes().find((n) => n.getName() === HAIR_NODE);
  if (!node) throw new Error(`no ${HAIR_NODE} node in ${inFile}`);
  const mesh = node.getMesh();
  const prim = mesh.listPrimitives()[0];

  const posAcc = prim.getAttribute('POSITION');
  const idxAcc = prim.getIndices();
  const count = posAcc.getCount();
  const elSize = posAcc.getElementSize();

  const P = [];
  for (let i = 0; i < count; i++) P.push(posAcc.getElement(i, [0, 0, 0]));

  const idx = Array.from(idxAcc.getArray());
  const triCount = idx.length / 3;
  const adjacency = new Map();
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3];
    const b = idx[t * 3 + 1];
    const c = idx[t * 3 + 2];
    for (const [x, y] of [
      [a, b],
      [b, a],
      [b, c],
      [c, b],
      [c, a],
      [a, c],
    ]) {
      if (!adjacency.has(x)) adjacency.set(x, new Set());
      adjacency.get(x).add(y);
    }
  }

  const neighbors = [...(adjacency.get(TARGET_VERTEX) ?? [])];
  if (neighbors.length === 0) {
    throw new Error(`v${TARGET_VERTEX} has no topological neighbors in ${HAIR_NODE}`);
  }

  const avg = [0, 0, 0];
  for (const n of neighbors) {
    avg[0] += P[n][0];
    avg[1] += P[n][1];
    avg[2] += P[n][2];
  }
  avg[0] /= neighbors.length;
  avg[1] /= neighbors.length;
  avg[2] /= neighbors.length;

  const old = P[TARGET_VERTEX];
  const next = [
    old[0] + (avg[0] - old[0]) * BLEND,
    old[1] + (avg[1] - old[1]) * BLEND,
    old[2] + (avg[2] - old[2]) * BLEND,
  ];
  console.log(
    `v${TARGET_VERTEX}: [${old.map((x) => x.toFixed(4)).join(', ')}] -> [${next
      .map((x) => x.toFixed(4))
      .join(', ')}] (blend ${BLEND} toward ${neighbors.length}-neighbor average)`,
  );

  const arr = posAcc.getArray();
  for (let c = 0; c < 3; c++) {
    const raw = Math.max(-32767, Math.min(32767, Math.round(next[c] * 32767)));
    arr[TARGET_VERTEX * elSize + c] = raw;
  }
  posAcc.setArray(arr);

  await io.write(outFile, doc);
  console.log(`wrote ${outFile}`);
}

await main();
