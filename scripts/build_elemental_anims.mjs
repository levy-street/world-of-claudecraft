// Build the elemental family's bespoke attack clip (issue #2889). mob_elemental
// shares the literal FLOATING ClipMap object, by reference, with 8 unrelated
// families in src/render/characters/manifest.ts, so a fire elemental
// "attacks" with the same Headbutt/Punch as a ghost, a dragon, and a flying
// demon imp. Authors one distinct clip by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs) off donor poses already baked into the
// shipped golelingevolved.glb itself: Flying_Idle (the hover bookend), Punch
// (a forward lunge, this rig has no arms, so "Punch" is a torso/head lunge),
// and the two currently-UNUSED gesture clips this GLB ships but nothing
// wires, No (a head shake) and Yes (a head nod). No Blender: same technique,
// same module, as scripts/build_mage_ability_anims.mjs.
//
//   Elemental_Attack: wind up with a side-to-side charge wobble (No), lurch
//   forward fast (Punch's impact lean), snap-nod on impact (Yes), settle
//   back to the hover idle. Reads as a "molten lurch", distinct from the
//   Headbutt/Punch every other FLOATING-sharing mob still plays.
//
// Usage: node scripts/build_elemental_anims.mjs [--preview]
// Output: public/models/creatures/elemental_ability_anims.glb (0 meshes/
// skins, 1 clip: Elemental_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/golelingevolved.glb');
const OUT = resolve(ROOT, 'public/models/creatures/elemental_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/elemental_anims_preview.glb');
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
const P_windup = samplePose(punchIdx, 0.2); // early lean-back before the lunge
const P_shake = samplePose(noIdx, 0.4); // side-to-side charge wobble
const P_impact = samplePose(punchIdx, 0.75); // full forward lunge
const P_nod = samplePose(yesIdx, 0.4); // downward snap on impact

// Donor clips from the same rig don't all animate the same channel set (this
// rig's gesture clips skip bones the flight loop touches, and vice versa), so
// a single donor pose is an incomplete fallback (pose_blend.mjs mergePoses
// doc): merge every donor pose once so every channel any of them animates has
// SOME fallback value instead of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_windup, P_shake, P_impact, P_nod);

const timeline = [[0, (k) => poseValue(P_idle, k, P_windup)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.25,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_windup,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.25,
  toTime: 0.4,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_windup,
  toPose: P_shake,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.4,
  toTime: 0.65,
  steps: 5,
  ease: easeOutCubic,
  fromPose: P_shake,
  toPose: P_impact,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.65,
  toTime: 0.78,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_impact,
  toPose: P_nod,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.78,
  toTime: 1.1,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_nod,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Elemental_Attack',
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
