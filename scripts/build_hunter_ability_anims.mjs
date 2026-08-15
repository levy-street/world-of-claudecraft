// Build the hunter's ability-specific attack clips (issue #2889: the class has
// ZERO attackByAbility overrides today, so every one of its 16 abilities plays
// the same crossbow-shoulder 2H_Ranged_Shoot, player_hunter in
// src/render/characters/manifest.ts). This authors 6 distinct clips by
// pose-sample-and-blend (see scripts/anim/pose_blend.mjs, the technique behind
// the hunter's own bow_anims.glb) off donor poses already baked into the
// shipped ranger.glb, no Blender. ranger.glb ships a trimmed 22-clip KayKit
// set (no 2H_Ranged_Reload/2H_Ranged_Aiming like the external Adventurers
// source bow_anims.mjs draws from), so the shot clips below sample
// Spellcast_Raise/Spellcast_Shoot instead: both are baked into ranger.glb but
// UNWIRED by player_hunter's ClipMap today (kaykit() only names Spellcasting,
// for the looping `cast` channel), so they are free raw material, same as
// build_elemental_anims.mjs reusing golelingevolved.glb's unwired No/Yes. The
// three melee clips reuse ranger.glb's own unwired 1H_Melee_Attack_Slice_Diagonal,
// 1H_Melee_Attack_Chop, Block, and 2H_Melee_Attack_Chop donors (none of them
// named by kaykit(['2H_Ranged_Shoot']) either, since a ranged class never
// plays a melee swing today).
//
//   Hunter_Melee_Gut      quick raise off the diagonal slice, decisive early
//                         cut, snappy return (Gutting Strike: a fast opener)
//   Hunter_Melee_Counter  a held Block guard first, then a fast pivot into a
//                         1H chop (Counterfang only fires AFTER the target
//                         dodges the hunter, so the read is parry-then-punish,
//                         not a fresh swing)
//   Hunter_Melee_Clip     the 2H chop's own low, grounded impact frame
//                         (Fettering Slash hits at leg height per its own
//                         ability VFX spec comment: "low leg hack"), short
//                         recovery, no lingering flourish
//   Hunter_Shot_Snap      quick raise off Spellcast_Shoot, decisive early
//                         release, snappy return (every instant no-cast-time
//                         shot: Fell Shot, Rattling Shot, Venom Barb, Hushing
//                         Shot all fire off the string the same way)
//   Hunter_Shot_LongDraw  full raise held near Spellcast_Raise's own sustained
//                         tail, an anticipation beat, then a crisp release
//                         (Long Draw literally names the 3.0s cast this backs)
//   Hunter_Shot_Volley    three rapid raise/release pulses off Spellcast_Shoot
//                         (Volley's own rain of arrows, the ranged mirror of
//                         Cast_Arcane's missile-barrage pulse pattern)
//
// Aspect_of_the_Hawk/Monkey/Cheetah and Fevered Draw (rapid_fire) are all
// self-buff toggles (no target, no damage): they point attackByAbility
// straight at ranger.glb's own already-baked 'Spellcast_Raise' clip, no
// authoring needed, the exact pattern player_warrior's sanguine_aura already
// uses for its own Spellcast_Raise reference. tame_beast/dismiss_pet/revive_pet
// are pet-command channels with no combat swing to author (this batch's
// representative slice follows batch 1's mage precedent of leaving
// utility/summon abilities on the default clip).
//
// Usage: node scripts/build_hunter_ability_anims.mjs [--preview]
// Output: public/models/chars/players/hunter_ability_anims.glb (0 meshes/
// skins, 6 clips: Hunter_Melee_Gut, Hunter_Melee_Counter, Hunter_Melee_Clip,
// Hunter_Shot_Snap, Hunter_Shot_LongDraw, Hunter_Shot_Volley)
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
const SOURCE = resolve(ROOT, 'public/models/chars/players/ranger.glb');
const OUT = resolve(ROOT, 'public/models/chars/players/hunter_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/hunter_ability_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const slashIdx = indexClip(root, '1H_Melee_Attack_Slice_Diagonal');
const chopIdx = indexClip(root, '1H_Melee_Attack_Chop');
const blockIdx = indexClip(root, 'Block');
const chop2hIdx = indexClip(root, '2H_Melee_Attack_Chop');
const raiseIdx = indexClip(root, 'Spellcast_Raise');
const shootIdx = indexClip(root, 'Spellcast_Shoot');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...slashIdx.keys(),
  ...chopIdx.keys(),
  ...blockIdx.keys(),
  ...chop2hIdx.keys(),
  ...raiseIdx.keys(),
  ...shootIdx.keys(),
]);
const donorFor = (key) =>
  slashIdx.get(key) ??
  chopIdx.get(key) ??
  blockIdx.get(key) ??
  chop2hIdx.get(key) ??
  shootIdx.get(key) ??
  raiseIdx.get(key) ??
  idleIdx.get(key);

