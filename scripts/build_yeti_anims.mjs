// Build the yeti family's bespoke attack clip (issue #2889 round 2).
// mob_yeti shares the literal BIPED14 ClipMap object, by reference, with 5
// unrelated families in src/render/characters/manifest.ts (mob_bear,
// mob_murloc, mob_troll, mob_demon, mob_demonalt), so the ice-white
// yetialt.glb yeti "attacks" with the same generic Punch/Weapon as a frog
// murloc or an orc troll. Authors one distinct clip by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs) off donor poses already baked into the
// shipped yetialt.glb itself: Idle (the bookend), Weapon (the two-hand
// overhead attack donor), and No, a currently UNUSED clip this GLB ships (a
// head shake). No Blender: see .claude/skills/blender-anim-pipeline/SKILL.md.
//
//   Yeti_Attack: raise the weapon overhead (Weapon's early windup), shake
//   the head side to side (No's peak sway, a roar), swing down through the
//   full Weapon impact pose, settle to idle.
//
// Usage: node scripts/build_yeti_anims.mjs [--preview]
// Output: public/models/creatures/yeti_ability_anims.glb (0 meshes/skins,
// 1 clip: Yeti_Attack)
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
const OUT = resolve(ROOT, 'public/models/creatures/yeti_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/yeti_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const weaponIdx = indexClip(root, 'Weapon');
const noIdx = indexClip(root, 'No');

const allKeys = new Set([...idleIdx.keys(), ...weaponIdx.keys(), ...noIdx.keys()]);
const donorFor = (key) => weaponIdx.get(key) ?? noIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 1.000s,
// Weapon 0.833s, No 1.667s).
const P_idle = samplePose(idleIdx, 0.3);
const P_raise = samplePose(weaponIdx, 0.14); // overhead weapon raise, early windup
const P_roar = samplePose(noIdx, 0.5); // head-shake roar, peak sway
const P_swing = samplePose(weaponIdx, 0.68); // full overhead downswing impact

// Locomotion (Idle) and the gesture donors (Weapon, No) don't all animate
// the same channel set on this rig: merge every donor pose once so every
// channel any of them animates has SOME fallback instead of null-ing out.
const P_all = mergePoses(P_idle, P_raise, P_roar, P_swing);

const timeline = [[0, (k) => poseValue(P_idle, k, P_raise)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.18,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_raise,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.18,
  toTime: 0.4,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_raise,
  toPose: P_roar,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.4,
  toTime: 0.64,
  steps: 5,
  ease: easeOutCubic,
  fromPose: P_roar,
  toPose: P_swing,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.64,
  toTime: 0.95,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_swing,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Yeti_Attack',
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
