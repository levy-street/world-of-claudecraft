// Build the Bloodmane Ravager's own attack clip (issue #2889 round 2). mob_wildheart_ravager
// shares the literal TRIPO_BIPED_FULL_RIG ClipMap object, by reference, with the other 4
// Wildheart Basin mobs in src/render/characters/manifest.ts, so this melee brute "attacks"
// with the exact same generic Attack swing as the ranged Stalker, the caster Hexcaller, the
// Beastmaster, and the Zulgar boss. This rig ships NO spare/unused donor clips (every one of
// Idle/Walk/Run/Attack/Hit/Cast/Jump/Death is already wired into TRIPO_BIPED_FULL_RIG), so
// the bespoke clip below is authored by pose-sample-and-blend (scripts/anim/pose_blend.mjs)
// off a re-timed, re-mixed re-sampling of THIS rig's own Attack and Hit donors, not a
// new/unused clip: a heavier, slower two-beat swing with a mid-swing hitch. No Blender: same
// technique, same module, as scripts/build_mage_ability_anims.mjs.
//
//   Wildheart_Ravager_Attack: big windup, first impact sampled mid-Attack, a brief hitch on
//   Hit's own impact-recoil pose, a second impact sampled late-Attack, settle to idle. Total
//   ~1.50s: slower and heavier than the base Attack clip's own 2.000s duration paced as a
//   single swing, so it reads as a two-hit rend instead of one chop.
//
// Usage: node scripts/build_wildheart_ravager_anims.mjs [--preview]
// Output: public/models/creatures/wildheart_ravager_ability_anims.glb (0 meshes/skins,
// 1 clip: Wildheart_Ravager_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/wildheart_ravager.glb');
const OUT = resolve(ROOT, 'public/models/creatures/wildheart_ravager_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/wildheart_ravager_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const attackIdx = indexClip(root, 'Attack');
const hitIdx = indexClip(root, 'Hit');

const allKeys = new Set([...idleIdx.keys(), ...attackIdx.keys(), ...hitIdx.keys()]);
const donorFor = (key) => hitIdx.get(key) ?? attackIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 15.375s, Attack 2.000s,
// Hit 0.700s).
const P_idle = samplePose(idleIdx, 0.3);
const P_windup = samplePose(attackIdx, 0.3); // big two-hand windup
const P_impact1 = samplePose(attackIdx, 0.9); // first impact point, mid-Attack
const P_recoil = samplePose(hitIdx, 0.35); // Hit donor's own impact-recoil pose
const P_impact2 = samplePose(attackIdx, 1.8); // second impact point, late-Attack

// Attack (40 channels) and Hit (22 channels, a strict subset of Attack's) don't animate
// the same channel set on this rig; merge once (pose_blend.mjs mergePoses doc) so every
// channel any donor touches has SOME fallback value instead of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_windup, P_impact1, P_recoil, P_impact2);

const timeline = [[0, (k) => poseValue(P_idle, k, P_windup)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.35,
  steps: 5,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_windup,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.35,
  toTime: 0.55,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_windup,
  toPose: P_impact1,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.55,
  toTime: 0.75,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_impact1,
  toPose: P_recoil,
  fallback: P_all,
});
timeline.push([0.85, (k) => poseValue(P_recoil, k, P_impact1)]); // the mid-swing hitch
pushPoseRamp(timeline, {
  fromTime: 0.85,
  toTime: 1.1,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_recoil,
  toPose: P_impact2,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 1.1,
  toTime: 1.5,
  steps: 6,
  ease: easeInOutQuad,
  fromPose: P_impact2,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Wildheart_Ravager_Attack',
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
