// Build the murloc family's bespoke attack clip (issue #2889 round 2).
// mob_murloc shares the literal BIPED14 ClipMap object, by reference, with
// 5 unrelated families in src/render/characters/manifest.ts (mob_bear,
// mob_yeti, mob_troll, mob_demon, mob_demonalt), so the frog.glb murloc
// "attacks" with the same generic Punch/Weapon as an orc troll or a demon
// pet. Authors one distinct clip by pose-sample-and-blend (scripts/anim/
// pose_blend.mjs) off donor poses already baked into the shipped frog.glb
// itself: Idle (the bookend), Punch (the base biped attack donor), and
// Wave, a currently UNUSED clip this GLB ships (an arm-flail wave). No
// Blender: see .claude/skills/blender-anim-pipeline/SKILL.md.
//
//   Murloc_Attack: wind up off Punch's early pull-back, flop the arm out
//   (Wave's mid-flail), slap forward into the full Punch impact, flop again
//   as it settles (Wave's later, gentler frames), return to idle. Playful
//   and amphibian-flavored, fitting a frog-rig murloc.
//
// Usage: node scripts/build_murloc_anims.mjs [--preview]
// Output: public/models/creatures/murloc_ability_anims.glb (0 meshes/skins,
// 1 clip: Murloc_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/frog.glb');
const OUT = resolve(ROOT, 'public/models/creatures/murloc_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/murloc_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const punchIdx = indexClip(root, 'Punch');
const waveIdx = indexClip(root, 'Wave');

const allKeys = new Set([...idleIdx.keys(), ...punchIdx.keys(), ...waveIdx.keys()]);
const donorFor = (key) => punchIdx.get(key) ?? waveIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 1.000s,
// Punch 0.833s, Wave 1.667s).
const P_idle = samplePose(idleIdx, 0.3);
const P_windup = samplePose(punchIdx, 0.12); // early pull-back before the slap
const P_flop = samplePose(waveIdx, 0.5); // arm flail out, mid-wave
const P_slap = samplePose(punchIdx, 0.62); // full forward slap impact
const P_flop2 = samplePose(waveIdx, 1.25); // second, gentler flop settling down

// Locomotion (Idle) and the gesture donors (Punch, Wave) don't all animate
// the same channel set on this rig: merge every donor pose once so every
// channel any of them animates has SOME fallback instead of null-ing out.
const P_all = mergePoses(P_idle, P_windup, P_flop, P_slap, P_flop2);

const timeline = [[0, (k) => poseValue(P_idle, k, P_windup)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.15,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_windup,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.15,
  toTime: 0.34,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_windup,
  toPose: P_flop,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.34,
  toTime: 0.55,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_flop,
  toPose: P_slap,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.55,
  toTime: 0.74,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_slap,
  toPose: P_flop2,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.74,
  toTime: 1.02,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_flop2,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Murloc_Attack',
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
