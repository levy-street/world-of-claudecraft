// Synthesize the horizontal reap clip ('1H_Melee_Attack_Slice_Horizontal')
// into the warrior GLB, on the shared KayKit Rig_Medium skeleton (same
// approach as _add_pummel_punch_anim.mjs: compose keyframed offsets onto each
// bone's rest rotation; unanimated bones hold their pose). The shipped KayKit
// player clips carry no sideways sword sweep - Chop is the classic
// top-to-bottom and Slice_Diagonal falls across the body - so the wide flat
// reap Reaping Arc (cleave) and Revenge need (owner: "sideways sword sweep,
// not the classic top to bottom") had nothing to play. This authors one.
//
// Axes/signs reuse the punch script's numerically measured frame (FK
// world-position solves against the authored chop clips, re-validated by the
// same solver for these poses): the rig faces +Z, the right arm extends along
// -X in rest, lowerarm.r flexes about local +z, and an upperarm pose composes
// rest * Rz * Rx. Key poses were solved for hand.r world targets riding a
// FLAT chest-height arc: ready low-front [-0.48,0.68,0.08], chamber wound
// back-right [-0.61,1.11,-0.32], contact extended front-center
// [-0.04,1.01,0.64], follow-through across to the left [0.44,1.03,0.33] -
// the torso coils away and then drives THROUGH the reap.
//
//   node scripts/_add_sweep_slice_anim.mjs                 # knight.glb in place
//   node scripts/_add_sweep_slice_anim.mjs <in.glb> [out]  # one model
//
// Idempotent: an existing clip of this name is dropped before re-authoring;
// the shipped KayKit clips are untouched.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const qAbout = (axis, angle) => {
  const [x, y, z] = AXES[axis];
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
};
const deg = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------------------
// The reap. Five keys: ready (sword low in front) -> chamber (blade wound over
// the right shoulder, torso coiled away) -> contact (the flat reap through
// front-center at chest height) -> follow-through (carried across to the left,
// torso driven through) -> ready. playAttack runs one-shots at timeScale 1.3,
// so the 0.7s clip lands its contact ~0.25s in - the same beat the punch and
// the authored chops hit.
// ---------------------------------------------------------------------------
const KEY_TIMES = [0, 0.14, 0.32, 0.5, 0.7];

const SWEEP = {
  // sweeping arm: the z track walks the extended arm across the horizontal
  // plane (chamber right-back -> center -> left-front); x stays near zero so
  // the arc never dips into a chop
  'upperarm.r': [
    { axis: 'z', degs: [-70, -16, 78, 100, -70] },
    { axis: 'x', degs: [-90, 0, -10, -8, -90] },
  ],
  'lowerarm.r': [{ axis: 'z', degs: [50, 60, 0, 8, 50] }],
  // off arm holds the guard with a small counter-pump
  'upperarm.l': [
    { axis: 'z', degs: [60, 68, 50, 56, 60] },
    { axis: 'x', degs: [-130, -122, -110, -124, -130] },
  ],
  'lowerarm.l': [{ axis: 'z', degs: [-60, -70, -52, -58, -60] }],
  // torso coils away from the reap and drives through it (on chibi
  // proportions the shoulders, not the arm, carry the width of the sweep)
  chest: [{ axis: 'y', degs: [0, -24, 14, 34, 0] }],
  spine: [
    { axis: 'y', degs: [0, -12, 9, 18, 0] },
    { axis: 'x', degs: [0, -2, 5, 3, 0] },
  ],
  hips: [{ axis: 'y', degs: [0, -5, 4, 8, 0] }],
};

const CLIP_NAME = '1H_Melee_Attack_Slice_Horizontal';
const DEFAULT_GLB = 'public/models/chars/players/knight.glb';

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

async function author(inFile, outFile) {
  const doc = await io.read(inFile);
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) {
    if (anim.getName() === CLIP_NAME) anim.dispose();
  }
  const nodesByName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const buffer = root.listBuffers()[0];
  const anim = doc.createAnimation(CLIP_NAME);
  const input = doc
    .createAccessor(`${CLIP_NAME}Times`)
    .setType('SCALAR')
    .setArray(new Float32Array(KEY_TIMES))
    .setBuffer(buffer);
  for (const [boneName, rotTracks] of Object.entries(SWEEP)) {
    const node = nodesByName.get(boneName);
    if (!node) {
      console.warn(`  [skip] no bone '${boneName}' in ${inFile}`);
      continue;
    }
    const rest = node.getRotation();
    const out = new Float32Array(KEY_TIMES.length * 4);
    for (let k = 0; k < KEY_TIMES.length; k++) {
      let q = [...rest];
      for (const { axis, degs } of rotTracks) q = qMul(q, qAbout(axis, deg(degs[k])));
      // normalize against float drift so the sampler stays a unit quaternion
      const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      out.set([q[0] / len, q[1] / len, q[2] / len, q[3] / len], k * 4);
    }
    const output = doc
      .createAccessor(`${CLIP_NAME}_${boneName}`)
      .setType('VEC4')
      .setArray(out)
      .setBuffer(buffer);
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(output)
      .setInterpolation('LINEAR');
    const channel = doc
      .createAnimationChannel()
      .setTargetNode(node)
      .setTargetPath('rotation')
      .setSampler(sampler);
    anim.addSampler(sampler).addChannel(channel);
  }
  await io.write(outFile, doc);
  console.log(`${inFile} -> ${outFile}: authored ${CLIP_NAME}`);
}

const args = process.argv.slice(2);
const inFile = args[0] ?? DEFAULT_GLB;
const outFile = args[1] ?? inFile;
await author(inFile, outFile);
