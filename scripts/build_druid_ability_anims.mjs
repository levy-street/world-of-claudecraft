// Build the druid's ability-specific spellcast clips (issue #2889: the caster
// side of the class has zero attackByAbility overrides today, so every one of
// its nature/arcane spells plays the same 2H staff chop, player_druid in
// src/render/characters/manifest.ts). Scope is the CASTER kit only (moonfire,
// starfire, wrath, and similar): bear/cat/travel forms already have their own
// dedicated ClipMap constants (BEAR_FORM/WOLF_BAKED/CHICKEN_COW) and are out
// of scope for this batch.
//
// druid.glb ships the exact same KayKit rig and clip vocabulary as mage.glb
// (Idle, Spellcast_Raise, Spellcast_Shoot, Spellcasting, 2H_Melee_Attack_Chop,
// Dualwield_Melee_Attack_Chop, identical durations and channel counts), so
// this authors 5 distinct casts by pose-sample-and-blend (scripts/anim/
// pose_blend.mjs, the technique behind the hunter's bow_anims.glb and the
// mage's mage_ability_anims.glb) off druid.glb's own donor poses. No Blender.
//
// Mapped primarily by school (src/sim/content/classes.ts), same signal batch
// 1 used for the mage, with named exceptions for role (heal / root-CC /
// channel) since the druid's nature school alone spans heals, bolts, DoTs,
// and buffs:
//
//   Cast_Nature    quick raise, decisive release, snappy return: the default
//                  nature-school cast (wrath, faerie_fire, thorns,
//                  mark_of_the_wild, insect_swarm)
//   Cast_Starfall  full raise, a held anticipation beat, crisp late release:
//                  the two arcane-school "boomkin-style" spells (moonfire,
//                  starfire), same shape family as the mage's Cast_Frost but
//                  its own clip name so the two classes never share a baked
//                  clip
//   Cast_Nurture   slow gentle raise, a SUSTAINED hold, gentle settle: no
//                  release beat at all, because a heal channels calm energy
//                  INTO the target rather than firing anything outward
//                  (healing_touch, regrowth, rejuvenation)
//   Cast_Roots     borrows 2H_Melee_Attack_Chop's committed downswing to read
//                  as planting the staff and driving roots into the ground,
//                  with a longer held beat at the impact pose (the roots
//                  gripping) before releasing (entangling_roots, hibernate:
//                  both are nature-school incapacitates, so the same
//                  ground-bind gesture covers either)
//   Cast_Storm     three rapid pulses built from Dualwield_Melee_Attack_Chop's
//                  alternating chop energy (calling wind from multiple
//                  directions at once), settling into a brief channel-open
//                  beat before release: hurricane, the one channelled AoE in
//                  the kit
//
// Usage: node scripts/build_druid_ability_anims.mjs [--preview]
// Output: public/models/chars/players/druid_ability_anims.glb (0 meshes/skins,
// 5 clips: Cast_Nature, Cast_Starfall, Cast_Nurture, Cast_Roots, Cast_Storm)
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
const SOURCE = resolve(ROOT, 'public/models/chars/players/druid.glb');
const OUT = resolve(ROOT, 'public/models/chars/players/druid_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/druid_ability_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const raiseIdx = indexClip(root, 'Spellcast_Raise');
const castIdx = indexClip(root, 'Spellcasting');
const shootIdx = indexClip(root, 'Spellcast_Shoot');
const chopIdx = indexClip(root, '2H_Melee_Attack_Chop');
const dualIdx = indexClip(root, 'Dualwield_Melee_Attack_Chop');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...raiseIdx.keys(),
  ...castIdx.keys(),
  ...shootIdx.keys(),
  ...chopIdx.keys(),
  ...dualIdx.keys(),
]);
const donorFor = (key) =>
  raiseIdx.get(key) ??
  castIdx.get(key) ??
  shootIdx.get(key) ??
  dualIdx.get(key) ??
  chopIdx.get(key) ??
  idleIdx.get(key);

