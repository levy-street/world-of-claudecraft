// Build the ghost family's bespoke attack clip (issue #2889). mob_ghost
// shares the literal FLOATING ClipMap object, by reference, with 7 other
// unrelated families in src/render/characters/manifest.ts (dragonkin, the
// flying demon imp, the Nightbloom nightkin, the mushroom-folk glub, and
// more), so a Veiled Hollow spirit "attacks" with the same Headbutt/Punch as
// a fire elemental or a dragon. ghost.glb ships the EXACT same donor clip set
// build_elemental_anims.mjs already found in golelingevolved.glb (Flying_Idle,
// Fast_Flying, Headbutt, Punch, HitReact, Death, and the two currently-UNUSED
// gesture clips No/Yes: both rigs are the same shared "goleling"-style
// floating skeleton, just different meshes/textures), so this authors one
// distinct clip by the same pose-sample-and-blend technique
// (scripts/anim/pose_blend.mjs), no Blender, off Flying_Idle (the hover
// bookend), Punch (a forward lunge; this rig has no arms, so "Punch" reads as
// a torso/head lunge same as the elemental's donor), and the two unwired
// gesture clips No (a head shake) and Yes (a head nod).
//
//   Ghost_Attack: a shudder (No) builds into a fast coiled windup (Punch's
//   lean-back), then the torso LUNGES PAST its normal reach (Punch's impact
//   pose blended with overshoot along the windup->impact direction, the same
//   overshoot technique build_bow_anims.mjs uses for its string-hand release)
//   as if phasing through the target, a beat at full extension, then a fast
//   snap back (Yes's downward nod reused as a retreating recoil, not a
//   forward strike-nod) before settling to the hover idle. Reads as a
//   "phase-strike lunge", distinct in both shape and reasoning from
//   Elemental_Attack's grounded "molten lurch" (that clip never overshoots
//   past its impact pose or snaps back; it settles forward through the nod).
//
// Usage: node scripts/build_ghost_anims.mjs [--preview]
// Output: public/models/creatures/ghost_ability_anims.glb (0 meshes/skins,
// 1 clip: Ghost_Attack)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  blendValue,
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
const SOURCE = resolve(ROOT, 'public/models/creatures/ghost.glb');
const OUT = resolve(ROOT, 'public/models/creatures/ghost_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/ghost_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const OVERSHOOT = 0.35; // how far the lunge reaches PAST the donor impact pose

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
// Punch 1.167s, No 1.167s, Yes 1.167s: identical timing to the elemental's own
// same-rig donors).
const P_idle = samplePose(idleIdx, 0.3);
const P_shudder = samplePose(noIdx, 0.4); // a spectral shiver, gathering to strike
const P_windup = samplePose(punchIdx, 0.2); // coiled lean-back before the lunge
const P_impact = samplePose(punchIdx, 0.75); // the forward lunge pose
const P_recoil = samplePose(yesIdx, 0.4); // reused as a snap-back recoil, not a nod-in

// Same channel-coverage gap the elemental script hit: ghost.glb's gesture
// clips (No/Yes) skip bones the flight loop and Punch touch, and vice versa,
// so a single donor pose is an incomplete fallback (pose_blend.mjs mergePoses
// doc). Merge every donor pose once so every channel any of them animates has
// SOME fallback value instead of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_shudder, P_windup, P_impact, P_recoil);

// The phase-lunge: every channel overshoots PAST the impact pose along the
// windup->impact direction (blendValue at t > 1), the same overshoot
// technique build_bow_anims.mjs's RELEASE_CHAIN uses for the string-hand
// snap, applied here to the whole body so the lunge reads as passing THROUGH
// the target instead of just reaching it.
const P_overshoot = new Map();
for (const key of allKeys) {
  const windup = poseValue(P_windup, key, P_all);
  const impact = poseValue(P_impact, key, P_all);
  P_overshoot.set(key, blendValue(key, windup, impact, 1 + OVERSHOOT));
}

const timeline = [[0, (k) => poseValue(P_idle, k, P_shudder)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.18,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_shudder,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.18,
  toTime: 0.3,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_shudder,
  toPose: P_windup,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.3,
  toTime: 0.45,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_windup,
  toPose: P_overshoot,
  fallback: P_all,
});
timeline.push([0.55, (k) => poseValue(P_overshoot, k, P_all)]); // full extension beat
pushPoseRamp(timeline, {
  fromTime: 0.55,
  toTime: 0.68,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_overshoot,
  toPose: P_recoil,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.68,
  toTime: 1.0,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_recoil,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Ghost_Attack',
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
