// Build the mob_troll family's bespoke attack clip (issue #2889). mob_troll
// shares the literal BIPED14 ClipMap object, by reference, with 5 unrelated
// families in src/render/characters/manifest.ts (mob_bear, mob_yeti, mob_
// murloc, mob_demon, mob_demonalt), so a wandering troll "attacks" with the
// exact same alternating Punch/Weapon as a yeti, a frog-murloc, and a demon.
// Authors one distinct clip by pose-sample-and-blend (scripts/anim/
// pose_blend.mjs) off donor poses already baked into the shipped orc.glb
// itself: Idle (the bookend), Duck (a crouch this rig ships but BIPED14 never
// wires), Weapon (the existing overhand club swing), Punch (the existing
// bare-fist attack), and Yes (a head nod this rig ships but BIPED14 never
// wires). No Blender: same technique, same module, as
// scripts/build_elemental_anims.mjs.
//
//   Troll_Smash: sink into a crouch coil (Duck), rise into the weapon
//   windup, drive the overhand club swing home (Weapon's own impact frame),
//   lean into the punch's forward follow-through for brute weight, snap a
//   satisfied head-nod on impact (Yes), settle back to idle. Reads as a
//   heavier, more telegraphed "crushing blow" than the quick alternating
//   Punch/Weapon every other BIPED14-sharing family still plays.
//
// Usage: node scripts/build_troll_anims.mjs [--preview]
// Output: public/models/creatures/troll_ability_anims.glb (0 meshes/skins,
// 1 clip: Troll_Smash)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/orc.glb');
const OUT = resolve(ROOT, 'public/models/creatures/troll_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/troll_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const duckIdx = indexClip(root, 'Duck');
const weaponIdx = indexClip(root, 'Weapon');
const punchIdx = indexClip(root, 'Punch');
const yesIdx = indexClip(root, 'Yes');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...duckIdx.keys(),
  ...weaponIdx.keys(),
  ...punchIdx.keys(),
  ...yesIdx.keys(),
]);
const donorFor = (key) =>
  weaponIdx.get(key) ??
  punchIdx.get(key) ??
  duckIdx.get(key) ??
  yesIdx.get(key) ??
  idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 1.000s, Duck
// 1.667s, Weapon 0.833s, Punch 0.833s, Yes 1.667s).
const P_idle = samplePose(idleIdx, 0.3);
const P_duckLoad = samplePose(duckIdx, 0.4); // crouched coil, loading a big blow
const P_weaponWind = samplePose(weaponIdx, 0.2); // early overhand club windup
const P_weaponImpact = samplePose(weaponIdx, 0.55); // full club swing impact
const P_punchFollow = samplePose(punchIdx, 0.6); // punch's own forward lean, brute follow-through
const P_nod = samplePose(yesIdx, 0.4); // satisfied head-nod snap on impact

// orc.glb's donor clips don't all animate the same channel set (pose_blend.mjs
// mergePoses doc): merge every donor pose once so every channel any of them
// animates has SOME fallback value instead of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_duckLoad, P_weaponWind, P_weaponImpact, P_punchFollow, P_nod);

const timeline = [[0, (k) => poseValue(P_idle, k, P_duckLoad)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.2,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_duckLoad,
  fallback: P_all,
});
timeline.push([0.32, (k) => poseValue(P_duckLoad, k, P_idle)]); // coiled anticipation hold
pushPoseRamp(timeline, {
  fromTime: 0.32,
  toTime: 0.55,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_duckLoad,
  toPose: P_weaponWind,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.55,
  toTime: 0.8,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_weaponWind,
  toPose: P_weaponImpact,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.8,
  toTime: 0.95,
  steps: 2,
  ease: easeOutCubic,
  fromPose: P_weaponImpact,
  toPose: P_punchFollow,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.95,
  toTime: 1.08,
  steps: 2,
  ease: easeOutCubic,
  fromPose: P_punchFollow,
  toPose: P_nod,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 1.08,
  toTime: 1.4,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_nod,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Troll_Smash',
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
