// Author Shaman performances on the existing barbarian rig. Release silhouettes
// come from native spell, block, dual-wield and cheer donors, recomposed with
// upper-body offsets, nonlinear timing and offline foot IK. No gameplay motion.
// node scripts/build_shaman_polish_anims.mjs [--preview]
// Output: mesh-free shaman_polish_anims.glb; --preview retains the source rig.
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import { createPlantedStance } from './anim/planted_stance.mjs';
import {
  bakeClip,
  createGlbIO,
  indexClip,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';
import {
  breatheShamanPose,
  mixShamanPose,
  SHAMAN_PERFORMANCES,
  shamanPose,
} from './anim/shaman_performances.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const io = createGlbIO();
const doc = await io.read(resolve(ROOT, 'public/models/chars/players/barbarian.glb'));
const root = doc.getRoot();
const idleIndex = indexClip(root, 'Idle');
const idle = samplePose(idleIndex, 0.3);
const animations = [];
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) ** 3;

function bake(name, duration, poses, stanceMarks, loop = false) {
  const planted = createPlantedStance(root, idle, stanceMarks);
  // Explicit authored beats join 60 Hz baking so holds land at exactly .15s.
  const times = new Set(poses.map((p) => p[0]));
  for (let i = 0; i <= Math.ceil(duration * 60); i++) times.add(Math.min(duration, i / 60));
  const timeline = [...times]
    .sort((a, b) => a - b)
    .map((time) => {
      let index = 1;
      while (index < poses.length - 1 && time > poses[index][0]) index++;
      const [ta, a] = poses[index - 1];
      const [tb, b, easing = smooth] = poses[index];
      const w = easing(Math.max(0, Math.min(1, (time - ta) / (tb - ta))));
      let pose = mixShamanPose(a, b, w);
      if (loop) pose = breatheShamanPose(pose, (time / duration) * Math.PI * 2);
      pose = planted(pose, time);
      return [time, (key) => pose.get(key)];
    });
  animations.push(
    bakeClip(doc, {
      clipName: name,
      channelKeys: idle.keys(),
      timeline,
      donorFor: (key) => idleIndex.get(key),
    }).animation,
  );
}

for (const [
  id,
  name,
  loadDonor,
  loadTime,
  releaseDonor,
  releaseTime,
  chest,
  right,
  left,
  depth,
  duration,
  hold,
  loop,
] of SHAMAN_PERFORMANCES) {
  const load = shamanPose(
    idle,
    indexClip(root, loadDonor),
    loadTime,
    [-chest[0] * 0.5, -chest[1] * 0.55, -chest[2] * 0.4],
    right.map((v) => -v * 0.3),
    left.map((v) => -v * 0.3),
  );
  const contact = shamanPose(idle, indexClip(root, releaseDonor), releaseTime, chest, right, left);
  const follow = mixShamanPose(contact, idle, 0.22);
  const releaseStart = loop ? load : idle;
  const settle = Math.min(duration - 0.2, hold + 0.19);
  // Short loading interval, a held anticipation, very fast release, then a
  // perceptible contact hold. Recovery takes most of the performance's time.
  bake(
    `Shaman_${name}`,
    duration,
    [
      [0, releaseStart],
      [0.06, load, easeOut],
      [0.095, load],
      [0.15, contact, (t) => t ** 2],
      [hold, contact],
      [settle, follow, easeOut],
      [duration, idle],
    ],
    [
      [0, loop ? depth * 0.45 : 0, 0],
      [0.08, depth * 0.65, -chest[1] * 0.12],
      [0.15, depth, chest[1] * 0.14],
      [hold, depth, chest[1] * 0.14],
      [settle, depth * 0.6, chest[1] * 0.08],
      [duration, 0, 0],
    ],
  );
  if (loop) {
    bake(
      `Shaman_${name}_Charge`,
      loop,
      [
        [0, load],
        [loop, load],
      ],
      [
        [0, depth * 0.45, 0],
        [loop * 0.25, depth * 0.45 + 0.006, 0],
        [loop * 0.75, depth * 0.45 - 0.006, 0],
        [loop, depth * 0.45, 0],
      ],
      true,
    );
  }
  console.log(
    `${id}: contact=0.15s hold=${hold}s recovery=${duration}s${loop ? ` charge=${loop}s` : ''}`,
  );
}

if (process.argv.includes('--preview')) {
  await mkdir(resolve(ROOT, 'tmp'), { recursive: true });
  await io.write(resolve(ROOT, 'tmp/shaman_polish_anims_preview.glb'), doc);
}
stripToAnimationsOnly(doc, animations);
await doc.transform(prune(), dedup());
const output = resolve(ROOT, 'public/models/chars/players/shaman_polish_anims.glb');
await io.write(output, doc);
console.log(`Wrote ${animations.length} mesh-free Shaman performances: ${output}`);
