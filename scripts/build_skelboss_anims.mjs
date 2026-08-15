// Build skel_boss's bespoke attack clip (issue #2889). skel_boss is the
// visual for Morthen the Gravecaller (src/sim/content/dungeons.ts's morthen
// record: elite, boss: true, the Crypt of the Fallen King's final boss), but
// its ClipMap is built by the shared skeletonClips() factory
// (src/render/characters/manifest.ts) off the SAME '2H_Melee_Attack_Chop'
// swing every other skeleton_mage.glb-rigged mob plays (skel_mage,
// delve_skel_varric). A dungeon final boss deserves a distinct silhouette.
//
// skeletonClips() wires Idle_Combat/Walking_A/Running_A/Walking_Backwards,
// hit Hit_A, death Death_A, cast Spellcasting, sitDown/sitIdle, swim Lie_Idle,
// jump Jump_Idle, stow 1H_Melee_Attack_Chop, the KAYKIT_EMOTES set (Spellcast_
// Raise, Cheer, Block, Running_Strafe_Left/Right, Spellcast_Shoot,
// 2H_Ranged_Shoot, Sit_Floor_Down, 1H_Melee_Attack_Slice_Diagonal,
// 2H_Melee_Attack_Chop), and skel_boss's own flourish override, Taunt. That
// leaves skeleton_mage.glb's Use_Item, Skeletons_Awaken_Standing, PickUp,
// Interact, Jump_Start, Jump_Land and Death_A_Pose genuinely unwired for this
// mob (indexClip/listAnimations against the shipped GLB). This clip is
// authored by pose-sample-and-blend (scripts/anim/pose_blend.mjs) off three of
// them, no Blender: Use_Item (an overhead item raise, read here as raising the
// staff), Skeletons_Awaken_Standing (a dramatic full-body rise with arms
// spread, this rig's OWN unused ground-emergence flourish), and PickUp (a
// forceful forward-down reach), bookended by Idle_Combat (skel_boss's real
// idle).
//
//   SkelBoss_Attack: raise the staff overhead, spread wide to channel a rising
//   dark pulse, then wrench forward and down into a grave-call slam, settle
//   back to combat idle. Reads as a caster-boss ritual strike, distinct from
//   the plain 2H chop every other skeleton_mage.glb-rigged mob still plays.
//
// Usage: node scripts/build_skelboss_anims.mjs [--preview]
// Output: public/models/chars/enemies/skelboss_ability_anims.glb (0 meshes/
// skins, 1 clip: SkelBoss_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/chars/enemies/skeleton_mage.glb');
const OUT = resolve(ROOT, 'public/models/chars/enemies/skelboss_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/skelboss_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle_Combat');
const useItemIdx = indexClip(root, 'Use_Item');
const awakenIdx = indexClip(root, 'Skeletons_Awaken_Standing');
const pickupIdx = indexClip(root, 'PickUp');
const interactIdx = indexClip(root, 'Interact');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...useItemIdx.keys(),
  ...awakenIdx.keys(),
  ...pickupIdx.keys(),
  ...interactIdx.keys(),
]);
const donorFor = (key) =>
  useItemIdx.get(key) ??
  pickupIdx.get(key) ??
  interactIdx.get(key) ??
  awakenIdx.get(key) ??
  idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle_Combat 4.267s,
// Use_Item 1.600s, Skeletons_Awaken_Standing 1.000s, PickUp 1.300s, Interact
// 1.300s).
const P_idle = samplePose(idleIdx, 0.3);
const P_raise = samplePose(useItemIdx, 0.35); // early overhead raise, staff lift
const P_awaken = samplePose(awakenIdx, 0.5); // peak of the rise, arms spread wide
const P_slam = samplePose(pickupIdx, 0.85); // forceful forward-down wrench
const P_settle = samplePose(interactIdx, 0.3); // brief forward lean before recovery

// skeleton_mage.glb's donor clips don't all animate the same channel set
// (Idle_Combat only touches 97 of the rig's 123 bones, Skeletons_Awaken_
// Standing 103, the rest 123), so a single donor pose is an incomplete
// poseValue fallback (pose_blend.mjs mergePoses doc): merge every donor pose
// once so a bone any of them animates always has SOME fallback value instead
// of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_raise, P_awaken, P_slam, P_settle);

const timeline = [[0, (k) => poseValue(P_idle, k, P_raise)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.3,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_raise,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.3,
  toTime: 0.55,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_raise,
  toPose: P_awaken,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.55,
  toTime: 0.8,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_awaken,
  toPose: P_slam,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.8,
  toTime: 1.0,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_slam,
  toPose: P_settle,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 1.0,
  toTime: 1.35,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_settle,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'SkelBoss_Attack',
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
