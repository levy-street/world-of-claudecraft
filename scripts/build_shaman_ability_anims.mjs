// Build the shaman's ability-specific spellcast clips (issue #2889: the class
// has zero attackByAbility overrides today, so every one of its 14 abilities
// plays the same one-hand chop/slice, player_shaman in
// src/render/characters/manifest.ts). This authors 5 distinct clips by
// pose-sample-and-blend (see scripts/anim/pose_blend.mjs, the technique
// behind the hunter's bow_anims.glb and scripts/build_mage_ability_anims.mjs)
// off donor poses already baked into the shipped barbarian.glb, no Blender:
// Idle, Spellcast_Raise (2.1s: an early half-raise then a long sustained
// ready hold near the tail), Spellcasting (0.667s loop), Spellcast_Shoot
// (0.933s: an early windup then the full release), 2H_Melee_Attack_Chop's
// committed downswing energy (1.633s), and 1H_Melee_Attack_Slice_Diagonal's
// windup and impact (1.0s) for the weapon-channeled strike.
//
//   Cast_Bolt    the class's signature nature bolt (lightning_bolt, its
//                longest cast at 1.5 to 3.0s): rise to a full charge, hold,
//                then release
//   Cast_Shock   earth/flame/frost shock all cast instantly (0s) and differ
//                only in damage school (VFX carries that, not the motion),
//                so they share one snappy point-and-release
//   Cast_Heal    healing_wave and chain_heal settle into a sustained channel
//                pose instead of a sharp outward release, reading as mending
//   Cast_Quake   earthquake borrows 2H_Melee_Attack_Chop's committed
//                downswing energy, the same "slam and radiate outward" call
//                the mage's Cast_Nova makes for its own ground-target nova
//   Storm_Strike stormstrike channels the storm through the weapon: a quick
//                raise then a charged diagonal slice, not a plain auto swing
//
// Usage: node scripts/build_shaman_ability_anims.mjs [--preview]
// Output: public/models/chars/players/shaman_ability_anims.glb (0 meshes/
// skins, 5 clips: Cast_Bolt, Cast_Shock, Cast_Heal, Cast_Quake, Storm_Strike)
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
const SOURCE = resolve(ROOT, 'public/models/chars/players/barbarian.glb');
const OUT = resolve(ROOT, 'public/models/chars/players/shaman_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/shaman_ability_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const raiseIdx = indexClip(root, 'Spellcast_Raise');
const castIdx = indexClip(root, 'Spellcasting');
const shootIdx = indexClip(root, 'Spellcast_Shoot');
const chopIdx = indexClip(root, '2H_Melee_Attack_Chop');
const sliceIdx = indexClip(root, '1H_Melee_Attack_Slice_Diagonal');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...raiseIdx.keys(),
  ...castIdx.keys(),
  ...shootIdx.keys(),
  ...chopIdx.keys(),
  ...sliceIdx.keys(),
]);
const donorFor = (key) =>
  raiseIdx.get(key) ??
  shootIdx.get(key) ??
  castIdx.get(key) ??
  chopIdx.get(key) ??
  sliceIdx.get(key) ??
  idleIdx.get(key);

// Donor poses, sampled once at chosen timestamps within each clip's real
// duration (Idle 1.067s, Spellcast_Raise 2.100s, Spellcasting 0.667s,
// Spellcast_Shoot 0.933s, 2H_Melee_Attack_Chop 1.633s,
// 1H_Melee_Attack_Slice_Diagonal 1.000s).
const P_idle = samplePose(idleIdx, 0.3);
const P_raiseEarly = samplePose(raiseIdx, 0.3); // starting to lift the arms
const P_raiseHold = samplePose(raiseIdx, 1.8); // sustained ready pose near the tail
const P_castLoop = samplePose(castIdx, 0.3); // mid-loop channel pose
const P_shootEarly = samplePose(shootIdx, 0.2); // windup, before commitment
const P_shootRelease = samplePose(shootIdx, 0.7); // full release / follow-through
const P_chopWind = samplePose(chopIdx, 0.3); // big two-hand windup
const P_chopImpact = samplePose(chopIdx, 1.0); // downswing impact
const P_sliceWind = samplePose(sliceIdx, 0.2); // diagonal slice windup
const P_sliceImpact = samplePose(sliceIdx, 0.55); // diagonal slice impact

