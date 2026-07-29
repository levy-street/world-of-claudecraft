// Build the paladin's ability-specific clips (issue #2889 follow-up batch: the
// class has zero attackByAbility overrides today, so every one of its 16
// abilities plays the same 1H_Melee_Attack_Chop / Slice_Diagonal swing,
// player_paladin in src/render/characters/manifest.ts). Unlike the mage
// (batch 1), the paladin's kit is almost entirely school: 'holy'
// (src/sim/content/classes.ts), so school cannot differentiate anything: the
// real dimension here is the ability's EFFECT TYPE (judgement/groundAoE/stun/
// absorb+selfBuff/buffTarget+selfBuff/heal), the same fallback batch 1 used
// for the mage's Nova clip ("AoE burst shape") when school alone did not fit.
// Authors 6 distinct clips by pose-sample-and-blend (see scripts/anim/
// pose_blend.mjs) off donor poses already baked into the shipped paladin.glb,
// no Blender: Idle, Spellcast_Raise (2.100s raise-and-hold), Spellcasting
// (0.667s loop), Spellcast_Shoot (0.933s point/release), Block (1.067s: the
// shield-raise pose, otherwise only reachable through the question/flex/
// salute emotes), 1H_Melee_Attack_Chop (1.067s), 2H_Melee_Attack_Chop
// (1.633s, otherwise only reachable through attackByHand's twohand style),
// and Dualwield_Melee_Attack_Chop (1.267s, completely unused anywhere in
// player_paladin's ClipMap: the one fully spare donor, same role Elemental's
// unused No/Yes gestures played in build_elemental_anims.mjs).
//
//   Cast_Verdict     (judgement: Judgement/Verdict) quick raise then a single
//                     decisive one-hand smite, snappy return: an instant-cast
//                     finisher that unleashes the active seal.
//   Cast_Consecrate  (groundAoE: Consecration/Holy Ground) both arms raised
//                     overhead, a held anticipation beat, then a big two-hand
//                     slam with a ground-shudder hold: the same "slam and
//                     radiate outward" read Cast_Nova used for the mage, cast
//                     on the paladin's own ground instead of a burst target.
//   Cast_HammerBash  (stun: Hammer of Justice/Sundering Gavel) shield raised
//                     and braced, then a fast torqued strike off the spare
//                     Dualwield donor: shield-led, distinct from Verdict's
//                     bare weapon smite and Consecrate's two-hand ground slam.
//   Cast_Ward        (absorb + defensive selfBuff: Divine Protection/Ward of
//                     Faith, Sacred Bulwark) shield raised and held, no
//                     strike at all: both are pure self-facing defensive
//                     cooldowns (offGcd, 180 sec cooldown, deal no damage).
//   Cast_Blessing    (buffTarget + aura selfBuff: Blessing of Might, Devotion
//                     Aura, Retribution Aura, Righteous Fury) an unhurried
//                     raise, a light hold, then an outward point/radiate
//                     instead of a release: these are zero-cast-time party or
//                     self buffs, not attacks.
//   Cast_HolyMend    (heal: Holy Light, Flash of Light, Lay on Hands) hands
//                     gathered and raised, a channel hold, then a gentle pour
//                     toward the target instead of a release: benevolent, not
//                     offensive, the same "gentle point" idea Polymorph used
//                     for the mage.
//
// Usage: node scripts/build_paladin_ability_anims.mjs [--preview]
// Output: public/models/chars/players/paladin_ability_anims.glb (0 meshes/
// skins, 6 clips: Cast_Verdict, Cast_Consecrate, Cast_HammerBash, Cast_Ward,
// Cast_Blessing, Cast_HolyMend)
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
const SOURCE = resolve(ROOT, 'public/models/chars/players/paladin.glb');
const OUT = resolve(ROOT, 'public/models/chars/players/paladin_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/paladin_ability_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const raiseIdx = indexClip(root, 'Spellcast_Raise');
const castIdx = indexClip(root, 'Spellcasting');
const shootIdx = indexClip(root, 'Spellcast_Shoot');
const blockIdx = indexClip(root, 'Block');
const chop1Idx = indexClip(root, '1H_Melee_Attack_Chop');
const chop2Idx = indexClip(root, '2H_Melee_Attack_Chop');
const dualIdx = indexClip(root, 'Dualwield_Melee_Attack_Chop');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...raiseIdx.keys(),
  ...castIdx.keys(),
  ...shootIdx.keys(),
  ...blockIdx.keys(),
  ...chop1Idx.keys(),
  ...chop2Idx.keys(),
  ...dualIdx.keys(),
]);
const donorFor = (key) =>
  raiseIdx.get(key) ??
  castIdx.get(key) ??
  shootIdx.get(key) ??
  blockIdx.get(key) ??
  chop1Idx.get(key) ??
  chop2Idx.get(key) ??
  dualIdx.get(key) ??
  idleIdx.get(key);

