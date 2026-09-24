// Make a locally rigged (rig-manual) mob's back load (a sack, its ropes, the coins
// in it) move as ONE piece with the chest, and optionally its head with the head.
//
// rig-manual weights every vertex by distance to the bones, so a big sack worn on
// the back takes a share of the upper arms and stretches like rubber whenever the
// arms rise (Cheer, casts), and a hunched mob's face, held out in front of the
// chest, bends with the chest instead of turning with the head. The load is found
// as whole mesh pieces: the mesh is welded by position, split into connected
// islands, and every island except the body (the largest) whose centre sits
// BEHIND the --behind line goes to --joint alone. Pieces in front (eyes, teeth,
// earrings) keep their weights. With --neck, every body vertex above that height
// goes to the head joint, blended over --band so the neck still follows the chest;
// a hunched mob holds its face out in FRONT of the shoulders and lower than them,
// so --chin with --front also hands the head everything above --chin that sits
// further forward than --front. Front pieces (eyes, teeth) whose centre is head
// by the same test go to the head whole. --width keeps the head rules inside
// |x| <= width, so hands and claws held out at face height (a T-posed mob with
// long arms) stay on the arms.
//
//   node scripts/assets/hoard_mobs/rigid_pack.mjs <in.glb> <out.glb> [--behind <z>]
//        [--joint chest] [--neck <y> [--band <y>] [--chin <y> --front <z>] [--width <x>]]
//
// Lengths are in the model's REST pose in world units: Y up, the mob facing +Z,
// so its back is negative Z (Blender shows the same numbers as z and -y). The
// stored positions are in the rig's bind space, which the KayKit rig turns
// away from its rest pose, so each vertex is skinned to rest first (with the
// weights it came in with) and judged there. Changing weights never moves a
// vertex in the bind pose, only how it follows the bones.
import { mat4Multiply, openGlb, saveGlb } from '../../asset_pipeline/lib/glb.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const [src, dst] = args;
const behind = Number(opt('behind', '0'));
const jointName = opt('joint', 'chest');
const neck = Number(opt('neck', 'NaN'));
const band = Number(opt('band', '0.12'));
const chin = Number(opt('chin', 'NaN'));
const front = Number(opt('front', 'NaN'));
const width = Number(opt('width', 'Infinity'));

const doc = await openGlb(src);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const jointIndex = (name) => {
  const i = skin.listJoints().findIndex((j) => j.getName() === name);
  if (i < 0) throw new Error(`no "${name}" joint in this skin`);
  return i;
};
const target = jointIndex(jointName);
const head = Number.isFinite(neck) ? jointIndex('head') : -1;

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** How much of a rest-pose point belongs to the head (0 to 1). */
const headShare = (pt) => {
  if (Math.abs(pt[0]) > width) return 0;
  const high = smooth(neck - band, neck + band, pt[1]);
  if (!Number.isFinite(chin) || !Number.isFinite(front)) return high;
  const face = smooth(chin - band, chin + band, pt[1]) * smooth(front - band, front + band, pt[2]);
  return Math.max(high, face);
};
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

// Per joint: rest world matrix times inverse bind, the bind-to-rest carry.
const ibms = skin.getInverseBindMatrices();
const toRest = skin
  .listJoints()
  .map((joint, i) => mat4Multiply(joint.getWorldMatrix(), ibms.getElement(i, new Array(16))));

let moved = 0;
let pieces = 0;
let headMoved = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh || node.getSkin() !== skin) continue;
  for (const prim of mesh.listPrimitives()) {
    const position = prim.getAttribute('POSITION');
    const jointsAttr = prim.getAttribute('JOINTS_0');
    const weightsAttr = prim.getAttribute('WEIGHTS_0');
    const indices = prim.getIndices();
    if (!position || !jointsAttr || !weightsAttr || !indices) continue;
    const count = position.getCount();
    const p = [0, 0, 0];
    const pts = [];
    // Weld: UV seams split one surface into many vertex runs; a shared
    // position makes them one piece again.
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
    const jv = [0, 0, 0, 0];
    const wv = [0, 0, 0, 0];
    for (let v = 0; v < count; v++) {
      position.getElement(v, p);
      jointsAttr.getElement(v, jv);
      weightsAttr.getElement(v, wv);
      const rest = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        if (wv[k] <= 0) continue;
        const q = apply(toRest[jv[k]], p);
        for (let c = 0; c < 3; c++) rest[c] += wv[k] * q[c];
      }
      pts.push(rest);
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
    for (const island of sorted.slice(1)) {
      const centre = [0, 1, 2].map(
        (c) => island.reduce((s, v) => s + pts[v][c], 0) / island.length,
      );
      let bone = -1;
      if (centre[2] < behind) {
        bone = target;
        pieces++;
      } else if (head >= 0 && headShare(centre) >= 0.5) {
        bone = head;
        headMoved += island.length;
      }
      if (bone < 0) continue;
      for (const v of island) {
        jointsAttr.setElement(v, [bone, 0, 0, 0]);
        weightsAttr.setElement(v, [1, 0, 0, 0]);
        if (bone === target) moved++;
      }
    }
    if (head < 0) continue;
    const j = [0, 0, 0, 0];
    const w = [0, 0, 0, 0];
    for (const v of sorted[0]) {
      const share = headShare(pts[v]);
      if (share <= 0) continue;
      jointsAttr.getElement(v, j);
      weightsAttr.getElement(v, w);
      for (let k = 0; k < 4; k++) if (j[k] === head) w[k] = 0;
      const rest = w[0] + w[1] + w[2] + w[3];
      for (let k = 0; k < 4; k++) w[k] = rest > 0 ? (w[k] / rest) * (1 - share) : 0;
      const own = j.findIndex((id, k) => id === head && w[k] === 0);
      const slot = own >= 0 ? own : w.indexOf(Math.min(...w));
      j[slot] = head;
      w[slot] = rest > 0 ? share : 1;
      const sum = w[0] + w[1] + w[2] + w[3];
      for (let k = 0; k < 4; k++) w[k] /= sum;
      jointsAttr.setElement(v, j);
      weightsAttr.setElement(v, w);
      headMoved++;
    }
  }
}
await saveGlb(doc, dst);
console.log(
  `rigid pack: ${pieces} pieces, ${moved} vertices on "${jointName}"` +
    (head >= 0 ? `, ${headMoved} on "head" above ${neck}` : '') +
    `, wrote ${dst}`,
);
