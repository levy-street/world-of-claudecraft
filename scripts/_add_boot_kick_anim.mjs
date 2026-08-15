// Synthesize the Boot kick clip ('Kick_A') into the rogue GLB, on the shared
// KayKit rig skeleton (same approach as _add_garrote_choke_anim /
// _add_pummel_punch_anim: compose keyframed offsets onto each bone's rest
// rotation; unanimated bones hold their pose). Boot (kick) is the rogue's
// interrupt and every shipped rogue clip is a dagger swing - there is no leg
// attack to map (owner: "should be a kick animation not a swing"), so this
// authors one: weight rocks back into a guard, the right knee chambers high,
// then the leg snaps straight forward at gut height and recoils back through
// a re-chamber to ready.
//
// Axes/signs solved numerically against rogue.glb by the same FK grid search
// the choke used (scripts/_tmp_rogue_leg_fk.mjs): the rig faces +Z, hip
// flexion forward is local -x on upperleg.r, the knee bend is local +x on
// lowerleg.r, and a torso lean BACK is -x on hips/spine/chest. Solved key
// poses for the right ankle: chamber [-0.171,0.551,0.305] (ux -116, lx 56),
// snap [-0.145,0.641,0.337] (ux -104, lx ~0 - full extension, the chibi
// KayKit leg tops out at hip height, which IS gut height on these
// proportions). Arms hold the punch script's chest guard throughout.
//
//   node scripts/_add_boot_kick_anim.mjs                 # rogue.glb in place
//   node scripts/_add_boot_kick_anim.mjs <in.glb> [out]  # one model
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
// The kick. Six keys: ready (guard up, weight rocked back onto the left leg)
// -> chamber (right knee driven high, foot tucked under the thigh) -> snap
// (the leg fires straight out at gut height, toes driven forward, torso
// counter-leaned back) -> catch (extension decays, the retraction starts) ->
// re-chamber -> plant back to ready. playAttack runs one-shots at timeScale
// 1.3, so the 0.7s clip lands the snap ~0.2s in - the same contact beat the
// punch and the choke hit.
// ---------------------------------------------------------------------------
const KEY_TIMES = [0, 0.14, 0.26, 0.38, 0.52, 0.7];

const KICK = {
  // kicking leg: back stagger -> high chamber -> straight snap -> recoil
  'upperleg.r': [{ axis: 'x', degs: [8, -116, -104, -95, -60, 8] }],
  'lowerleg.r': [{ axis: 'x', degs: [10, 56, 4, 14, 45, 10] }],
  // ankle: relaxed until the snap points the foot into the target
  'foot.r': [{ axis: 'x', degs: [0, 8, 26, 20, 6, 0] }],
  // support leg gives a little at the knee so the kick sits into the hip
  'upperleg.l': [{ axis: 'x', degs: [-4, -10, -8, -8, -6, -4] }],
  'lowerleg.l': [{ axis: 'x', degs: [6, 16, 12, 12, 10, 6] }],
  // torso coils slightly forward into the chamber, then counter-leans back
  // through the snap (the kicker's balance), settling back upright
  chest: [{ axis: 'x', degs: [2, 3, -6, -5, 0, 2] }],
  spine: [{ axis: 'x', degs: [1, 2, -6, -5, 0, 1] }],
  hips: [{ axis: 'x', degs: [0, -4, -8, -7, -3, 0] }],
  // arms hold the chest guard (the punch script's solved guard pose)
  'upperarm.r': [
    { axis: 'z', degs: [-90, -90, -84, -86, -90, -90] },
    { axis: 'x', degs: [-120, -120, -116, -118, -120, -120] },
  ],
  'lowerarm.r': [{ axis: 'z', degs: [60, 62, 56, 58, 60, 60] }],
  'upperarm.l': [
    { axis: 'z', degs: [90, 90, 84, 86, 90, 90] },
    { axis: 'x', degs: [-120, -120, -116, -118, -120, -120] },
  ],
  'lowerarm.l': [{ axis: 'z', degs: [-60, -62, -56, -58, -60, -60] }],
};

const CLIP_NAME = 'Kick_A';
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
  for (const [boneName, rotTracks] of Object.entries(KICK)) {
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
