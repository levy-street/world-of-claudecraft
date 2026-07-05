// Synthesize a 'Hit' flinch clip into the Stone Cantor GLB (same approach as
// _add_bell_anim.mjs authored the bell's clips): the Raid 02 batch ships no
// hit-react take, so playHit() had nothing to play. The flinch keyframes the
// spine/neck/head joints only, composing a short lean-back onto each bone's
// rest rotation; bones a one-shot does not animate hold their last pose in the
// mixer, so the rest of the body freezes naturally under the 0.45s flinch.
//
//   node scripts/_add_cantor_hit_anim.mjs [in.glb] [out.glb]
//
// Defaults edit public/models/creatures/stone_cantor.glb in place. Idempotent:
// an existing 'Hit' clip is dropped before re-authoring; the four shipped
// clips (Idle / Cast / Walk / Death) are untouched.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const IN = process.argv[2] ?? 'public/models/creatures/stone_cantor.glb';
const OUT = process.argv[3] ?? IN;

// Flinch: snap back fast, settle back to rest. Angles are radians about each
// joint's local X (pitch); negative pitches the torso/head backward on this rig.
const KEY_TIMES = [0, 0.08, 0.26, 0.45];
const FLINCH_BONES = [
  { name: 'mixamorigSpine1', peak: -0.1 },
  { name: 'mixamorigSpine2', peak: -0.14 },
  { name: 'mixamorigNeck', peak: -0.18 },
  { name: 'mixamorigHead', peak: -0.24 },
];
// Envelope over KEY_TIMES: rest, full flinch, partial recovery, rest.
const ENVELOPE = [0, 1, 0.3, 0];

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qAboutX = (angle) => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(IN);
const root = doc.getRoot();

for (const anim of root.listAnimations()) {
  if (anim.getName() === 'Hit') anim.dispose();
}

const nodesByName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const buffer = root.listBuffers()[0];
const anim = doc.createAnimation('Hit');
const input = doc
  .createAccessor('HitTimes')
  .setType('SCALAR')
  .setArray(new Float32Array(KEY_TIMES))
  .setBuffer(buffer);

for (const { name, peak } of FLINCH_BONES) {
  const node = nodesByName.get(name);
  if (!node) {
    console.error(`bone not found: ${name}`);
    process.exit(1);
  }
  const rest = node.getRotation();
  const frames = ENVELOPE.flatMap((amount) => qMul(rest, qAboutX(peak * amount)));
  const output = doc
    .createAccessor(`HitRot_${name}`)
    .setType('VEC4')
    .setArray(new Float32Array(frames))
    .setBuffer(buffer);
  const sampler = doc
    .createAnimationSampler()
    .setInput(input)
    .setOutput(output)
    .setInterpolation('LINEAR');
  anim
    .addSampler(sampler)
    .addChannel(
      doc
        .createAnimationChannel()
        .setTargetNode(node)
        .setTargetPath('rotation')
        .setSampler(sampler),
    );
}

await io.write(OUT, doc);
const clips = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT} with clips: ${clips.join(', ')}`);