// Idle alone happens to cover every key any of these donors animate (verified:
// barbarian.glb's Idle clip touches all 69 skeleton channels, a superset of
// every other donor here), so a single-pose fallback would already be safe.
// mergePoses is still used for the pushPoseRamp fallback (pose_blend.mjs doc):
// donor clips from the same rig do not always animate the SAME channel set
// (2H_Melee_Attack_Chop and Spellcasting both animate fewer bones than Idle),
// so merging every donor pose keeps this correct even if a future edit swaps
// in a donor that Idle does not fully cover.
const P_all = mergePoses(
  P_idle,
  P_raiseEarly,
  P_raiseHold,
  P_castLoop,
  P_shootEarly,
  P_shootRelease,
  P_chopWind,
  P_chopImpact,
  P_sliceWind,
  P_sliceImpact,
);

const animations = [];

function bake(clipName, timeline) {
  const { animation } = bakeClip(doc, { clipName, channelKeys: allKeys, timeline, donorFor });
  animations.push(animation);
}

// --- Cast_Bolt: rise to a full charge, hold, then release -----------------
{
  const t = [[0, (k) => poseValue(P_idle, k, P_raiseEarly)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.3,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_raiseEarly,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.3,
    toTime: 0.6,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_raiseEarly,
    toPose: P_raiseHold,
    fallback: P_all,
  });
  t.push([0.9, (k) => poseValue(P_raiseHold, k, P_all)]); // charge held before release
  pushPoseRamp(t, {
    fromTime: 0.9,
    toTime: 1.1,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_raiseHold,
    toPose: P_shootRelease,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 1.1,
    toTime: 1.45,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_shootRelease,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Bolt', t);
}

// --- Cast_Shock: snappy point-and-release (all three shocks are instant) --
{
  const t = [[0, (k) => poseValue(P_idle, k, P_raiseEarly)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.15,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_raiseEarly,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.15,
    toTime: 0.35,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_raiseEarly,
    toPose: P_shootRelease,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.35,
    toTime: 0.6,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_shootRelease,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Shock', t);
}

// --- Cast_Heal: a sustained mending channel, no sharp outward release -----
{
  const t = [[0, (k) => poseValue(P_idle, k, P_raiseHold)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.4,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_idle,
    toPose: P_raiseHold,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.4,
    toTime: 0.7,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_raiseHold,
    toPose: P_castLoop,
    fallback: P_all,
  });
  t.push([1.3, (k) => poseValue(P_castLoop, k, P_all)]); // sustained mending glow
  pushPoseRamp(t, {
    fromTime: 1.3,
    toTime: 1.7,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_castLoop,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Heal', t);
}

// --- Cast_Quake: borrows the two-hand chop's committed downswing energy ---
// Same "slam and radiate outward" read as the mage's Cast_Nova for its own
// ground-target nova.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_chopWind)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.3,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_raiseHold,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.3,
    toTime: 0.55,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_raiseHold,
    toPose: P_chopWind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.55,
    toTime: 0.85,
    steps: 5,
    ease: easeOutCubic,
    fromPose: P_chopWind,
    toPose: P_chopImpact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.85,
    toTime: 1.2,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_chopImpact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Quake', t);
}

// --- Storm_Strike: a quick raise, then a charged diagonal slice -----------
{
  const t = [[0, (k) => poseValue(P_idle, k, P_raiseEarly)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.15,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_raiseEarly,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.15,
    toTime: 0.35,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_raiseEarly,
    toPose: P_sliceWind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.35,
    toTime: 0.55,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_sliceWind,
    toPose: P_sliceImpact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.55,
    toTime: 0.85,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_sliceImpact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Storm_Strike', t);
}

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + all 5 clips): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, animations);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
