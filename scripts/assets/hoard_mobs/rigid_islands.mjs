// Make every loose piece of a locally rigged (rig-manual) mob move whole with ONE
// bone: claws, spikes, the little mushrooms that grow on a body. rig-manual weights
// each vertex by distance, so a long thin piece sitting between two bones (a claw
// on the elbow, a spike on the shoulder) is split between them and stretches into
// a needle when they part. The mesh is welded by position and split into connected
// islands; every island except the body (the largest) goes wholly to the joint
// that already held most of it. The body keeps its smooth weights.
//
//   node scripts/assets/hoard_mobs/rigid_islands.mjs <in.glb> <out.glb> [--max <verts>]
//
// --max skips islands bigger than that (default 4000), so a separately modelled
// arm or cap is never pinned to one joint by accident.
import { openGlb, saveGlb } from '../../asset_pipeline/lib/glb.mjs';

const args = process.argv.slice(2);
const [src, dst] = args;
const mi = args.indexOf('--max');
const maxVerts = Number(mi >= 0 ? args[mi + 1] : 4000);

const doc = await openGlb(src);
const root = doc.getRoot();
let pieces = 0;
let verts = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh || !node.getSkin()) continue;
  for (const prim of mesh.listPrimitives()) {
    const position = prim.getAttribute('POSITION');
    const jointsAttr = prim.getAttribute('JOINTS_0');
    const weightsAttr = prim.getAttribute('WEIGHTS_0');
    const indices = prim.getIndices();
    if (!position || !jointsAttr || !weightsAttr || !indices) continue;
    const count = position.getCount();
    const parent = new Int32Array(count).map((_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    const byPos = new Map();
    const p = [0, 0, 0];
    for (let v = 0; v < count; v++) {
      position.getElement(v, p);
      const key = p.map((c) => Math.round(c * 1000)).join(',');
      const seen = byPos.get(key);
      if (seen === undefined) byPos.set(key, v);
      else union(v, seen);
    }
    const idx = indices.getArray();
    for (let t = 0; t < idx.length; t += 3) {
      union(idx[t], idx[t + 1]);
      union(idx[t + 1], idx[t + 2]);
    }
    const islands = new Map();
    for (let v = 0; v < count; v++) {
      const r = find(v);
      if (!islands.has(r)) islands.set(r, []);
      islands.get(r).push(v);
    }
    const sorted = [...islands.values()].sort((a, b) => b.length - a.length);
    const j = [0, 0, 0, 0];
    const w = [0, 0, 0, 0];
    for (const island of sorted.slice(1)) {
      if (island.length > maxVerts) continue;
      const total = new Map();
      for (const v of island) {
        jointsAttr.getElement(v, j);
        weightsAttr.getElement(v, w);
        for (let k = 0; k < 4; k++) if (w[k] > 0) total.set(j[k], (total.get(j[k]) ?? 0) + w[k]);
      }
      let best = -1;
      let most = -1;
      for (const [joint, sum] of total) {
        if (sum > most) {
          most = sum;
          best = joint;
        }
      }
      if (best < 0) continue;
      for (const v of island) {
        jointsAttr.setElement(v, [best, 0, 0, 0]);
        weightsAttr.setElement(v, [1, 0, 0, 0]);
      }
      pieces++;
      verts += island.length;
    }
  }
}
await saveGlb(doc, dst);
console.log(
  `rigid islands: ${pieces} pieces (${verts} vertices) pinned to one joint, wrote ${dst}`,
);
