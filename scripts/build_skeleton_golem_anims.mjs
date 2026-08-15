// Build the skeleton golem's bespoke attack clip (issue #2889 follow-up
// batch). skel_golem (src/render/characters/manifest.ts) is the KayKit
// skeleton family's own large-rig outlier (skeletonLargeClips, height 3.4 vs
// the regular skeletons' 2.5) and the rig behind FOUR named boss/rare
// VisualDef assignments: nythraxis_scourge_of_thornpeak (a dungeon final
// boss, src/sim/content/dungeons.ts), ancient_guardian, waking_warden, and
// idol_guardian (src/render/characters/manifest.ts's MOB_KEYS). Despite that,
// it still plays the exact same generic ['2H_Melee_Attack_Chop',
// '1H_Melee_Attack_Chop'] pair every plain humanoid mob and player class
// swings, so a dungeon final boss reads identically to a rank-and-file
// skeleton. The other 11 skeleton VisualDefs (delve_skel_*, skel_minion,
// skel_warrior, skel_rogue, skel_mage, skel_boss, skel_necromancer,
// rift_ritualist) all share the SMALLER 41-joint skeleton rig behind the
// factory skeletonClips(), a different GLB per character with its own bone
// hierarchy; this batch only touches the golem's own file.
//
// Authors one distinct clip by pose-sample-and-blend (scripts/anim/
// pose_blend.mjs) off donor poses already baked into the shipped
// skeleton_golem.glb itself: Idle, 2H_Melee_Attack_Chop (2.833s: a long,
// heavy two-hand downswing), and the currently-UNUSED
// Dualwield_Melee_Attack_Chop (1.033s, spare raw material, the same role
// Elemental's unused No/Yes gestures played in build_elemental_anims.mjs).
// No Blender: same technique, same module, as build_mage_ability_anims.mjs
// and build_elemental_anims.mjs.
//
//   Golem_Slam: a torqued coil off the spare Dualwield donor, a slow
//   overhead raise into the two-hand chop's own windup, a held anticipation
//   beat (boss-tier weight), the chop's own impact pose with a ground-
//   shudder hold, then a slow recovery. Reads as a heavier, more deliberate
//   two-hand slam than the plain 2H_Melee_Attack_Chop every other rig still
//   plays, distinct from any humanoid swing.
//
// Usage: node scripts/build_skeleton_golem_anims.mjs [--preview]
// Output: public/models/chars/enemies/skeleton_golem_anims.glb (0 meshes/
// skins, 1 clip: Golem_Slam)
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
const SOURCE = resolve(ROOT, 'public/models/chars/enemies/skeleton_golem.glb');
const OUT = resolve(ROOT, 'public/models/chars/enemies/skeleton_golem_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/skeleton_golem_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const chop2Idx = indexClip(root, '2H_Melee_Attack_Chop');
const dualIdx = indexClip(root, 'Dualwield_Melee_Attack_Chop');

const allKeys = new Set([...idleIdx.keys(), ...chop2Idx.keys(), ...dualIdx.keys()]);
const donorFor = (key) => chop2Idx.get(key) ?? dualIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 1.967s,
// 2H_Melee_Attack_Chop 2.833s, Dualwield_Melee_Attack_Chop 1.033s).
const P_idle = samplePose(idleIdx, 0.3);
const P_coil = samplePose(dualIdx, 0.2); // torqued draw-back (spare donor)
const P_wind = samplePose(chop2Idx, 0.5); // big two-hand overhead windup
const P_impact = samplePose(chop2Idx, 1.8); // two-hand downswing impact

// The spare Dualwield donor doesn't animate every bone the 2H chop touches
// (and vice versa), so a single donor pose is an incomplete fallback
// (pose_blend.mjs mergePoses doc): merge every donor pose once so every
// channel any of them animates has SOME fallback value instead of null-ing
// out mid-blend.
const P_all = mergePoses(P_idle, P_coil, P_wind, P_impact);

const timeline = [[0, (k) => poseValue(P_idle, k, P_coil)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.35,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_coil,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.35,
  toTime: 0.7,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_coil,
  toPose: P_wind,
  fallback: P_all,
});
timeline.push([0.85, (k) => poseValue(P_wind, k, P_all)]); // anticipation hold, boss-tier weight
pushPoseRamp(timeline, {
  fromTime: 0.85,
  toTime: 1.15,
  steps: 5,
  ease: easeOutCubic,
  fromPose: P_wind,
  toPose: P_impact,
  fallback: P_all,
});
timeline.push([1.35, (k) => poseValue(P_impact, k, P_all)]); // ground-shudder hold
pushPoseRamp(timeline, {
  fromTime: 1.35,
  toTime: 1.75,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_impact,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Golem_Slam',
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
