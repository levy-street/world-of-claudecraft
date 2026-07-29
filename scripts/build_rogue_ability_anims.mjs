// Build the rogue's ability-specific attack clips (issue #2889). The class
// already ships 3 attackByAbility overrides from an earlier, unrelated
// generation (Garrote_Choke, Kick_A, Dirt_Throw, all baked straight into
// rogue.glb itself, not produced by this pose_blend pipeline); the rest of the
// kit still plays the same Dualwield_Melee_Attack_Chop for every ability. This
// authors 5 distinct clips by pose-sample-and-blend (see scripts/anim/
// pose_blend.mjs, the technique behind build_mage_ability_anims.mjs and
// build_elemental_anims.mjs) off donor poses already baked into the shipped
// rogue.glb, no Blender. rogue.glb ships a trimmed KayKit set: 1H_Melee_Attack_
// Slice_Diagonal and Block are baked in but UNWIRED by player_rogue's ClipMap
// (only Dualwield_Melee_Attack_Chop is named as the plain attack), so both are
// free raw material, same as build_elemental_anims.mjs reusing golelingevolved.
// glb's unwired No/Yes. Spellcast_Shoot is likewise shipped but unwired for a
// dagger class (kaykit() only names Spellcasting, the looping cast channel).
//
//   Rogue_Quick_Strike   quick raise off the diagonal slice, decisive early
//                        cut, snappy return (Wicked Slash's combo-builder
//                        poke; also backs Eye Jab and Sap, both instant
//                        single-target debilitating strikes with no unique
//                        silhouette of their own)
//   Rogue_Backstab       dual-chop windup driven into Spellcast_Shoot's full
//                        forward extension instead of a release pose:
//                        rogue.glb ships no dedicated reach-around-the-back
//                        donor, so this approximates "drive the dagger in"
//                        with the closest shipped thrust silhouette, landing
//                        controlled rather than showy (Backstab is a 1.5x
//                        opener, not the kit's biggest hit)
//   Rogue_Ambush         a held Block guard first (the stealth crouch-ready
//                        read), an anticipation beat, then a full dual-chop
//                        windup into its own impact frame: bigger and more
//                        telegraphed than Quick_Strike, matching Ambush's
//                        2.5x weapon multiplier as the kit's biggest single
//                        hit
//   Rogue_Low_Blow       a quick dip into the Block guard's low stance, then
//                        a fast diagonal-slice impact aimed low (Gut Punch
//                        and Low Blow both land at gut/kidney height)
//   Rogue_Finisher_Slash full dual-chop windup, a held anticipation beat, the
//                        chop's own impact, then the diagonal slice's impact
//                        as a cross follow-through: the kit's combo-spending
//                        finishers (Dirt Nap, Bleed Out, Armor Breach) read
//                        as one decisive two-blade cut, not a repeat of the
//                        plain auto-attack
//
// Ghostfoot (evasion) points straight at rogue.glb's own already-baked
// 'Block' clip (a defensive guard, no bake needed): the same no-bake pattern
// player_warrior's raised_guard already uses. Cutthroat Tempo, Smokestep,
// Quickened Blood, and Duskveil are all self-buff/stealth toggles with no
// combat swing to author, so they point at rogue.glb's own already-baked
// 'Spellcast_Raise' clip, the pattern player_warrior's sanguine_aura and the
// hunter batch's aspect toggles both use. Adder's Bite and Festering Venom
// (instant_poison/deadly_poison) are weapon-imbue self-buffs excluded from
// this batch, the same call the mage batch made for its own utility/summon
// abilities: not every ability in the kit needs a listing, a representative
// slice across the kit's real damage/CC abilities is the bar.
//
// Usage: node scripts/build_rogue_ability_anims.mjs [--preview]
// Output: public/models/chars/players/rogue_ability_anims.glb (0 meshes/
// skins, 5 clips: Rogue_Quick_Strike, Rogue_Backstab, Rogue_Ambush,
// Rogue_Low_Blow, Rogue_Finisher_Slash)
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
const SOURCE = resolve(ROOT, 'public/models/chars/players/rogue.glb');
const OUT = resolve(ROOT, 'public/models/chars/players/rogue_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/rogue_ability_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const dwIdx = indexClip(root, 'Dualwield_Melee_Attack_Chop');
const slashIdx = indexClip(root, '1H_Melee_Attack_Slice_Diagonal');
const blockIdx = indexClip(root, 'Block');
const shootIdx = indexClip(root, 'Spellcast_Shoot');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...dwIdx.keys(),
  ...slashIdx.keys(),
  ...blockIdx.keys(),
  ...shootIdx.keys(),
]);
const donorFor = (key) =>
  dwIdx.get(key) ?? slashIdx.get(key) ?? blockIdx.get(key) ?? shootIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled once at chosen timestamps within each clip's real
