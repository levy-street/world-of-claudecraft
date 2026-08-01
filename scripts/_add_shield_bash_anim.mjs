// Synthesize the Shieldcrack shield bash ('Shield_Bash') into the warrior GLB,
// on the shared KayKit Rig_Medium skeleton (same approach as
// _add_pummel_punch_anim.mjs: compose keyframed offsets onto each bone's rest
// rotation; unanimated bones hold their pose). Shieldcrack (shield_slam) is a
// shield-face slam, but every shipped KayKit swing drives the sword arm - the
// warrior's shield rides handslot.l (manifest offhandSlot 1), so a left-arm
// swing carries the shield with it. This authors that swing: the OFFHAND arm
// does the work and the main (weapon) hand stays back the whole clip.
//
// Axes/signs reuse the punch script's numerically measured frame (FK
// world-position solves against the authored chop clips, re-validated by the
// same solver for these poses): the rig faces +Z, the LEFT arm extends along
// +X in rest, lowerarm.l flexes about local -z (the right side's mirror), and
// an upperarm pose composes rest * Rz * Rx. Key poses were solved for hand.l
// world targets: guard front-left [0.49,0.85,0.26], chamber pulled across the
// body [0.10,0.95,0.28] with the torso coiled toward it, slam driven straight
// forward at chest height [0.12,0.99,0.67] as the torso whips back through,
// then a short recoil settling into guard.
//
//   node scripts/_add_shield_bash_anim.mjs                 # knight.glb in place
//   node scripts/_add_shield_bash_anim.mjs <in.glb> [out]  # one model
//
// Idempotent: an existing Shield_Bash clip is dropped before re-authoring;
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
// The bash. Five keys: guard (shield held front-left) -> chamber (shield
// pulled across the chest, torso coiled behind it) -> slam (the shield face
// driven straight forward, torso whipped through) -> recoil -> guard.
// playAttack runs one-shots at timeScale 1.3, so the 0.7s clip lands its
// slam ~0.25s in - the same beat the punch and the authored chops hit.
// ---------------------------------------------------------------------------
const KEY_TIMES = [0, 0.14, 0.32, 0.5, 0.7];

const BASH = {
  // shield arm: guard is itself a big composed offset from the T-pose rest,
  // so every key carries the full absolute offset
  'upperarm.l': [
    { axis: 'z', degs: [76, -12, -72, 20, 76] },
    { axis: 'x', degs: [-128, -144, -12, -100, -128] },
  ],
  'lowerarm.l': [{ axis: 'z', degs: [-70, -80, 0, -55, -70] }],
  // weapon arm holds low and BACK throughout (owner: the sword sits this one
  // out), with a small counter-pump against the slam
  'upperarm.r': [
    { axis: 'z', degs: [-40, -55, -30, -40, -40] },
    { axis: 'x', degs: [-50, -35, -60, -50, -50] },
  ],
  'lowerarm.r': [{ axis: 'z', degs: [40, 55, 35, 40, 40] }],
  // torso coils toward the chambered shield, then drives through the slam
  chest: [{ axis: 'y', degs: [0, 20, -16, -6, 0] }],
  spine: [
    { axis: 'y', degs: [0, 10, -10, -4, 0] },
    { axis: 'x', degs: [0, 0, 6, 2, 0] },
  ],
  hips: [
    { axis: 'y', degs: [0, 4, -4, -2, 0] },
    { axis: 'x', degs: [0, -1, 4, 1, 0] },
  ],
};

const CLIP_NAME = 'Shield_Bash';
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
  for (const [boneName, rotTracks] of Object.entries(BASH)) {
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
