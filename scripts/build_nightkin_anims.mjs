// Build the nightkin family's bespoke attack clip (issue #2889). mob_nightkin
// shares the literal FLOATING ClipMap object, by reference, with 7 other
// unrelated families in src/render/characters/manifest.ts (a ghost, a
// dragon, a flying demon imp, a glowing wisp among them), so a masked
// nightkin spirit "attacks" with the exact same Headbutt/Punch as all of
// them. Authors one distinct clip by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs) off donor poses already baked into the
// shipped tribal.glb itself: Flying_Idle (the hover bookend), Punch (a
// forward lunge, this rig has no arms either, so "Punch" is a torso/mask
// lunge), and the two currently-unused gesture clips this GLB ships but
// nothing wires, No (a head shake) and Yes (a head nod). No Blender: same
// technique, same module, as scripts/build_elemental_anims.mjs (the closer
// precedent, sharing this exact clip vocabulary off the same donor pack).
//
// Distinct from the elemental's single-pass "molten lurch": this samples
// BOTH extremes of No (a real side-to-side sway, not one snapshot) before
// the lunge, and both extremes of Yes (a nod down then a recovery back up)
// after impact, reading as a slower, more ritualistic "masked spirit whirl
// and strike" rather than a fast charge.
//
//   Nightkin_Attack: sway left then right (No, sampled at both extremes,
//   gathering momentum), coil into the lunge (Punch windup), the committed
//   forward strike (Punch impact), a sharp downward mask-nod on impact
//   then a recovery back up (Yes, sampled at both extremes), settle back
//   to the hover idle.
//
// Usage: node scripts/build_nightkin_anims.mjs [--preview]
// Output: public/models/creatures/nightkin_ability_anims.glb (0 meshes/
// skins, 1 clip: Nightkin_Attack)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  createGlbIO,
  easeInOutQuad,
  easeOutCubic,
  indexClip,
  mergePoses,
  poseValue,
  pushPoseRamp,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'public/models/creatures/tribal.glb');
const OUT = resolve(ROOT, 'public/models/creatures/nightkin_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/nightkin_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Flying_Idle');
const punchIdx = indexClip(root, 'Punch');
const noIdx = indexClip(root, 'No');
const yesIdx = indexClip(root, 'Yes');

const allKeys = new Set([...idleIdx.keys(), ...punchIdx.keys(), ...noIdx.keys(), ...yesIdx.keys()]);
const donorFor = (key) =>
  punchIdx.get(key) ?? yesIdx.get(key) ?? noIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Flying_Idle 1.167s,
// Punch 1.167s, No 1.167s, Yes 1.167s).
const P_idle = samplePose(idleIdx, 0.3);
const P_swayLeft = samplePose(noIdx, 0.25); // the head-shake's early extreme
const P_swayRight = samplePose(noIdx, 0.75); // the head-shake's later extreme
const P_windup = samplePose(punchIdx, 0.15); // early lean-back before the lunge
const P_impact = samplePose(punchIdx, 0.8); // full forward lunge
const P_nodDown = samplePose(yesIdx, 0.3); // sharp downward mask-nod
const P_nodUp = samplePose(yesIdx, 0.75); // the mask rights itself

// This rig's Flying_Idle carries only 10 of the 20+ bones Punch touches (a
// gesture clip and the flight loop don't animate the same channel set), so a
// single donor pose is an incomplete fallback (pose_blend.mjs mergePoses
// doc, the exact trap build_elemental_anims.mjs's own comment names): merge
// every donor pose once so every channel any of them animates has SOME
// fallback value instead of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_swayLeft, P_swayRight, P_windup, P_impact, P_nodDown, P_nodUp);

const timeline = [[0, (k) => poseValue(P_idle, k, P_all)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.2,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_idle,
  toPose: P_swayLeft,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.2,
  toTime: 0.4,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_swayLeft,
  toPose: P_swayRight,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.4,
  toTime: 0.55,
  steps: 2,
  ease: easeOutCubic,
  fromPose: P_swayRight,
  toPose: P_windup,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.55,
  toTime: 0.8,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_windup,
  toPose: P_impact,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.8,
  toTime: 0.95,
  steps: 2,
  ease: easeOutCubic,
  fromPose: P_impact,
  toPose: P_nodDown,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.95,
  toTime: 1.1,
  steps: 2,
  ease: easeOutCubic,
  fromPose: P_nodDown,
  toPose: P_nodUp,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 1.1,
  toTime: 1.4,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_nodUp,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Nightkin_Attack',
  channelKeys: allKeys,
  timeline,
  donorFor,
});

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + clip): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, [animation]);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