// Donor poses, sampled once at chosen timestamps within each clip's real
// duration (Idle 1.067s, Spellcast_Raise 2.100s, Spellcasting 0.667s,
// Spellcast_Shoot 0.933s, Block 1.067s, 1H_Melee_Attack_Chop 1.067s,
// 2H_Melee_Attack_Chop 1.633s, Dualwield_Melee_Attack_Chop 1.267s).
const P_idle = samplePose(idleIdx, 0.3);
const P_raiseEarly = samplePose(raiseIdx, 0.3); // starting to lift, gathering the seal
const P_raiseHold = samplePose(raiseIdx, 1.8); // sustained overhead ready pose
const P_castLoop = samplePose(castIdx, 0.3); // mid-loop channel pose
const P_shootEarly = samplePose(shootIdx, 0.2); // windup, before commitment
const P_shootRelease = samplePose(shootIdx, 0.7); // full release / follow-through (unused here, kept for parity with the raise/release shape)
const P_blockRaise = samplePose(blockIdx, 0.3); // shield lifting into guard
const P_blockHold = samplePose(blockIdx, 0.8); // shield fully raised and braced
const P_chop1Wind = samplePose(chop1Idx, 0.2); // one-hand draw-back
const P_chop1Impact = samplePose(chop1Idx, 0.65); // one-hand downward smite
const P_chop2Wind = samplePose(chop2Idx, 0.3); // big two-hand windup
const P_chop2Impact = samplePose(chop2Idx, 1.0); // two-hand downswing impact
const P_dualWind = samplePose(dualIdx, 0.2); // torqued draw-back (spare donor)
const P_dualImpact = samplePose(dualIdx, 0.75); // fast committed strike (spare donor)

// Donor clips don't all animate the same channel set (Block and the spare
// Dualwield swing skip bones the spellcast donors touch, and vice versa), so
// a single donor pose is an incomplete fallback (pose_blend.mjs mergePoses
// doc): merge every donor pose once so every channel any of them animates has
// SOME fallback value instead of null-ing out mid-blend.
const P_all = mergePoses(
  P_idle,
  P_raiseEarly,
  P_raiseHold,
  P_castLoop,
  P_shootEarly,
  P_shootRelease,
  P_blockRaise,
  P_blockHold,
  P_chop1Wind,
  P_chop1Impact,
  P_chop2Wind,
  P_chop2Impact,
  P_dualWind,
  P_dualImpact,
);

const animations = [];

function bake(clipName, timeline) {
  const { animation } = bakeClip(doc, { clipName, channelKeys: allKeys, timeline, donorFor });
  animations.push(animation);
}

// --- Cast_Verdict: quick raise, one decisive one-hand smite, snappy return -
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
    toTime: 0.4,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_raiseEarly,
    toPose: P_chop1Wind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.4,
    toTime: 0.6,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_chop1Wind,
    toPose: P_chop1Impact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.6,
    toTime: 0.9,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_chop1Impact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Verdict', t);
}

