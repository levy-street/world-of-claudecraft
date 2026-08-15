// Build the Vineclaw Stalker's own attack clip (issue #2889 round 2). mob_wildheart_stalker
// shares the literal TRIPO_BIPED_FULL_RIG ClipMap object, by reference, with the other 4
// Wildheart Basin mobs in src/render/characters/manifest.ts, so a ranged spear-thrower
// "attacks" with the exact same generic Attack swing as the melee Ravager, the caster
// Hexcaller, the Beastmaster, and the Zulgar boss. This rig ships NO spare/unused donor
// clips (every one of Idle/Walk/Run/Attack/Hit/Cast/Jump/Death is already wired into
// TRIPO_BIPED_FULL_RIG), so the bespoke clip below is authored by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs) off a re-timed, re-mixed re-sampling of THIS rig's own
// Attack donor alone, not a new/unused clip: a compressed windup-into-stretched-lunge-hold
// that reads as a quick spear throw instead of the base melee chop. No Blender: same
// technique, same module, as scripts/build_mage_ability_anims.mjs.
//
//   Wildheart_Stalker_Attack: fast windup off Attack's own early frames, snap into a
//   stretched forward-leaning hold sampled from late in Attack, brief settle back to idle.
//   Total ~0.50s: much faster pacing than the base Attack clip's own 2.000s duration, so
//   it reads as a quick ranged throw rather than a melee chop.
//
// Usage: node scripts/build_wildheart_stalker_anims.mjs [--preview]
// Output: public/models/creatures/wildheart_stalker_ability_anims.glb (0 meshes/skins,
// 1 clip: Wildheart_Stalker_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/wildheart_stalker.glb');
const OUT = resolve(ROOT, 'public/models/creatures/wildheart_stalker_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/wildheart_stalker_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const attackIdx = indexClip(root, 'Attack');

const allKeys = new Set([...idleIdx.keys(), ...attackIdx.keys()]);
const donorFor = (key) => attackIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 15.375s, Attack 2.000s).
const P_idle = samplePose(idleIdx, 0.3);
const P_windup = samplePose(attackIdx, 0.15); // early windup, before commitment
const P_lungeHold = samplePose(attackIdx, 1.7); // late, stretched forward-leaning hold

// Attack (40 channels) is a near-strict superset of Idle (39 channels) on this rig, but
// merge anyway (pose_blend.mjs mergePoses doc) so every channel either donor animates has
// SOME fallback value instead of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_windup, P_lungeHold);

const timeline = [[0, (k) => poseValue(P_idle, k, P_windup)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.12,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_windup,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.12,
  toTime: 0.22,
  steps: 2,
  ease: easeOutCubic,
  fromPose: P_windup,
  toPose: P_lungeHold,
  fallback: P_all,
});
timeline.push([0.34, (k) => poseValue(P_lungeHold, k, P_idle)]); // held stretched lunge
pushPoseRamp(timeline, {
  fromTime: 0.34,
  toTime: 0.5,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_lungeHold,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Wildheart_Stalker_Attack',
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
