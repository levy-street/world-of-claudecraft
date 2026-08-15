// Synthesize the Dirt Toss throw clip ('Dirt_Throw') into the rogue GLB, on
// the shared KayKit rig skeleton (same approach as _add_garrote_choke_anim /
// _add_boot_kick_anim: compose keyframed offsets onto each bone's rest
// rotation; unanimated bones hold their pose). Dirt Toss (blind) flings dirt
// into the target's eyes and every shipped rogue clip is a dagger swing -
// there is no throw to map (owner: "use a throw dirt animation rather than a
// normal swing"), so this authors one: a quick crouch-scoop with the OFF
// hand (the dagger stays in the right), then an underhand fling forward and
// up toward the target's face, with a short follow-through.
//
// Axes/signs solved numerically against rogue.glb by the same FK grid search
// the kick used (scripts/_tmp_rogue_leg_fk.mjs): the rig faces +Z, an
// upperarm pose composes rest * Rz * Rx (lowerarm flexes about local -z on
// the left), hip flexion forward is -x on the upperlegs, knee bend +x on the
// lowerlegs, and torso fold forward is +x on hips/spine/chest. Solved key
// poses for the left hand: scoop [0.278,0.468,0.345] in the deep crouch
// (uz 96, ux -132), backswing low behind the hip [0.336,0.622,-0.211]
// (uz -136, ux -116), fling extended forward-up [0.171,1.167,0.463]
// (uz -100, ux -8).
//
//   node scripts/_add_dirt_throw_anim.mjs                 # rogue.glb in place
//   node scripts/_add_dirt_throw_anim.mjs <in.glb> [out]  # one model
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
// The throw. Six keys: ready -> scoop (deep crouch, the off hand snatches a
// fistful of dirt at the ground) -> backswing (rising, the loaded hand swings
// low behind the hip) -> fling (the underhand release: arm extended forward
// and up at the victim's face, torso opening back) -> follow-through -> ready.
// playAttack runs one-shots at timeScale 1.3, so the 0.7s clip releases the
// fling ~0.22s in - right on the cc poof's 0.15s impact beat.
// ---------------------------------------------------------------------------
const KEY_TIMES = [0, 0.12, 0.2, 0.28, 0.5, 0.7];

const THROW = {
  // the throwing (off) arm: scoop at the ground, low backswing, underhand fling
  'upperarm.l': [
    { axis: 'z', degs: [14, 96, -136, -100, -80, 14] },
    { axis: 'x', degs: [-90, -132, -116, -8, -20, -90] },
  ],
  'lowerarm.l': [{ axis: 'z', degs: [-60, 5, -5, 10, 5, -60] }],
  // the dagger hand rides a low counter-guard, lifting a touch on the fling
  'upperarm.r': [
    { axis: 'z', degs: [-14, -20, -18, -30, -22, -14] },
    { axis: 'x', degs: [-90, -70, -80, -95, -90, -90] },
  ],
  'lowerarm.r': [{ axis: 'z', degs: [60, 50, 55, 65, 60, 60] }],
  // torso: fold deep into the scoop, unwind through the backswing, open BACK
  // on the release, settle
  chest: [{ axis: 'x', degs: [2, 10, 4, -6, -2, 2] }],
  spine: [{ axis: 'x', degs: [1, 12, 3, -5, -2, 1] }],
  hips: [{ axis: 'x', degs: [0, 14, 4, -4, -1, 0] }],
  // both knees give for the crouch and straighten through the fling
  'upperleg.r': [{ axis: 'x', degs: [-2, -30, -12, 2, 0, -2] }],
  'lowerleg.r': [{ axis: 'x', degs: [4, 44, 18, 2, 2, 4] }],
  'upperleg.l': [{ axis: 'x', degs: [-2, -30, -12, -6, -2, -2] }],
  'lowerleg.l': [{ axis: 'x', degs: [4, 44, 18, 8, 4, 4] }],
};

const CLIP_NAME = 'Dirt_Throw';
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
  for (const [boneName, rotTracks] of Object.entries(THROW)) {
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
