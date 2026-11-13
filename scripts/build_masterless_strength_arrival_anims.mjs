// Build the Masterless Strength's two arrival clips (Smith's Heart final boss,
// docs/design/raid/smith_heart.md section 5.17, "The arrival"): the scene
// opens on the boss kneeling dormant like a cracked statue and ends with it
// standing up and roaring. Its rig ships Kneel (a fall to one knee, 1.5 s),
// KneelIdle (the knee held, breathing) and Idle, but nothing that rises, so
// both clips are authored by pose-sample-and-blend (scripts/anim/
// pose_blend.mjs) off those donors. No Blender: the poses all exist.
//
//   Dormant: KneelIdle's first pose held still for its loop (a statue does
//   not breathe), the stance the scene opens on.
//   Rise: the knee pressed down a breath deeper (Kneel past its landing,
//   the gather), then Kneel played backwards and slower than it fell (the
//   push up off the planted fist reads heavy, a colossus finding its legs),
//   then eased into Idle's first pose so the base idle picks up seamlessly.
//
// Usage: node scripts/build_masterless_strength_arrival_anims.mjs [--preview]
// Output: public/models/creatures/smith_heart_masterless_strength_arrival_anims.glb
// (0 meshes/skins, 2 clips: Dormant, Rise)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  createGlbIO,
  easeInOutQuad,
  indexClip,
  mergePoses,
  poseValue,
  pushPoseRamp,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'public/models/creatures/smith_heart_masterless_strength.glb');
const OUT = resolve(
  ROOT,
  'public/models/creatures/smith_heart_masterless_strength_arrival_anims.glb',
);
const PREVIEW_OUT = resolve(ROOT, 'tmp/masterless_strength_arrival_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const kneelIdx = indexClip(root, 'Kneel');
const kneelIdleIdx = indexClip(root, 'KneelIdle');
const idleIdx = indexClip(root, 'Idle');
const allKeys = new Set([...kneelIdx.keys(), ...kneelIdleIdx.keys(), ...idleIdx.keys()]);
const donorFor = (key) => kneelIdx.get(key) ?? kneelIdleIdx.get(key) ?? idleIdx.get(key);

// Donor poses (Kneel 1.5 s: standing at 0, the knee lands about 0.6 and
// presses lowest about 0.9; KneelIdle 2 s; Idle 3 s).
const P_knelt = samplePose(kneelIdleIdx, 0);
const P_press = samplePose(kneelIdx, 0.9);
const P_stood = samplePose(kneelIdx, 0);
const P_idle = samplePose(idleIdx, 0);
const P_all = mergePoses(P_knelt, P_press, P_stood, P_idle);
const hold = (pose) => (key) => poseValue(pose, key, P_all);

// ---- Dormant: the held knee, perfectly still ----------------------------------------------
const dormant = [
  [0, hold(P_knelt)],
  [2, hold(P_knelt)],
];
const { animation: dormantAnim } = bakeClip(doc, {
  clipName: 'Dormant',
  channelKeys: allKeys,
  timeline: dormant,
  donorFor,
});

// ---- Rise ----------------------------------------------------------------------------------
const GATHER = 0.45;
const PUSH_END = 1.75;
const END = 2.4;
const rise = [[0, hold(P_knelt)]];
pushPoseRamp(rise, {
  fromTime: 0,
  toTime: GATHER,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_knelt,
  toPose: P_press,
  fallback: P_all,
});
// Kneel backwards from its press (0.9 s) to standing (0 s), eased so the
// push starts slow and heavy and finishes upright.
const PUSH_STEPS = 16;
for (let s = 1; s <= PUSH_STEPS; s++) {
  const f = s / PUSH_STEPS;
  const t = GATHER + (PUSH_END - GATHER) * f;
  const pose = samplePose(kneelIdx, 0.9 * (1 - easeInOutQuad(f)));
  rise.push([t, hold(pose)]);
}
pushPoseRamp(rise, {
  fromTime: PUSH_END,
  toTime: END,
  steps: 6,
  ease: easeInOutQuad,
  fromPose: P_stood,
  toPose: P_idle,
  fallback: P_all,
});
const { animation: riseAnim } = bakeClip(doc, {
  clipName: 'Rise',
  channelKeys: allKeys,
  timeline: rise,
  donorFor,
});

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + clips): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, [dormantAnim, riseAnim]);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
