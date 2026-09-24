// Write a copy of a KayKit reference rig whose arms are LONGER, for a mob whose
// concept has long arms (the Mother of Mushrooms reaches nearly twice as far as
// the knight). rig-manual fits a mesh by the height of its arm line, not its
// reach, so a long-armed body on the stock rig hangs its whole forearm and hand
// off the hand bone, and the claws stretch into spikes as soon as the arm moves.
// Rig it onto this stretched copy instead:
//
//   node scripts/assets/hoard_mobs/stretch_arms.mjs <reference.glb> <out.glb> --factor <f>
//   node scripts/asset_pipeline/pipeline.mjs rig-manual --raw <raw.glb> --name <mob> --reference <out.glb>
//
// The upper arm, forearm and wrist-to-hand bones (the local translations of
// lowerarm, wrist, hand and handslot, both sides) grow by --factor: in the rest
// pose, in every clip's translation keys (KayKit clips key them, holding the
// rest length), and in the bind pose, whose inverse bind matrices are rebuilt
// from the stretched local bind transforms. Rotations are untouched, so every
// clip still plays; only the reach changes.
import { mat4Multiply, openGlb, saveGlb } from '../../asset_pipeline/lib/glb.mjs';

const args = process.argv.slice(2);
const [src, dst] = args;
const fi = args.indexOf('--factor');
const factor = Number(fi >= 0 ? args[fi + 1] : NaN);
if (!src || !dst || !(factor > 0)) {
  console.error('usage: stretch_arms.mjs <reference.glb> <out.glb> --factor <f>');
  process.exit(1);
}

const STRETCHED = /^(lowerarm|wrist|hand|handslot)\.[lr]$/;

function invert(m) {
  // Affine inverse (column-major): the rig carries no shear or projection.
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det =
    a[0] * (a[4] * a[8] - a[5] * a[7]) -
    a[3] * (a[1] * a[8] - a[2] * a[7]) +
    a[6] * (a[1] * a[5] - a[2] * a[4]);
  const inv3 = [
    (a[4] * a[8] - a[5] * a[7]) / det,
    (a[2] * a[7] - a[1] * a[8]) / det,
    (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det,
    (a[0] * a[8] - a[2] * a[6]) / det,
    (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det,
    (a[1] * a[6] - a[0] * a[7]) / det,
    (a[0] * a[4] - a[1] * a[3]) / det,
  ];
  const t = [m[12], m[13], m[14]];
  const out = [
    inv3[0],
    inv3[1],
    inv3[2],
    0,
    inv3[3],
    inv3[4],
    inv3[5],
    0,
    inv3[6],
    inv3[7],
    inv3[8],
    0,
    0,
    0,
    0,
    1,
  ];
  for (let r = 0; r < 3; r++) {
    out[12 + r] = -(inv3[r] * t[0] + inv3[3 + r] * t[1] + inv3[6 + r] * t[2]);
  }
  return out;
}

const doc = await openGlb(src);
const root = doc.getRoot();
const skin = root.listSkins()[0];
if (!skin) throw new Error('reference has no skin');
const joints = skin.listJoints();
const index = new Map(joints.map((j, i) => [j, i]));
const ibmAcc = skin.getInverseBindMatrices();
const oldIbm = joints.map((_, i) => ibmAcc.getElement(i, new Array(16)));
const bindWorld = oldIbm.map(invert);

// Local bind transforms (parent bind inverse times child bind), stretched.
const parentOf = new Map();
for (const j of joints) for (const c of j.listChildren()) parentOf.set(c, j);
const newBind = new Array(joints.length);
const solve = (i) => {
  if (newBind[i]) return newBind[i];
  const joint = joints[i];
  const parent = parentOf.get(joint);
  const pi = parent ? index.get(parent) : undefined;
  if (pi === undefined) {
    newBind[i] = bindWorld[i];
    return newBind[i];
  }
  const local = mat4Multiply(oldIbm[pi], bindWorld[i]);
  if (STRETCHED.test(joint.getName())) {
    local[12] *= factor;
    local[13] *= factor;
    local[14] *= factor;
  }
  newBind[i] = mat4Multiply(solve(pi), local);
  return newBind[i];
};
for (let i = 0; i < joints.length; i++) solve(i);
for (let i = 0; i < newBind.length; i++) ibmAcc.setElement(i, invert(newBind[i]));

// Rest pose and every clip's translation keys.
let keys = 0;
for (const joint of joints) {
  if (!STRETCHED.test(joint.getName())) continue;
  joint.setTranslation(joint.getTranslation().map((v) => v * factor));
}
const done = new Set();
for (const anim of root.listAnimations()) {
  for (const channel of anim.listChannels()) {
    const node = channel.getTargetNode();
    if (!node || channel.getTargetPath() !== 'translation') continue;
    if (!STRETCHED.test(node.getName())) continue;
    const out = channel.getSampler()?.getOutput();
    if (!out || done.has(out)) continue;
    done.add(out);
    const arr = out.getArray();
    for (let k = 0; k < arr.length; k++) arr[k] *= factor;
    keys += arr.length / 3;
  }
}
await saveGlb(doc, dst);
console.log(`stretch arms x${factor}: ${keys} translation keys, wrote ${dst}`);
