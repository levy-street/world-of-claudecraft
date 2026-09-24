// Make a locally rigged (rig-manual) boss's gauntlets move as ONE piece each.
//
// rig-manual spreads a hand over the forearm, wrist and hand bones by distance,
// which bends a modelled iron fist like rubber. Every vertex further out along
// the arm than the wrist line is handed to that side's hand joint alone, with a
// short blend band so the cuff still follows the forearm.
//
//   node scripts/assets/hoard_bosses/rigid_hands.mjs <in.glb> <out.glb> --wrist <x> [--band <x>]
//        [--joint hand|wrist]
//
// --wrist is the distance from the body's centre line, in the GLB's bind space
// (rig-manual's scale times the raw model's wrist offset). --joint picks the bone:
// the KayKit clips hold the HAND joint turned some 55 degrees off the forearm (a
// grip pose its own hand meshes are modelled around), so a gauntlet modelled
// straight reads as a bent wrist on it (playtest); the WRIST joint stays in line
// with the forearm.
import { openGlb, saveGlb } from '../../asset_pipeline/lib/glb.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const [src, dst] = args;
const wrist = opt('wrist', Number.NaN);
const band = opt('band', 0.06);
if (!Number.isFinite(wrist)) throw new Error('--wrist <x> is required');

const doc = await openGlb(src);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const index = (name) => {
  const i = joints.findIndex((j) => j.getName() === name);
  if (i < 0) throw new Error(`no "${name}" joint in this skin`);
  return i;
};
// rig-manual's laterality: .l bones own +X of the centre line.
const jointArg = args.indexOf('--joint');
const bone = jointArg >= 0 ? args[jointArg + 1] : 'hand';
const hands = { 1: index(`${bone}.l`), [-1]: index(`${bone}.r`) };
// The centre line is the hips joint's bind X (see rigid_head.mjs for the algebra).
const ibm = skin.getInverseBindMatrices().getElement(index('hips'), new Array(16).fill(0));
const centre = -ibm[12] / Math.hypot(ibm[0], ibm[1], ibm[2]);

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

let moved = 0;
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
      const dx = p[0] - centre;
      const share = smooth(wrist - band, wrist + band, Math.abs(dx));
      if (share <= 0) continue;
      const hand = hands[dx > 0 ? 1 : -1];
      jointsAttr.getElement(v, j);
      weightsAttr.getElement(v, w);
      for (let k = 0; k < 4; k++) w[k] *= 1 - share;
      let slot = j.indexOf(hand);
      if (slot < 0) {
        slot = w.indexOf(Math.min(...w));
        j[slot] = hand;
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
await saveGlb(doc, dst);
console.log(
  `rigid hands: ${moved} vertices beyond ${wrist} of centre ${centre.toFixed(2)}, wrote ${dst}`,
);