// Donor poses, sampled once at chosen timestamps within each clip's real
// duration (Idle 1.067s, 1H_Melee_Attack_Slice_Diagonal 1.000s,
// 1H_Melee_Attack_Chop 1.067s, Block 1.067s, 2H_Melee_Attack_Chop 1.633s,
// Spellcast_Raise 2.100s, Spellcast_Shoot 0.933s). The 2H chop windup/impact
// timestamps mirror build_mage_ability_anims.mjs's own picks for the same
// clip name baked into mage.glb (same underlying KayKit rig, same timing);
// the 1H chop/slice timestamps keep the same wind/impact fractions (0.18,
// 0.61 of clip length) scaled to each clip's own shorter duration.
const P_idle = samplePose(idleIdx, 0.3);
const P_slashWind = samplePose(slashIdx, 0.18); // early raise into the diagonal cut
const P_slashImpact = samplePose(slashIdx, 0.61); // the decisive gut-cut
const P_chopWind = samplePose(chopIdx, 0.2); // 1H raise
const P_chopImpact = samplePose(chopIdx, 0.65); // 1H counter-strike impact
const P_block = samplePose(blockIdx, 0.6); // held guard
const P_2hWind = samplePose(chop2hIdx, 0.3); // big two-hand windup
const P_2hImpact = samplePose(chop2hIdx, 1.0); // low, grounded downswing impact
const P_raiseEarly = samplePose(raiseIdx, 0.3); // starting to raise the bow arm
const P_raiseHold = samplePose(raiseIdx, 1.8); // sustained full-draw hold near the tail
const P_shootEarly = samplePose(shootIdx, 0.2); // windup, before commitment
const P_shootRelease = samplePose(shootIdx, 0.7); // full release / follow-through

// ranger.glb's donor clips don't all animate the same channel set (2H_Melee_
// Attack_Chop's two-hand grip skips off-hand bones the 1H/ranged clips touch,
// and vice versa), so a single donor pose is an incomplete fallback
// (pose_blend.mjs mergePoses doc, the exact trap build_elemental_anims.mjs
// hit and fixed): merge every donor pose once so every channel any of them
// animates has SOME fallback value instead of null-ing out mid-blend.
const P_all = mergePoses(
  P_idle,
  P_slashWind,
  P_slashImpact,
  P_chopWind,
  P_chopImpact,
  P_block,
  P_2hWind,
  P_2hImpact,
  P_raiseEarly,
  P_raiseHold,
  P_shootEarly,
  P_shootRelease,
);

const animations = [];

function bake(clipName, timeline) {
  const { animation } = bakeClip(doc, { clipName, channelKeys: allKeys, timeline, donorFor });
  animations.push(animation);
}

// --- Hunter_Melee_Gut: quick raise, decisive early cut, snappy return -----
{
  const t = [[0, (k) => poseValue(P_idle, k, P_slashWind)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.15,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_slashWind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.15,
    toTime: 0.35,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_slashWind,
    toPose: P_slashImpact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.35,
    toTime: 0.65,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_slashImpact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Hunter_Melee_Gut', t);
}

// --- Hunter_Melee_Counter: held Block guard, then a fast pivot-punish -----
// Counterfang only fires after the target dodges, so the read is
// parry-then-strike, not a fresh swing.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_block)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.2,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_block,
    fallback: P_all,
  });
  t.push([0.4, (k) => poseValue(P_block, k, P_all)]); // held guard
  pushPoseRamp(t, {
    fromTime: 0.4,
    toTime: 0.5,
    steps: 2,
    ease: easeOutCubic,
    fromPose: P_block,
    toPose: P_chopWind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.5,
    toTime: 0.62,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_chopWind,
    toPose: P_chopImpact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.62,
    toTime: 0.9,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_chopImpact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Hunter_Melee_Counter', t);
}

// --- Hunter_Melee_Clip: low, grounded cut, short recovery ------------------
// Fettering Slash's own ability VFX spec comment calls it a "low leg, hack":
// the 2H chop's own downswing impact frame is already low and grounded, so it
// donates the cut pose; the recovery stays short, no lingering flourish.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_2hWind)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.25,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_2hWind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.25,
    toTime: 0.45,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_2hWind,
    toPose: P_2hImpact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.45,
    toTime: 0.7,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_2hImpact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Hunter_Melee_Clip', t);
}

// --- Hunter_Shot_Snap: quick raise, decisive early release, snappy return -
// Every instant no-cast-time shot (Fell Shot, Rattling Shot, Venom Barb,
// Hushing Shot) fires off the string the same way.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_shootEarly)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.15,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_shootEarly,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.15,
    toTime: 0.32,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_shootEarly,
    toPose: P_shootRelease,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.32,
    toTime: 0.6,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_shootRelease,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Hunter_Shot_Snap', t);
}

// --- Hunter_Shot_LongDraw: full raise, held anticipation, crisp release ---
// Long Draw literally names the 3.0s cast this backs; the structure mirrors
// Cast_Frost's own full-raise-then-hold shape.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_raiseHold)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.35,
    steps: 5,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_raiseEarly,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.35,
    toTime: 0.7,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_raiseEarly,
    toPose: P_raiseHold,
    fallback: P_all,
  });
  t.push([1.0, (k) => poseValue(P_raiseHold, k, P_all)]); // anticipation hold
  pushPoseRamp(t, {
    fromTime: 1.0,
    toTime: 1.2,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_raiseHold,
    toPose: P_shootRelease,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 1.2,
    toTime: 1.5,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_shootRelease,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Hunter_Shot_LongDraw', t);
}

// --- Hunter_Shot_Volley: three rapid raise/release pulses (rain of arrows) -
// The ranged mirror of Cast_Arcane's missile-barrage pulse pattern.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_shootEarly)]];
  let cursor = 0;
  const pulse = (from, to, dur) => {
    pushPoseRamp(t, {
      fromTime: cursor,
      toTime: cursor + dur,
      steps: 3,
      ease: easeOutCubic,
      fromPose: from,
      toPose: to,
      fallback: P_all,
    });
    cursor += dur;
  };
  pulse(P_idle, P_shootEarly, 0.12);
  for (let i = 0; i < 3; i++) {
    pulse(P_shootEarly, P_shootRelease, 0.09);
    pulse(P_shootRelease, P_shootEarly, 0.09);
  }
  pulse(P_shootEarly, P_idle, 0.3);
  bake('Hunter_Shot_Volley', t);
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