// duration (Idle 1.067s, Dualwield_Melee_Attack_Chop 1.267s, 1H_Melee_Attack_
// Slice_Diagonal 1.000s, Block 1.067s, Spellcast_Shoot 0.933s).
const P_idle = samplePose(idleIdx, 0.3);
const P_dwWind = samplePose(dwIdx, 0.25); // dual-dagger windup, blades drawn back
const P_dwImpact = samplePose(dwIdx, 0.7); // dual-dagger impact, full committed cross
const P_slashWind = samplePose(slashIdx, 0.2); // diagonal slice windup, light and quick
const P_slashImpact = samplePose(slashIdx, 0.55); // diagonal slice impact
const P_blockGuard = samplePose(blockIdx, 0.55); // held low guard / crouch-ready stance
const P_shootRelease = samplePose(shootIdx, 0.65); // full forward extension

// rogue.glb's donor clips don't all animate the same channel set (pose_blend.mjs
// mergePoses doc): merge every donor pose once so every channel any of them
// animates has SOME fallback value instead of null-ing out mid-blend.
const P_all = mergePoses(
  P_idle,
  P_dwWind,
  P_dwImpact,
  P_slashWind,
  P_slashImpact,
  P_blockGuard,
  P_shootRelease,
);

const animations = [];

function bake(clipName, timeline) {
  const { animation } = bakeClip(doc, { clipName, channelKeys: allKeys, timeline, donorFor });
  animations.push(animation);
}

// --- Rogue_Quick_Strike: quick raise, decisive early cut, snappy return ---
{
  const t = [[0, (k) => poseValue(P_idle, k, P_slashWind)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.1,
    steps: 2,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_slashWind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.1,
    toTime: 0.22,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_slashWind,
    toPose: P_slashImpact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.22,
    toTime: 0.45,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_slashImpact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Rogue_Quick_Strike', t);
}

// --- Rogue_Backstab: dual-chop windup driven into a full forward thrust ---
{
  const t = [[0, (k) => poseValue(P_idle, k, P_dwWind)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.15,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_dwWind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.15,
    toTime: 0.35,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_dwWind,
    toPose: P_shootRelease,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.35,
    toTime: 0.62,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_shootRelease,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Rogue_Backstab', t);
}

// --- Rogue_Ambush: a held crouch-ready guard, then the kit's biggest lunge ---
{
  const t = [[0, (k) => poseValue(P_idle, k, P_blockGuard)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.22,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_blockGuard,
    fallback: P_all,
  });
  t.push([0.4, (k) => poseValue(P_blockGuard, k, P_idle)]); // stealth anticipation hold
  pushPoseRamp(t, {
    fromTime: 0.4,
    toTime: 0.62,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_blockGuard,
    toPose: P_dwWind,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.62,
    toTime: 0.85,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_dwWind,
    toPose: P_dwImpact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.85,
    toTime: 1.15,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_dwImpact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Rogue_Ambush', t);
}

// --- Rogue_Low_Blow: a quick dip into a low guard, then a fast low strike ---
{
  const t = [[0, (k) => poseValue(P_idle, k, P_blockGuard)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.15,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_blockGuard,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.15,
    toTime: 0.32,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_blockGuard,
    toPose: P_slashImpact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.32,
    toTime: 0.55,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_slashImpact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Rogue_Low_Blow', t);
}

// --- Rogue_Finisher_Slash: full windup, a held beat, impact, cross follow ---
{
  const t = [[0, (k) => poseValue(P_idle, k, P_dwWind)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.25,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_dwWind,
    fallback: P_all,
  });
  t.push([0.42, (k) => poseValue(P_dwWind, k, P_idle)]); // anticipation hold
  pushPoseRamp(t, {
    fromTime: 0.42,
    toTime: 0.65,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_dwWind,
    toPose: P_dwImpact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.65,
    toTime: 0.82,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_dwImpact,
    toPose: P_slashImpact,
    fallback: P_all,
  });
  pushPoseRamp(t, {
    fromTime: 0.82,
    toTime: 1.15,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_slashImpact,
    toPose: P_idle,
    fallback: P_all,
  });
  bake('Rogue_Finisher_Slash', t);
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