// Donor poses, sampled once at chosen timestamps within each clip's real
// duration (Idle 1.067s, Spellcast_Raise 2.100s, Spellcasting 0.667s,
// Spellcast_Shoot 0.933s, 2H_Melee_Attack_Chop 1.633s, Dualwield_Melee_Attack_
// Chop 1.267s).
const P_idle = samplePose(idleIdx, 0.3);
const P_raiseEarly = samplePose(raiseIdx, 0.3); // starting to lift the staff
const P_raiseHold = samplePose(raiseIdx, 1.8); // sustained ready pose near the tail
const P_castLoop = samplePose(castIdx, 0.3); // mid-loop channel pose
const P_shootEarly = samplePose(shootIdx, 0.2); // windup, before commitment
const P_shootRelease = samplePose(shootIdx, 0.7); // full release / follow-through
const P_chopWind = samplePose(chopIdx, 0.3); // big two-hand windup
const P_chopImpact = samplePose(chopIdx, 1.0); // downswing impact / staff plant
const P_dualEarly = samplePose(dualIdx, 0.2); // first chop, drawing wind in
const P_dualMid = samplePose(dualIdx, 0.6); // second chop, opposite direction
const P_dualLate = samplePose(dualIdx, 1.0); // third chop, gathering the churn

// Donor clips don't all animate the same channel set (Spellcasting and
// 2H_Melee_Attack_Chop are missing a handful of bones the full-rig clips
// carry): a single donor pose is an incomplete poseValue fallback
// (pose_blend.mjs mergePoses doc, and the exact bug the elemental script's
// fix addressed). Merge every donor pose sampled above so every channel any
// of them animates always resolves to something instead of null mid-blend.
const P_all = mergePoses(
  P_idle,
  P_raiseEarly,
  P_raiseHold,
  P_castLoop,
  P_shootEarly,
  P_shootRelease,
  P_chopWind,
  P_chopImpact,
  P_dualEarly,
  P_dualMid,
  P_dualLate,
);

const animations = [];

function bake(clipName, timeline) {
  const { animation } = bakeClip(doc, { clipName, channelKeys: allKeys, timeline, donorFor });
  animations.push(animation);
}

// --- Cast_Nature: quick raise, decisive release, snappy return ------------
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
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_raiseEarly,
    toPose: P_shootRelease,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.35,
    toTime: 0.65,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_shootRelease,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Nature', t);
}

// --- Cast_Starfall: full raise, held anticipation, crisp late release -----
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
  t.push([0.65, (k) => poseValue(P_raiseHold, k, P_all)]); // anticipation hold
  pushPoseRamp(t, {
    fromTime: 0.65,
    toTime: 0.85,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_raiseHold,
    toPose: P_shootRelease,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.85,
    toTime: 1.15,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_shootRelease,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Starfall', t);
}

// --- Cast_Nurture: gentle raise, sustained hold, gentle settle ------------
// No release beat anywhere in this timeline: a heal channels calm energy
// INTO the target rather than firing anything outward, so this deliberately
// never touches P_shootEarly/P_shootRelease the way every other clip does.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_raiseHold)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.75,
    steps: 7,
    ease: easeInOutQuad,
    fromPose: P_idle,
    toPose: P_raiseHold,
    fallback: P_all,
  });
  t.push([1.0, (k) => poseValue(P_raiseHold, k, P_all)]); // sustained soft hold
  pushPoseRamp(t, {
    fromTime: 1.0,
    toTime: 1.35,
    steps: 6,
    ease: easeInOutQuad,
    fromPose: P_raiseHold,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Nurture', t);
}

// --- Cast_Roots: committed staff-plant slam, a held grip, then release ----
{
  const t = [[0, (k) => poseValue(P_idle, k, P_chopWind)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.3,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_chopWind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.3,
    toTime: 0.6,
    steps: 5,
    ease: easeOutCubic,
    fromPose: P_chopWind,
    toPose: P_chopImpact,
    fallback: P_all,
  });
  t.push([0.85, (k) => poseValue(P_chopImpact, k, P_all)]); // the roots taking hold
  pushPoseRamp(t, {
    fromTime: 0.85,
    toTime: 1.2,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_chopImpact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Roots', t);
}

// --- Cast_Storm: three rapid pulses (calling wind from every direction) ---
{
  const t = [[0, (k) => poseValue(P_idle, k, P_dualEarly)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.15,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_dualEarly,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.15,
    toTime: 0.32,
    steps: 3,
    ease: easeInOutQuad,
    fromPose: P_dualEarly,
    toPose: P_dualMid,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.32,
    toTime: 0.49,
    steps: 3,
    ease: easeInOutQuad,
    fromPose: P_dualMid,
    toPose: P_dualLate,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.49,
    toTime: 0.66,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_dualLate,
    toPose: P_castLoop,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.66,
    toTime: 1.0,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_castLoop,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Cast_Storm', t);
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
