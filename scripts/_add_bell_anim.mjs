// Add node-transform animation clips to the Meshy-generated Tolling Bell GLB
// (no skeleton, same approach as gen_chicken_cow.mjs): a subtle 'Idle' sway and
// a pronounced 'Roll' rock-and-turn for when the boss driver moves the bell.
// src/render/characters/manifest.ts's TOLLING_BELL ClipMap maps walk/run to
// 'Roll'; the bell never attacks or dies so those alias 'Idle'.
//
//   node scripts/_add_bell_anim.mjs [in.glb] [out.glb]
//
// Defaults edit public/models/creatures/tolling_bell.glb in place. Idempotent:
// existing clips are dropped before re-authoring.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const IN = process.argv[2] ?? 'public/models/creatures/tolling_bell.glb';
const OUT = process.argv[3] ?? IN;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
const root = doc.getRoot();
for (const anim of root.listAnimations()) anim.dispose();

const scene = root.getDefaultScene() ?? root.listScenes()[0];
const node = scene.listChildren()[0];
if (!node) {
  console.error('no root node in scene');
  process.exit(1);
}
// Meshy names the node a UUID with dashes, which GLTFLoader's name sanitizer
// mangles, so the animation tracks would never bind. Give it a clean name.
node.setName('Bell');
const buffer = root.listBuffers()[0] ?? doc.createBuffer();

// Quaternions for rotation about X / Z (bell tips sideways, never yaw-spins,
// a hanging funeral bell reads as swinging, not turning).
const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const qz = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];

function track(anim, path, times, values) {
  const input = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Float32Array(times))
    .setBuffer(buffer);
  const output = doc
    .createAccessor()
    .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
    .setArray(new Float32Array(values.flat()))
    .setBuffer(buffer);
  const sampler = doc
    .createAnimationSampler()
    .setInput(input)
    .setOutput(output)
    .setInterpolation('LINEAR');
  anim
    .addSampler(sampler)
    .addChannel(
      doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler),
    );
}

{
  // Idle: slow, faint pendulum sway, 3s loop.
  const a = doc.createAnimation('Idle');
  track(
    a,
    'rotation',
    [0, 0.75, 1.5, 2.25, 3],
    [qx(0.04), qx(-0.04), qx(0.04), qz(0.05), qx(0.04)],
  );
}
{
  // Roll: hard tolling rock with a small hop, 1s loop.
  const a = doc.createAnimation('Roll');
  track(a, 'rotation', [0, 0.25, 0.5, 0.75, 1], [qx(0.3), qz(0.25), qx(-0.3), qz(-0.25), qx(0.3)]);
  track(
    a,
    'translation',
    [0, 0.25, 0.5, 0.75, 1],
    [
      [0, 0, 0],
      [0, 0.04, 0],
      [0, 0, 0],
      [0, 0.04, 0],
      [0, 0, 0],
    ],
  );
}

await io.write(OUT, doc);
console.log(
  `wrote ${OUT} with clips: ${root
    .listAnimations()
    .map((x) => x.getName())
    .join(', ')}`,
);
