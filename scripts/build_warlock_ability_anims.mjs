// Build the warlock's ability-specific spellcast clips (issue #2889: the
// class has zero attackByAbility overrides today, so every one of its 12
// non-pet abilities plays the same Spellcast_Shoot wand zap,
// player_warlock in src/render/characters/manifest.ts). This authors 4
// distinct casts by pose-sample-and-blend (see scripts/anim/pose_blend.mjs,
// the technique behind the hunter's bow_anims.glb and the mage's own
// mage_ability_anims.glb) off donor poses already baked into the shipped
// mage.glb: player_warlock is rigged on the SAME physical file as
// player_mage and player_priest, but these are a SEPARATE, warlock-themed
// set of clips, not a reuse of the mage's Cast_Fire/Cast_Frost/etc: a
// clawed diagonal point (1H_Melee_Attack_Slice_Diagonal) instead of a
// staff raise, a fast dual-hand ignite flick (Dualwield_Melee_Attack_Chop)
// instead of a clean release, a slow sustained pull (Block held) instead of
// a barrage, and a snap-recoil burst (Hit_A) instead of a flourish.
//
// Donor clips used (mage.glb's own durations): Idle 1.067s, Spellcast_Raise
// 2.100s, Spellcast_Shoot 0.933s, 1H_Melee_Attack_Slice_Diagonal 1.000s,
// Dualwield_Melee_Attack_Chop 1.267s, Block 1.067s, Spellcasting 0.667s,
// Hit_A 0.667s.
//
//   Warlock_Cast_Shadow  gather (Spellcast_Raise), coil into a clawed
//                        diagonal draw, a decisive point/thrust
//                        (1H_Melee_Attack_Slice_Diagonal), settle. The
//                        curse-magic bread and butter: shadow bolt, the two
//                        DoT curses.
//   Warlock_Cast_Fire    fast dual-hand snap-in (Dualwield_Melee_Attack_Chop),
//                        a striking flick that ignites, flung outward
//                        (Spellcast_Shoot's release). Scrappier and quicker
//                        than a mage's clean Cast_Fire: immolate, searing
//                        pain (both "quick to cast" per their flavor text),
//                        and the rain-of-fire ground conjure.
//   Warlock_Cast_Drain   a slow, sustained pull: reach (Block, repurposed
//                        for its forward-lean silhouette), settle into the
//                        channel hold (Spellcasting), deepen the pull, ease
//                        back. One long draw, not a barrage: drain life's
//                        5-tick channel.
//   Warlock_Cast_Burst   a fast, decisive single gesture: snap to a point
//                        (Spellcast_Shoot's early frame, no windup), a
//                        sharp recoil (Hit_A, repurposed as a jerking
//                        strike), settle. Every instant-cast (castTime 0)
//                        ability in the kit reads as one quick committed
//                        motion regardless of mechanic, the same call the
//                        mage batch made folding three different AoE
//                        mechanics into one Cast_Nova: shadowburn (instant
//                        nuke), fear (a sudden point), life tap and demon
//                        skin (self-cast), spell lock (an interrupt snap).
//
// Excluded: summon_imp/voidwalker/succubus/felhunter/felguard/infernal/
// doomguard, the pet-summon channels, have no combat swing to author
// (the same call the hunter batch made excluding tame_beast/dismiss_pet/
// revive_pet).
//
// Usage: node scripts/build_warlock_ability_anims.mjs [--preview]
// Output: public/models/chars/players/warlock_ability_anims.glb (0
// meshes/skins, 4 clips: Warlock_Cast_Shadow, Warlock_Cast_Fire,
// Warlock_Cast_Drain, Warlock_Cast_Burst)
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
const SOURCE = resolve(ROOT, 'public/models/chars/players/mage.glb');
const OUT = resolve(ROOT, 'public/models/chars/players/warlock_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/warlock_ability_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const raiseIdx = indexClip(root, 'Spellcast_Raise');
const sliceIdx = indexClip(root, '1H_Melee_Attack_Slice_Diagonal');
const dualIdx = indexClip(root, 'Dualwield_Melee_Attack_Chop');
const shootIdx = indexClip(root, 'Spellcast_Shoot');
const blockIdx = indexClip(root, 'Block');
const castIdx = indexClip(root, 'Spellcasting');
const hitIdx = indexClip(root, 'Hit_A');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...raiseIdx.keys(),
  ...sliceIdx.keys(),
  ...dualIdx.keys(),
  ...shootIdx.keys(),
  ...blockIdx.keys(),
  ...castIdx.keys(),
  ...hitIdx.keys(),
]);
const donorFor = (key) =>
  sliceIdx.get(key) ??
  dualIdx.get(key) ??
  shootIdx.get(key) ??
  blockIdx.get(key) ??
  hitIdx.get(key) ??
  castIdx.get(key) ??
  raiseIdx.get(key) ??
  idleIdx.get(key);

