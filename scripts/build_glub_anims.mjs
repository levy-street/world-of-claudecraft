// Build the glub family's bespoke attack clip (issue #2889 round 2).
// mob_glub shares the literal FLOATING ClipMap object, by reference, with 8
// unrelated families in src/render/characters/manifest.ts (mob_dragonkin,
// mob_choir_thrall, mob_demon_flying, mob_nightkin, mob_ghost,
// mob_glimmerwisp, mob_duskwisp, mob_glub), so a mushroom-folk glub
// "attacks" with the same Headbutt/Punch as a ghost or a flying demon imp.
// Authors one distinct clip by pose-sample-and-blend (scripts/anim/
// pose_blend.mjs) off donor poses already baked into the shipped
// glubevolved.glb itself: Flying_Idle (the hover bookend), Punch (this rig
// has no arms, so "Punch" is a torso/head lunge), and the two currently
// UNUSED gesture clips this GLB ships, No (a side-to-side head shake) and
// Yes (a downward nod). Same technique, same module, as
// scripts/build_elemental_anims.mjs (golelingevolved.glb, this rig's own
// sibling in the same evolved-creature family, ships the identical
// Flying_Idle/Punch/No/Yes vocabulary at the identical durations). No
// Blender: see .claude/skills/blender-anim-pipeline/SKILL.md.
//
//   Glub_Attack: wind up off Punch's lean-back, quiver side-to-side (No,
//   reads as the mushroom cap trembling), lunge forward into the full Punch
//   pose (the spore burst reaching out), snap-nod down on release (Yes, the
//   puff moment), settle back to the hover idle.
//
// Usage: node scripts/build_glub_anims.mjs [--preview]
// Output: public/models/creatures/glub_ability_anims.glb (0 meshes/skins,
// 1 clip: Glub_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/glubevolved.glb');
const OUT = resolve(ROOT, 'public/models/creatures/glub_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/glub_anims_preview.glb');
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

// Donor poses, sampled within each clip's real duration (Flying_Idle
// 1.167s, Punch 1.167s, No 1.167s, Yes 1.167s).
const P_idle = samplePose(idleIdx, 0.3);
const P_windup = samplePose(punchIdx, 0.15); // early lean-back before the quiver
const P_wobble = samplePose(noIdx, 0.45); // side-to-side cap quiver, peak sway
const P_burst = samplePose(punchIdx, 0.85); // full forward lunge, the spore burst reaching out
const P_puff = samplePose(yesIdx, 0.4); // downward nod snap as the puff releases

// This rig's gesture clips (No/Yes) don't animate every bone the flight
// loop and Punch touch (and vice versa), so a single donor pose is an
// incomplete fallback: merge every donor pose once so every channel any of
// them animates has SOME fallback instead of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_windup, P_wobble, P_burst, P_puff);

const timeline = [[0, (k) => poseValue(P_idle, k, P_windup)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.2,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_windup,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.2,
  toTime: 0.42,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_windup,
  toPose: P_wobble,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.42,
  toTime: 0.68,
  steps: 5,
  ease: easeOutCubic,
  fromPose: P_wobble,
  toPose: P_burst,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.68,
  toTime: 0.82,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_burst,
  toPose: P_puff,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.82,
  toTime: 1.15,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_puff,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Glub_Attack',
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
