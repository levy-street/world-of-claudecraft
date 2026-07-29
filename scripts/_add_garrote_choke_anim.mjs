// Synthesize the Throat Wire choke clip ('Garrote_Choke') into the rogue GLB,
// on the shared KayKit rig skeleton (same approach as _add_pummel_punch_anim /
// _add_sweep_slice_anim: compose keyframed offsets onto each bone's rest
// rotation; unanimated bones hold their pose). Throat Wire (garrote) is a
// wire strangle from behind, and every shipped rogue clip is a dagger swing -
// there is no grab/choke to map (owner: "should be something appropriate for
// the name"), so this authors one: both hands snap up to neck height looping
// the wire over, then a sharp two-handed pull back to the chest and a brief
// hold before releasing.
//
// Axes/signs reuse the punch/sweep scripts' numerically measured frame,
// re-solved against rogue.glb by the same FK grid search (rest hand.r at
// [-0.787,1.107,0], head at [0,1.241,0]): the rig faces +Z, the right arm
// extends along -X in rest, lowerarm.r flexes about local +z (mirrored -z on
// the left), and an upperarm pose composes rest * Rz * Rx. Solved key poses
// for the hand world targets: ready low guard [-0.30,0.73,0.29], reach at
// neck height close together [-0.12,1.05,0.50], pull yanked tight to the
// collarbones [-0.23,1.08,0.07] - mirrored on the left.
//
//   node scripts/_add_garrote_choke_anim.mjs                 # rogue.glb in place
//   node scripts/_add_garrote_choke_anim.mjs <in.glb> [out]  # one model
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
// The choke. Five keys: ready (low close-quarters guard) -> reach (both hands
// snapped up to neck height, close together - the wire looped over the
// victim's head) -> pull (the sharp two-handed yank back to the collarbones,
// elbows folded, torso leaned back) -> hold (the choke held, torso settling a
// touch deeper) -> release back to ready. playAttack runs one-shots at
// timeScale 1.3, so the 0.7s clip lands the yank ~0.2s in - the same contact
// beat the punch and the authored chops hit; the long 0.26->0.54 dwell IS the
// strangle read.
// ---------------------------------------------------------------------------
const KEY_TIMES = [0, 0.12, 0.26, 0.54, 0.7];

const CHOKE = {
  // both arms mirror: up-and-forward reach, then the fold-back pull
  'upperarm.r': [
    { axis: 'z', degs: [-14, 60, -6, -6, -14] },
    { axis: 'x', degs: [-90, 8, 90, 90, -90] },
  ],
  'lowerarm.r': [{ axis: 'z', degs: [60, 70, 150, 150, 60] }],
  'upperarm.l': [
    { axis: 'z', degs: [14, -60, 6, 6, 14] },
    { axis: 'x', degs: [-90, 8, 90, 90, -90] },
  ],
  'lowerarm.l': [{ axis: 'z', degs: [-60, -70, -150, -150, -60] }],
  // torso leans into the reach, then hauls BACK through the pull and settles
  // deeper over the hold (the strangler's counterweight)
  chest: [{ axis: 'x', degs: [4, 8, -10, -12, 4] }],
  spine: [{ axis: 'x', degs: [2, 4, -6, -7, 2] }],
  hips: [{ axis: 'x', degs: [0, 2, -3, -3, 0] }],
};

const CLIP_NAME = 'Garrote_Choke';
const DEFAULT_GLB = 'public/models/chars/players/rogue.glb';

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
  for (const [boneName, rotTracks] of Object.entries(CHOKE)) {
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