// --- Cast_Consecrate: overhead raise, held beat, big two-hand ground slam --
// Borrows the two-hand chop's impact energy, the same way the mage's
// Cast_Nova borrowed 2H_Melee_Attack_Chop: an AoE reads as an outward slam,
// not a delicate spell release.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_raiseHold)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.35,
    steps: 5,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_raiseHold,
    fallback: P_all,
  });
  t.push([0.55, (k) => poseValue(P_raiseHold, k, P_all)]); // anticipation hold, consecrating
  pushPoseRamp(t, {
    fromTime: 0.55,
    toTime: 0.85,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_raiseHold,
    toPose: P_chop2Wind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.85,
    toTime: 1.15,
    steps: 5,
    ease: easeOutCubic,
    fromPose: P_chop2Wind,
    toPose: P_chop2Impact,
    fallback: P_all,
  });
  t.push([1.3, (k) => poseValue(P_chop2Impact, k, P_all)]); // ground-shudder hold
  pushPoseRamp(t, {
    fromTime: 1.3,
    toTime: 1.65,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_chop2Impact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Consecrate', t);
}

// --- Cast_HammerBash: shield raised and braced, then a fast torqued strike -
// Off the spare Dualwield_Melee_Attack_Chop donor (unused anywhere else in
// player_paladin's ClipMap): shield-led, distinct from Verdict's bare smite
// and Consecrate's two-hand ground slam.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_blockRaise)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.2,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_blockRaise,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.2,
    toTime: 0.35,
    steps: 2,
    ease: easeOutCubic,
    fromPose: P_blockRaise,
    toPose: P_blockHold,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.35,
    toTime: 0.55,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_blockHold,
    toPose: P_dualWind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.55,
    toTime: 0.75,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_dualWind,
    toPose: P_dualImpact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.75,
    toTime: 1.05,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_dualImpact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_HammerBash', t);
}

// --- Cast_Ward: shield raised and held, no strike at all ------------------
// Divine Protection and Sacred Bulwark are pure self-facing defensive
// cooldowns (offGcd, 180 sec cooldown, deal no damage): the shield goes up
// and stays up, it never swings.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_blockRaise)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.3,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_blockRaise,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.3,
    toTime: 0.55,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_blockRaise,
    toPose: P_blockHold,
    fallback: P_all,
  });
  t.push([0.85, (k) => poseValue(P_blockHold, k, P_all)]); // the ward is up
  pushPoseRamp(t, {
    fromTime: 0.85,
    toTime: 1.15,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_blockHold,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Ward', t);
}

// --- Cast_Blessing: unhurried raise, a light hold, an outward radiate -----
// Blessing of Might, Devotion Aura, Retribution Aura, and Righteous Fury are
// zero-cast-time party or self buffs, not attacks: no weapon donor at all.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_castLoop)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.4,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_idle,
    toPose: P_raiseEarly,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.4,
    toTime: 0.65,
    steps: 3,
    ease: easeInOutQuad,
    fromPose: P_raiseEarly,
    toPose: P_castLoop,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.65,
    toTime: 0.85,
    steps: 3,
    ease: easeInOutQuad,
    fromPose: P_castLoop,
    toPose: P_shootEarly, // a light outward point/radiate, not the full release
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.85,
    toTime: 1.2,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_shootEarly,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Blessing', t);
}

// --- Cast_HolyMend: hands gathered and raised, a channel hold, gentle pour -
// Holy Light, Flash of Light, and Lay on Hands are heals: benevolent, not
// offensive, so the release stops at a gentle point instead of Verdict's
// smite or Consecrate's slam (the same "gentle point instead of a full
// release" idea Polymorph used for the mage).
{
  const t = [[0, (k) => poseValue(P_idle, k, P_castLoop)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.35,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_idle,
    toPose: P_castLoop,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.35,
    toTime: 0.6,
    steps: 3,
    ease: easeInOutQuad,
    fromPose: P_castLoop,
    toPose: P_raiseHold,
    fallback: P_all,
  });
  t.push([0.85, (k) => poseValue(P_raiseHold, k, P_all)]); // channel beat, gathering light
  pushPoseRamp(t, {
    fromTime: 0.85,
    toTime: 1.05,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_raiseHold,
    toPose: P_shootEarly, // gentle pour toward the target
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 1.05,
    toTime: 1.4,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_shootEarly,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_HolyMend', t);
}

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + all 6 clips): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, animations);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
