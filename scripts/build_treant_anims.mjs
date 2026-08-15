// Build mob_treant's bespoke attack clip (issue #2889 round 2). mob_treant
// (yeti.glb: the SIMPLE, low-detail rig, NOT yetialt.glb used by
// mob_bear/mob_yeti) currently shares the shared ENEMY_BITE ClipMap's plain
// forward-lunging Bite_Front, the same attack mob_crab's separate
// crabenemy.glb rig plays. Per the design spec, "biting" reads wrong for a
// tree (this VisualDef tints the model as bark-mossy, per its manifest
// comment), so this reinterprets the shared attack entirely: a
// slam/root-grab authored by pose-sample-and-blend (scripts/anim/
// pose_blend.mjs) off three of yeti.glb's own 9 shipped clips: Idle (held
// longer, for the "rooted" stillness), Bite_Front (repurposed as a downward
// branch-slam lean instead of a bite), and Dance (its sway, repurposed as
// the treant swaying back upright). No Blender: same technique, same
// module, as scripts/build_stag_anims.mjs.
//
// This is a low-node-count rig (2-3 animated nodes per clip throughout,
// only 9 clips total, no Run or Bite_InPlace), so the resulting motion is
// necessarily simple and blocky, a milder version of the mob_ogre caveat
// with better donor material available (Dance gives real sway to blend).
//
//   Treant_Attack: rooted stillness held longer (Idle), commit into a
//   downward lean (Bite_Front, repurposed as a branch-slam), impact,
//   sway back upright (Dance), settle. Reads as a slam/root-grab, distinct
//   from the plain forward-lunging Bite_Front every other ENEMY_BITE family
//   (mob_crab) still plays.
//
// Usage: node scripts/build_treant_anims.mjs [--preview]
// Output: public/models/creatures/treant_ability_anims.glb (0 meshes/skins,
// 1 clip: Treant_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/yeti.glb');
const OUT = resolve(ROOT, 'public/models/creatures/treant_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/treant_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const biteFrontIdx = indexClip(root, 'Bite_Front');
const danceIdx = indexClip(root, 'Dance');

const allKeys = new Set([...idleIdx.keys(), ...biteFrontIdx.keys(), ...danceIdx.keys()]);
const donorFor = (key) => biteFrontIdx.get(key) ?? danceIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 2.000s,
// Bite_Front 0.375s, Dance 0.667s).
const P_idleRest = samplePose(idleIdx, 0.3);
const P_idleHold = samplePose(idleIdx, 1.5); // rooted stillness, later in the idle cycle
const P_slamWind = samplePose(biteFrontIdx, 0.1); // early downward lean
const P_slamImpact = samplePose(biteFrontIdx, 0.28); // committed downward lean: the "slam"
const P_swayBack = samplePose(danceIdx, 0.3); // swaying back upright
const P_swaySettle = samplePose(danceIdx, 0.55); // sway settling

// yeti.glb's donor clips don't all animate the same 2-3-node channel set
// exactly (pose_blend.mjs mergePoses doc): merge every donor pose once so
// any channel any of them animates always has SOME fallback instead of
// null-ing out mid-blend.
const P_all = mergePoses(
  P_idleRest,
  P_idleHold,
  P_slamWind,
  P_slamImpact,
  P_swayBack,
  P_swaySettle,
);

// Fall back to P_all (not P_idleHold): P_idleRest and P_idleHold are both
// sampled from the Idle clip alone, which animates only 2 of the 4 candidate
// channels (Head|translation, Head3|rotation). Head|rotation (Bite_Front's
// downward lean, the actual slam) and Head2|rotation (Dance's sway) are
// absent from both, so poseValue would return null for this first keyframe
// and bakeClip silently drops those channels from the baked clip entirely.
const timeline = [[0, (k) => poseValue(P_idleRest, k, P_all)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.6,
  steps: 6,
  ease: easeInOutQuad,
  fromPose: P_idleRest,
  toPose: P_idleHold,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.6,
  toTime: 0.8,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idleHold,
  toPose: P_slamWind,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.8,
  toTime: 0.95,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_slamWind,
  toPose: P_slamImpact,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.95,
  toTime: 1.15,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_slamImpact,
  toPose: P_swayBack,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 1.15,
  toTime: 1.35,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_swayBack,
  toPose: P_swaySettle,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 1.35,
  toTime: 1.6,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_swaySettle,
  toPose: P_idleRest,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Treant_Attack',
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
