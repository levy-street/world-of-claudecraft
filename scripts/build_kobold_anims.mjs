// Build the kobold family's bespoke attack clip (issue #2889). mob_kobold
// shares the literal ENEMY7 ClipMap object, by reference, with mob_ogre in
// src/render/characters/manifest.ts, so a kobold "attacks" with the exact
// same single double-claw swing (Attack) as a giant twice its height. Authors
// one distinct clip by pose-sample-and-blend (scripts/anim/pose_blend.mjs)
// off donor poses already baked into the shipped goblin.glb itself: Attack
// (the shared double-claw swing) and Idle, plus Jump, a clip goblin.glb ships
// but nothing wires (ENEMY7's ClipMap has no `jump` field at all, so it is
// genuinely unused raw material, the same free-donor pattern
// build_elemental_anims.mjs used for golelingevolved.glb's No/Yes gestures).
//
// This rig is small (4 bones: Body, Head, Arm.L, Arm.R, rotation-driven, no
// meaningful translation range in any donor clip), so the new clip does not
// invent a silhouette the rig cannot supply. Instead it RE-TIMES the rig's
// own vocabulary into a two-beat combo instead of Attack's single continuous
// 0.5s cycle: a tucked crouch (Jump's own subtle brace pose, otherwise
// unused) held as an explicit windup, then Attack's own arm-swing peak and
// its own later body/head lean peak (which land at DIFFERENT times inside
// the stock 0.5s clip and are never simultaneous or held there) stretched
// into two separate, held beats: an explosive double-claw swipe, then a
// driven head-first lunge. Reads as a scrappy "gather then pounce", not a
// single swing.
//
//   Kobold_Pounce: crouch (Jump) -> double-claw swipe (Attack's arm peak) ->
//   forward lunge (Attack's later body/head lean peak, held) -> recover.
//
// Sampling note: goblin.glb's rotation channels are normalized Int16
// accessors (translation channels are plain Float32). pose_blend.mjs's
// sampleChannel only normalizes an INTERPOLATED sample; a time exactly at a
// clip's first or last keyframe returns the raw, un-normalized shorts. Every
// sample below lands strictly inside its donor's open time interval.
//
// Usage: node scripts/build_kobold_anims.mjs [--preview]
// Output: public/models/creatures/kobold_ability_anims.glb (0 meshes/skins,
// 1 clip: Kobold_Pounce)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/goblin.glb');
const OUT = resolve(ROOT, 'public/models/creatures/kobold_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/kobold_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const jumpIdx = indexClip(root, 'Jump');
const atkIdx = indexClip(root, 'Attack');

const allKeys = new Set([...idleIdx.keys(), ...jumpIdx.keys(), ...atkIdx.keys()]);
// Attack alone covers all 8 channels this rig animates anywhere (Body/Head
// translation+rotation, Arm.L/Arm.R translation+rotation); Idle carries only
// the 3 translation channels (no rotation channels at all), and Jump skips
// Body|rotation and both arm translations. Prefer Attack for the donor
// node/path lookup so every key resolves off the fullest-coverage clip.
const donorFor = (key) => atkIdx.get(key) ?? jumpIdx.get(key) ?? idleIdx.get(key);

// Donor poses (Idle 3.333s, translation-only; Jump 0.25s; Attack 0.5s).
const P_idle = samplePose(idleIdx, 1.5);
const P_crouch = samplePose(jumpIdx, 0.15); // Jump's own tucked brace pose
const P_swipe = samplePose(atkIdx, 0.22); // Attack's own arm-swing peak (both arms extended)
const P_lunge = samplePose(atkIdx, 0.4); // Attack's own later body/head lean peak

// Idle carries no rotation channels and Jump skips Body|rotation and both arm
// translations, so a bone either leaves silent resolves to null off a single
// donor and crashes slerpQ/lerpV mid-blend (pose_blend.mjs mergePoses doc):
// merge every donor pose used below so every channel has a real fallback.
const P_all = mergePoses(P_idle, P_crouch, P_swipe, P_lunge);

const timeline = [[0, (k) => poseValue(P_idle, k, P_all)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.16,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_crouch,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.16,
  toTime: 0.34,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_crouch,
  toPose: P_swipe,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.34,
  toTime: 0.48,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_swipe,
  toPose: P_lunge,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.48,
  toTime: 0.65,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_lunge,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Kobold_Pounce',
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
