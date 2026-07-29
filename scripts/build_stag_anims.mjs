// Build mob_stag's bespoke attack clip (issue #2889). mob_stag is the base
// member of the Quaternius stag rig family (src/render/characters/manifest.ts):
// veiled_stag, gleamstag, veiled_doe and aurelhorn are the same rig re-skinned
// into separate GLB files, and all six (mob_stag included) call the shared
// animal() FACTORY with the identical ['Attack_Headbutt', 'Attack_Kick']
// array, by convention rather than by object reference (animal() returns a
// fresh ClipMap object per call site, unlike FLOATING's literal sharing), so
// changing mob_stag alone cannot affect its re-skinned siblings.
//
// animal() wires idle Idle, walk Walk, run Gallop, attack Attack_Headbutt/
// Attack_Kick, hit Idle_HitReact_Left/Idle_HitReact_Right, death Death.
// indexClip/listAnimations against the shipped stag.glb shows 13 clips total,
// 5 of them genuinely unwired for this mob: Eating, Gallop_Jump, Jump_toIdle,
// Idle_Headlow and Idle_2, the richest unused set of every animal() rig this
// GLB family ships. This clip is authored by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs) off three of them, no Blender: Idle_Headlow
// (head dropped low, antlers forward, this rig's own unused "about to charge"
// pose), Gallop_Jump (a leaping bound, read here as the charge lunge), and
// the already-wired Attack_Headbutt reused for its full-extension impact
// energy (the same "borrow the committed swing" move build_mage_ability_anims.mjs
// uses for Cast_Nova), bookended by Jump_toIdle for the landing recovery.
//
//   Stag_Attack_Charge: head drops low and antlers level (readying to gore),
//   a leaping bound closes the gap, full-extension headbutt on impact, land
//   and settle back to idle. Reads as a charging gore distinct from the
//   standing Attack_Headbutt/Attack_Kick pair mob_stag still keeps in its
//   attack rotation.
//
// Usage: node scripts/build_stag_anims.mjs [--preview]
// Output: public/models/creatures/stag_ability_anims.glb (0 meshes/skins,
// 1 clip: Stag_Attack_Charge)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/stag.glb');
const OUT = resolve(ROOT, 'public/models/creatures/stag_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/stag_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const headlowIdx = indexClip(root, 'Idle_Headlow');
const leapIdx = indexClip(root, 'Gallop_Jump');
const headbuttIdx = indexClip(root, 'Attack_Headbutt');
const landIdx = indexClip(root, 'Jump_toIdle');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...headlowIdx.keys(),
  ...leapIdx.keys(),
  ...headbuttIdx.keys(),
  ...landIdx.keys(),
]);
const donorFor = (key) =>
  leapIdx.get(key) ??
  landIdx.get(key) ??
  headbuttIdx.get(key) ??
  headlowIdx.get(key) ??
  idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 3.333s,
// Idle_Headlow 3.333s, Gallop_Jump 1.375s, Attack_Headbutt 0.792s,
// Jump_toIdle 1.500s).
const P_idle = samplePose(idleIdx, 0.3);
const P_ready = samplePose(headlowIdx, 1.6); // head dropped low, antlers level
const P_leap = samplePose(leapIdx, 0.55); // mid-air bound closing the gap
const P_gore = samplePose(headbuttIdx, 0.5); // full headbutt extension
const P_land = samplePose(landIdx, 0.35); // early landing settle

// The stag rig's own donor clips don't all animate the same channel set
// (Eating/Idle-family clips touch as few as 19-23 of the rig's bones,
// Gallop_Jump/Jump_toIdle touch 35), so a single donor pose is an incomplete
// poseValue fallback (pose_blend.mjs mergePoses doc): merge every donor pose
// once so a bone any of them animates always has SOME fallback value instead
// of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_ready, P_leap, P_gore, P_land);

const timeline = [[0, (k) => poseValue(P_idle, k, P_ready)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.22,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_ready,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.22,
  toTime: 0.42,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_ready,
  toPose: P_leap,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.42,
  toTime: 0.58,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_leap,
  toPose: P_gore,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.58,
  toTime: 0.85,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_gore,
  toPose: P_land,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.85,
  toTime: 1.15,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_land,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Stag_Attack_Charge',
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
