// Make a locally rigged (rig-manual) boss's head move as ONE piece.
//
// rig-manual weights every vertex by distance to the KayKit bones, and a chibi
// head sits so close to the shoulders that its cheeks, hood or horns pick up the
// arm and chest bones: every swing then drags the face like jelly (playtest).
// Here every vertex of the head is handed to the head joint alone, with a short
// blend band at the neck so the collar still follows the body.
//
//   node scripts/assets/hoard_bosses/rigid_head.mjs <in.glb> <out.glb> --neck <y> [--band <y>]
//        [--radius <r>] [--width <x>] [--behind <z> --lateral <x>] [--above <y>] [--probe]
//
// Heights are in the GLB's bind space (the unit --probe prints). --radius limits
// the head to a column round the head joint (so wings beside it are left alone);
// --width caps how far to either side of it the head reaches (raised hands sit
// beside a chibi head); --behind with --lateral leaves out what is BOTH further back than z and further
// out than x from that joint (wings on the spine); --above lifts every limit over
// a height (so wide horns are still head).
import { openGlb, saveGlb } from '../../asset_pipeline/lib/glb.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const [src, dst] = args;
const probe = args.includes('--probe');
const neck = opt('neck', Number.NaN);
const band = opt('band', 0.12);
const radius = opt('radius', Number.POSITIVE_INFINITY);
const above = opt('above', Number.POSITIVE_INFINITY);
const width = opt('width', Number.POSITIVE_INFINITY);
const behind = opt('behind', Number.NEGATIVE_INFINITY);
const lateral = opt('lateral', Number.POSITIVE_INFINITY);

const doc = await openGlb(src);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const headIndex = joints.findIndex((j) => j.getName() === 'head');
if (headIndex < 0) throw new Error('no "head" joint in this skin');

// The head joint's bind position, for the column centre. Its inverse bind matrix
// is (T S R)^-1, whose translation column is -R^-1 t / s, so for the near-upright
// head joint t is that column negated over the matrix's own scale.
const ibm = skin.getInverseBindMatrices().getElement(headIndex, new Array(16).fill(0));
const scale = Math.hypot(ibm[0], ibm[1], ibm[2]);
const head = [-ibm[12] / scale, -ibm[13] / scale, -ibm[14] / scale];

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

let moved = 0;
let total = 0;
const bounds = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const position = prim.getAttribute('POSITION');
    const jointsAttr = prim.getAttribute('JOINTS_0');
    const weightsAttr = prim.getAttribute('WEIGHTS_0');
    if (!position || !jointsAttr || !weightsAttr) continue;
    const p = [0, 0, 0];
    const j = [0, 0, 0, 0];
    const w = [0, 0, 0, 0];
    for (let v = 0; v < position.getCount(); v++) {
      position.getElement(v, p);
      total++;
      for (let k = 0; k < 3; k++) {
        bounds.min[k] = Math.min(bounds.min[k], p[k]);
        bounds.max[k] = Math.max(bounds.max[k], p[k]);
      }
      if (probe) continue;
      const dx = Math.abs(p[0] - head[0]);
      const dz = p[2] - head[2];
      const inColumn =
        p[1] >= above ||
        (Math.hypot(dx, dz) <= radius && dx <= width && !(dz < behind && dx > lateral));
      if (!inColumn) continue;
      const share = smooth(neck - band, neck + band, p[1]);
      if (share <= 0) continue;
      jointsAttr.getElement(v, j);
      weightsAttr.getElement(v, w);
      for (let k = 0; k < 4; k++) w[k] *= 1 - share;
      let slot = j.findIndex((id, k) => id === headIndex && w[k] >= 0);
      if (slot < 0) slot = w.indexOf(Math.min(...w));
      if (j[slot] !== headIndex) {
        j[slot] = headIndex;
        w[slot] = 0;
      }
      w[slot] += share;
      const sum = w[0] + w[1] + w[2] + w[3];
      for (let k = 0; k < 4; k++) w[k] /= sum;
      jointsAttr.setElement(v, j);
      weightsAttr.setElement(v, w);
      moved++;
    }
  }
}
console.log(
  `head joint at ${head.map((c) => c.toFixed(2))}, bounds y ${bounds.min[1].toFixed(2)} to ${bounds.max[1].toFixed(2)}, x ${bounds.min[0].toFixed(2)} to ${bounds.max[0].toFixed(2)}`,
);
if (!probe) {
  await saveGlb(doc, dst);
  console.log(`rigid head: ${moved} of ${total} vertices, wrote ${dst}`);
}
