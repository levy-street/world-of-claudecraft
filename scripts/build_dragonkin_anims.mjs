// Build the dragonkin family's bespoke attack clip (issue #2889). mob_dragonkin
// shares the literal FLOATING ClipMap object, by reference, with 8 unrelated
// families in src/render/characters/manifest.ts (the same constant batch 1
// migrated mob_elemental off of), so the floating dragonevolved wyrm
// "attacks" with the same Headbutt/Punch as a ghost, a wisp, and a flying
// demon imp. Out of scope: the newer Drakelands brood system
// (DRAGONKIN_BROODLORD/BROODGUARD/WHELP, dragonkin_elite/mob/baby.glb),
// which already ships its own artist-authored clips.
//
// Authors one distinct clip by pose-sample-and-blend (scripts/anim/
// pose_blend.mjs) off donor poses already baked into the shipped
// dragonevolved.glb itself: Flying_Idle (the hover bookend), Headbutt (a big
// two-handed clawed ram: this rig, unlike golelingevolved's armless body,
// ships a full finger rig on both hands, so Headbutt is a head-and-claw
// lunge, not a bare head bump), and the same pair of currently-UNUSED gesture
// clips the elemental script found on golelingevolved.glb, No (a head/neck
// shake) and Yes (a head/neck nod): both rigs come from the same "goleling/
// dragon" floating donor family (FLOATING's own comment), so it is no
// surprise dragonevolved ships the identical spare gesture pair. No Blender:
// same technique, same module, as scripts/build_elemental_anims.mjs.
//
//   Dragonkin_Attack: coil back with a lateral head/neck shake (No), snap
//   into a committed forward ram baring both clawed hands (Headbutt's
//   windup into its held impact extension), punctuate with a downward
//   neck-snap bite (Yes), settle back to the hover idle. Reads as a rearing
//   serpentine strike, distinct from the Headbutt/Punch every other
//   FLOATING-sharing mob still plays (dragonevolved's OWN Headbutt donor
//   supplies the ram energy, but this clip samples it at chosen timestamps
//   and blends it with the coil/snap gestures, so it never replays as the
//   raw donor clip itself).
//
// Usage: node scripts/build_dragonkin_anims.mjs [--preview]
// Output: public/models/creatures/dragonkin_ability_anims.glb (0 meshes/
// skins, 1 clip: Dragonkin_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/dragonevolved.glb');
const OUT = resolve(ROOT, 'public/models/creatures/dragonkin_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/dragonkin_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Flying_Idle');
const headbuttIdx = indexClip(root, 'Headbutt');
const noIdx = indexClip(root, 'No');
const yesIdx = indexClip(root, 'Yes');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...headbuttIdx.keys(),
  ...noIdx.keys(),
  ...yesIdx.keys(),
]);
const donorFor = (key) =>
  headbuttIdx.get(key) ?? yesIdx.get(key) ?? noIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Flying_Idle 1.500s,
// Headbutt 1.500s, No 1.167s, Yes 1.167s). Headbutt and the gesture clips
// both settle back to their rest pose in their final keyframe (a "return to
// idle" tail), so every sample below stays well inside each clip's acted
// middle stretch, never near that tail.
const P_idle = samplePose(idleIdx, 0.3);
const P_coil = samplePose(noIdx, 0.35); // lateral head/neck shake, coiling to strike
const P_windup = samplePose(headbuttIdx, 0.2); // early lean into the ram
const P_impact = samplePose(headbuttIdx, 0.9); // full committed claw-and-head lunge
const P_snap = samplePose(yesIdx, 0.35); // downward neck-snap bite, punctuating impact

// Donor clips from the same rig don't all animate the same channel set (No
// and Yes animate the Neck bone; Headbutt and Flying_Idle don't, but Headbutt
// alone carries the finger joints on both hands): a single donor pose is an
// incomplete poseValue fallback (pose_blend.mjs mergePoses doc, and the exact
// bug this technique's elemental precedent hit). Merge every donor pose
// sampled above so every channel any of them animates always resolves to
// something instead of null mid-blend.
const P_all = mergePoses(P_idle, P_coil, P_windup, P_impact, P_snap);

const timeline = [[0, (k) => poseValue(P_idle, k, P_coil)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.25,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_coil,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.25,
  toTime: 0.4,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_coil,
  toPose: P_windup,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.4,
  toTime: 0.65,
  steps: 5,
  ease: easeOutCubic,
  fromPose: P_windup,
  toPose: P_impact,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.65,
  toTime: 0.78,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_impact,
  toPose: P_snap,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.78,
  toTime: 1.1,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_snap,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Dragonkin_Attack',
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
