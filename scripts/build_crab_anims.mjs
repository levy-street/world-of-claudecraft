// Build mob_crab's bespoke attack clip (issue #2889 round 2). mob_crab
// (crabenemy.glb) currently shares the shared ENEMY_BITE ClipMap's plain
// forward-lunging Bite_Front, the same attack mob_treant's separate
// yeti.glb rig plays. crabenemy.glb ships 10 real clips (verified);
// Bite_Front, HitRecieve, Idle, Walk, Death are already wired, and
// Bite_InPlace, Dance, No, Yes, Jump are unused bonus donors specific to
// this rig. This authors a claw-snap flourish by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs) off two of them: Dance (an in-place
// side-to-side wiggle) for a pincer-click flourish, then Bite_InPlace (an
// in-place snap, distinct from the forward-lunging Bite_Front already used
// elsewhere) for the bite landing. No Blender: same technique, same module,
// as scripts/build_bow_anims.mjs.
//
//   Crab_Attack: idle, a side-to-side claw-flourish wiggle (Dance), commit
//   into the snap, the in-place bite lands (Bite_InPlace), follow-through,
//   settle. Reads as a pincer-click flourish before the bite lands, distinct
//   from the plain forward-lunging Bite_Front every other ENEMY_BITE family
//   (mob_treant) still plays.
//
// Usage: node scripts/build_crab_anims.mjs [--preview]
// Output: public/models/creatures/crab_ability_anims.glb (0 meshes/skins,
// 1 clip: Crab_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/crabenemy.glb');
const OUT = resolve(ROOT, 'public/models/creatures/crab_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/crab_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const danceIdx = indexClip(root, 'Dance');
const biteInPlaceIdx = indexClip(root, 'Bite_InPlace');

const allKeys = new Set([...idleIdx.keys(), ...danceIdx.keys(), ...biteInPlaceIdx.keys()]);
const donorFor = (key) => biteInPlaceIdx.get(key) ?? danceIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 2.500s, Dance
// 0.833s, Bite_InPlace 0.667s).
const P_idle = samplePose(idleIdx, 0.3);
const P_danceL = samplePose(danceIdx, 0.15); // wiggle left
const P_danceR = samplePose(danceIdx, 0.55); // wiggle right
const P_snapWind = samplePose(biteInPlaceIdx, 0.15); // claws open/pull back
const P_snapImpact = samplePose(biteInPlaceIdx, 0.42); // snap shut
const P_snapFollow = samplePose(biteInPlaceIdx, 0.6); // follow-through

// Donor clips from the same rig don't all animate the same channel set
// (pose_blend.mjs mergePoses doc): merge every donor pose once so any
// channel any of them animates always has SOME fallback value instead of
// null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_danceL, P_danceR, P_snapWind, P_snapImpact, P_snapFollow);

const timeline = [[0, (k) => poseValue(P_idle, k, P_danceL)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.15,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_danceL,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.15,
  toTime: 0.35,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_danceL,
  toPose: P_danceR,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.35,
  toTime: 0.5,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_danceR,
  toPose: P_danceL,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.5,
  toTime: 0.62,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_danceL,
  toPose: P_snapWind,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.62,
  toTime: 0.8,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_snapWind,
  toPose: P_snapImpact,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.8,
  toTime: 0.95,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_snapImpact,
  toPose: P_snapFollow,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.95,
  toTime: 1.25,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_snapFollow,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Crab_Attack',
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
