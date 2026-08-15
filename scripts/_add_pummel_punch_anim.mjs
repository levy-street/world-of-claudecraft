// Synthesize the Jawcrack punch clip ('Punch_A') into the warrior GLB, on the
// shared KayKit Rig_Medium skeleton (same approach as the cantor-hit and the
// WOC Fighter kick scripts: compose keyframed offsets onto each bone's rest
// rotation; unanimated bones hold their pose). Jawcrack (pummel) is a bare-fist
// interrupt, and the shipped KayKit player clips are all weapon swings - there
// is no punch to map, so this authors one.
//
// Axes/signs were measured numerically on knight.glb (FK world-position solves
// against the authored 1H/2H chop clips): the rig faces +Z, the right arm
// extends along -X in rest, lowerarm.r flexes about local +z (mirrored -z on
// the left), and an upperarm pose composes rest * Rz * Rx. Key poses were
// solved for hand.r world targets: guard [-0.53,0.78,0.17], chamber pulled to
// the ribs, full extension at jaw height [-0.08,1.0,0.75].
//
//   node scripts/_add_pummel_punch_anim.mjs                 # knight.glb in place
//   node scripts/_add_pummel_punch_anim.mjs <in.glb> [out]  # one model
//
// Idempotent: an existing Punch_A clip is dropped before re-authoring; the
// shipped KayKit clips are untouched.
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
// The punch. Five keys: guard -> chamber (fist wound to the ribs, torso
// coiled) -> full extension (the jaw crack, arm straight at face height,
// torso driven through) -> recoil -> guard. Per bone an ordered list of
// {axis, degs} rotations composed onto rest (one glTF channel per bone), plus
// optional translation tracks. playAttack runs one-shots at timeScale 1.3, so
// the 0.7s clip lands its hit ~0.25s in.
// ---------------------------------------------------------------------------
const KEY_TIMES = [0, 0.14, 0.32, 0.5, 0.7];

const PUNCH = {
  // punching arm: T-pose rest -> guard is itself a big composed offset, so
  // every key carries the full absolute offset from rest
  'upperarm.r': [
    { axis: 'z', degs: [-90, -20, 46, 5, -90] },
    { axis: 'x', degs: [-120, -90, 4, -65, -120] },
  ],
  'lowerarm.r': [{ axis: 'z', degs: [60, 100, 12, 55, 60] }],
  // off arm holds a guard with a small counter-pump
  'upperarm.l': [
    { axis: 'z', degs: [60, 66, 52, 60, 60] },
    { axis: 'x', degs: [-130, -118, -108, -124, -130] },
  ],
  'lowerarm.l': [{ axis: 'z', degs: [-60, -72, -50, -60, -60] }],
  // torso coils away then drives THROUGH the punch (the shoulder, not the
  // arm, carries a cross on chibi proportions)
  chest: [{ axis: 'y', degs: [0, -14, 22, 6, 0] }],
  spine: [
    { axis: 'y', degs: [0, -8, 14, 4, 0] },
    { axis: 'x', degs: [0, -2, 6, 2, 0] },
  ],
  hips: [
    { axis: 'y', degs: [0, -4, 6, 2, 0] },
    { axis: 'x', degs: [0, -2, 5, 1, 0] },
  ],
};

const CLIP_NAME = 'Punch_A';
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
  for (const [boneName, rotTracks] of Object.entries(PUNCH)) {
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
