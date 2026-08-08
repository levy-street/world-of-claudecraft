// Build the bear family's bespoke attack clip (issue #2889 round 2).
// mob_bear shares the literal BIPED14 ClipMap object, by reference, with 5
// unrelated families in src/render/characters/manifest.ts (mob_yeti,
// mob_murloc, mob_troll, mob_demon, mob_demonalt), so the brown-tinted
// yetialt.glb bear "attacks" with the same generic Punch/Weapon as a frog
// murloc or an orc troll. Authors one distinct clip by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs) off donor poses already baked into the
// shipped yetialt.glb itself: Idle (the bookend), Punch (the base biped
// attack donor), and Duck, a currently UNUSED clip this GLB ships (a full
// crouch-and-rise cycle). No Blender: see
// .claude/skills/blender-anim-pipeline/SKILL.md.
//
//   Bear_Attack: wind up off Punch's early pull-back, drop into a low
//   crouch (Duck's low point, weight sinking toward the ground), swipe
//   forward into the full Punch impact (a ground-swipe maul), rise back up
//   out of the crouch (Duck's later, rising frames), settle to idle.
//
// Usage: node scripts/build_bear_anims.mjs [--preview]
// Output: public/models/creatures/bear_ability_anims.glb (0 meshes/skins,
// 1 clip: Bear_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/yetialt.glb');
const OUT = resolve(ROOT, 'public/models/creatures/bear_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/bear_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const punchIdx = indexClip(root, 'Punch');
const duckIdx = indexClip(root, 'Duck');

const allKeys = new Set([...idleIdx.keys(), ...punchIdx.keys(), ...duckIdx.keys()]);
const donorFor = (key) => punchIdx.get(key) ?? duckIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 1.000s,
// Punch 0.833s, Duck 1.667s).
const P_idle = samplePose(idleIdx, 0.3);
const P_windup = samplePose(punchIdx, 0.12); // early pull-back before the swipe
const P_crouch = samplePose(duckIdx, 0.55); // low crouch, weight sinking down
const P_swipe = samplePose(punchIdx, 0.65); // full forward swing, the maul impact
const P_rise = samplePose(duckIdx, 1.35); // rising back up out of the crouch

// Locomotion (Idle) and the gesture donors (Punch, Duck) don't all animate
// the same channel set on this rig, so a single donor pose is an incomplete
// fallback: merge every donor pose once so every channel any of them
// animates has SOME fallback instead of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_windup, P_crouch, P_swipe, P_rise);

const timeline = [[0, (k) => poseValue(P_idle, k, P_windup)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.16,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_windup,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.16,
  toTime: 0.36,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_windup,
  toPose: P_crouch,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.36,
  toTime: 0.58,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_crouch,
  toPose: P_swipe,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.58,
  toTime: 0.78,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_swipe,
  toPose: P_rise,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.78,
  toTime: 1.05,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_rise,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Bear_Attack',
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