// Donor poses, sampled once at chosen timestamps within each clip's real
// duration.
const P_idle = samplePose(idleIdx, 0.3);
const P_raiseEarly = samplePose(raiseIdx, 0.25); // starting to lift the free hand
const P_sliceWind = samplePose(sliceIdx, 0.2); // clawed hand draws back into a cross-body coil
const P_sliceRelease = samplePose(sliceIdx, 0.75); // the decisive diagonal point/thrust
const P_dualWind = samplePose(dualIdx, 0.15); // both hands snap in fast
const P_dualStrike = samplePose(dualIdx, 0.55); // the quick striking flick that ignites
const P_shootEarly = samplePose(shootIdx, 0.15); // barely a windup, before commitment
const P_shootRelease = samplePose(shootIdx, 0.7); // full release / follow-through
const P_reachStart = samplePose(blockIdx, 0.15); // forward lean, the grasping reach
const P_drainDeep = samplePose(blockIdx, 0.55); // the pull deepens, sustained
const P_castLoop = samplePose(castIdx, 0.3); // mid-loop channel hold
const P_hitRecoil = samplePose(hitIdx, 0.35); // a sharp jerking snap, repurposed as a strike

// mage.glb's Idle carries all 69 bones, so a single-pose fallback happens to
// be complete on this particular rig, but every consumer of pose_blend.mjs
// merges anyway (pose_blend.mjs mergePoses doc): a donor swapped in later for
// a partial-channel clip (Spellcasting is 53 of the 69) must not silently
// null out a blend, and this keeps the pattern uniform across every batch.
const P_all = mergePoses(
  P_idle,
  P_raiseEarly,
  P_sliceWind,
  P_sliceRelease,
  P_dualWind,
  P_dualStrike,
  P_shootEarly,
  P_shootRelease,
  P_reachStart,
  P_drainDeep,
  P_castLoop,
  P_hitRecoil,
);

const animations = [];

function bake(clipName, timeline) {
  const { animation } = bakeClip(doc, { clipName, channelKeys: allKeys, timeline, donorFor });
  animations.push(animation);
}

// --- Warlock_Cast_Shadow: gather, coil, a decisive clawed point ----------
{
  const t = [[0, (k) => poseValue(P_idle, k, P_all)]];
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
    toTime: 0.6,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_sliceWind,
    toPose: P_sliceRelease,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.6,
    toTime: 0.9,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_sliceRelease,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Warlock_Cast_Shadow', t);
}

// --- Warlock_Cast_Fire: fast dual-hand snap, a striking ignite flick -----
{
  const t = [[0, (k) => poseValue(P_idle, k, P_all)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.12,
    steps: 2,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_dualWind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.12,
    toTime: 0.28,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_dualWind,
    toPose: P_dualStrike,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.28,
    toTime: 0.5,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_dualStrike,
    toPose: P_shootRelease,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.5,
    toTime: 0.75,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_shootRelease,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Warlock_Cast_Fire', t);
}

// --- Warlock_Cast_Drain: one slow sustained pull, not a barrage ----------
{
  const t = [[0, (k) => poseValue(P_idle, k, P_all)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.3,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_idle,
    toPose: P_reachStart,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.3,
    toTime: 0.55,
    steps: 3,
    ease: easeInOutQuad,
    fromPose: P_reachStart,
    toPose: P_castLoop,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.55,
    toTime: 0.9,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_castLoop,
    toPose: P_drainDeep,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.9,
    toTime: 1.15,
    steps: 3,
    ease: easeInOutQuad,
    fromPose: P_drainDeep,
    toPose: P_castLoop,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 1.15,
    toTime: 1.5,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_castLoop,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Warlock_Cast_Drain', t);
}

// --- Warlock_Cast_Burst: one fast decisive gesture, no windup ------------
{
  const t = [[0, (k) => poseValue(P_idle, k, P_all)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.08,
    steps: 2,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_shootEarly,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.08,
    toTime: 0.22,
    steps: 2,
    ease: easeOutCubic,
    fromPose: P_shootEarly,
    toPose: P_hitRecoil,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.22,
    toTime: 0.4,
    steps: 2,
    ease: easeOutCubic,
    fromPose: P_hitRecoil,
    toPose: P_shootRelease,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.4,
    toTime: 0.6,
    steps: 3,
    ease: easeInOutQuad,
    fromPose: P_shootRelease,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Warlock_Cast_Burst', t);
}

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + all 4 clips): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, animations);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
