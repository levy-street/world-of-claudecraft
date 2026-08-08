// Build the Sunbone Hexcaller's own attack/cast clip (issue #2889 round 2).
// mob_wildheart_hexcaller shares the literal TRIPO_BIPED_FULL_RIG ClipMap object, by
// reference, with the other 4 Wildheart Basin mobs in src/render/characters/manifest.ts,
// so this caster/support hexer "attacks" with the exact same generic melee Attack swing
// as the ranged Stalker, the melee Ravager, the Beastmaster, and the Zulgar boss. This rig
// ships NO spare/unused donor clips (every one of Idle/Walk/Run/Attack/Hit/Cast/Jump/Death
// is already wired into TRIPO_BIPED_FULL_RIG), so the bespoke clip below is authored by
// pose-sample-and-blend (scripts/anim/pose_blend.mjs) off a re-timed, re-mixed re-sampling
// of THIS rig's own Cast and Attack donors, not a new/unused clip: a cast-dominated gesture
// with only a brief physical flourish at the very end. No Blender: same technique, same
// module, as scripts/build_mage_ability_anims.mjs.
//
//   Wildheart_Hexcaller_Attack: raise into an early Cast-donor pose, hold a longer
//   Cast-donor forward pose (the bulk of the clip), a brief Attack-donor flourish right at
//   the tail, settle to idle. Total ~1.90s, dominated by the two Cast samples so it reads
//   as a hex-casting gesture rather than a physical swing. Wired into both `attack` (the
//   one-shot swing rotation) and `cast` (the looping cast channel) so the Hexcaller's
//   ordinary auto-attack already looks like spellwork.
//
// Usage: node scripts/build_wildheart_hexcaller_anims.mjs [--preview]
// Output: public/models/creatures/wildheart_hexcaller_ability_anims.glb (0 meshes/skins,
// 1 clip: Wildheart_Hexcaller_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/wildheart_hexcaller.glb');
const OUT = resolve(ROOT, 'public/models/creatures/wildheart_hexcaller_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/wildheart_hexcaller_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const castIdx = indexClip(root, 'Cast');
const attackIdx = indexClip(root, 'Attack');

const allKeys = new Set([...idleIdx.keys(), ...castIdx.keys(), ...attackIdx.keys()]);
const donorFor = (key) => castIdx.get(key) ?? attackIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 15.375s, Cast 5.375s,
// Attack 2.000s).
const P_idle = samplePose(idleIdx, 0.3);
const P_raiseArms = samplePose(castIdx, 0.4); // early raised-arms moment
const P_heldForward = samplePose(castIdx, 2.6); // held-forward moment, well inside Cast's 5.375s
const P_flourish = samplePose(attackIdx, 1.85); // brief Attack-donor flourish, near its tail

// Cast (22 channels) is a strict subset of Attack's (40 channels) on this rig, and neither
// is a strict subset of Idle's (39 channels); merge once (pose_blend.mjs mergePoses doc) so
// every channel any donor touches has SOME fallback value instead of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_raiseArms, P_heldForward, P_flourish);

const timeline = [[0, (k) => poseValue(P_idle, k, P_raiseArms)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.4,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_idle,
  toPose: P_raiseArms,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.4,
  toTime: 1.2,
  steps: 6,
  ease: easeOutCubic,
  fromPose: P_raiseArms,
  toPose: P_heldForward,
  fallback: P_all,
});
timeline.push([1.5, (k) => poseValue(P_heldForward, k, P_idle)]); // sustained held-forward beat
pushPoseRamp(timeline, {
  fromTime: 1.5,
  toTime: 1.65,
  steps: 2,
  ease: easeOutCubic,
  fromPose: P_heldForward,
  toPose: P_flourish,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 1.65,
  toTime: 1.9,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_flourish,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Wildheart_Hexcaller_Attack',
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
