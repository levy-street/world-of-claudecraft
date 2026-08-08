// Build the flying demon family's bespoke attack clip (issue #2889).
// mob_demon_flying shares the literal FLOATING ClipMap object, by reference,
// with 8 other unrelated families in src/render/characters/manifest.ts, so a
// flying demon "attacks" with the same Headbutt/Punch as a fire elemental, a
// ghost, and a dragon. One earlier batch already migrated a FLOATING member
// off the shared set (elemental); this migrates mob_demon_flying, following
// the exact playbook
// scripts/build_elemental_anims.mjs used. Authors one distinct clip by
// pose-sample-and-blend (scripts/anim/pose_blend.mjs) off donor poses already
// baked into the shipped demon.glb itself: Flying_Idle (the hover bookend),
// Punch (a forward lunge, this rig has no arms, so "Punch" is a torso/head
// lunge), and the two currently-UNUSED gesture clips this GLB ships but
// nothing wires, No (a head shake) and Yes (a head nod). No Blender: same
// technique, same module, as scripts/build_elemental_anims.mjs.
//
//   DemonFlying_Attack: rear back with a snarling shake (No), plunge forward
//   into a hard dive-bomb lunge (Punch's impact lean), snap-nod as the strike
//   lands (Yes), then settle back to the hover idle. Reads as a swooping
//   dive, distinct from both the Headbutt/Punch every other FLOATING-sharing
//   mob still plays AND the elemental family's own "molten lurch"
//   (Elemental_Attack), even though both bespoke clips share the same
//   underlying rig's donor pose vocabulary.
//
// Usage: node scripts/build_demon_flying_anims.mjs [--preview]
// Output: public/models/creatures/demon_flying_anims.glb (0 meshes/skins, 1
// clip: DemonFlying_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/demon.glb');
const OUT = resolve(ROOT, 'public/models/creatures/demon_flying_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/demon_flying_anims_preview.glb');
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
const P_rear = samplePose(noIdx, 0.4); // snarling rear-back shake before the dive
const P_windup = samplePose(punchIdx, 0.2); // lean-back before the lunge
const P_dive = samplePose(punchIdx, 0.75); // full forward lunge, the dive-bomb strike
const P_nod = samplePose(yesIdx, 0.4); // snap-nod as the strike lands

// Flying_Idle only animates 13 of this rig's 24 total channels (Punch alone
// animates 31), so a single donor pose is an incomplete fallback
// (pose_blend.mjs mergePoses doc): merge every donor pose once so every
// channel any of them animates has SOME fallback value instead of null-ing
// out mid-blend, the same trap scripts/build_elemental_anims.mjs avoids on
// this same rig family.
const P_all = mergePoses(P_idle, P_rear, P_windup, P_dive, P_nod);

const timeline = [[0, (k) => poseValue(P_idle, k, P_all)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.22,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_rear,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.22,
  toTime: 0.38,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_rear,
  toPose: P_windup,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.38,
  toTime: 0.65,
  steps: 5,
  ease: easeOutCubic,
  fromPose: P_windup,
  toPose: P_dive,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.65,
  toTime: 0.8,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_dive,
  toPose: P_nod,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.8,
  toTime: 1.12,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_nod,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'DemonFlying_Attack',
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
