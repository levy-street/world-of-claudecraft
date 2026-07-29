// Build the warrior's remaining bespoke movement clip (issue #2889).
// player_warrior in src/render/characters/manifest.ts already carries an
// 18-entry attackByAbility block from earlier PRs; Heroic Leap is the real
// remaining gap that both (a) has no matching donor pose in the existing
// entries and (b) actually reaches attackByAbility at runtime, verified by
// tracing the render dispatch, not assumed:
//
// - whirlwind/bladestorm are hard-routed by src/render/renderer.ts's
//   triggerAttack (isSpinAttackAbility) straight to CharacterVisual.playWhirl,
//   which always plays the generic `clips.attack` cycle and never consults
//   attackByAbility. No attackByAbility entry for either id can ever be read
//   without a renderer/visual.ts dispatch change, which is out of this
//   batch's seam.
// - storm_bolt's ranged-shot cue triggers
//   `triggerAttack(sourceId)` with NO ability id (src/render/ability_vfx/
//   painter.ts's 'projectile' case), so it can never reach an
//   attackByAbility override either.
// - the six castFx:'shout' abilities (battle_shout, demoralizing_shout,
//   emboldening_roar, defiant_bellow, rallying_cry, intimidating_shout) are
//   claimed by the painter's 'shout' case, which unconditionally plays the
//   Cheer emote (playShoutAnim) and never calls triggerAttack with an
//   ability id either.
//
// Heroic Leap has none of that: it carries no castFx, resolves no target
// entity (targetMode: 'position'), and its selfCast completion cue only
// draws body motion via CharacterVisual.hasAttackClipOverride /
// triggerAttack(id, abilityId) IF an attackByAbility entry exists (the exact
// same "ceremonial gesture" mechanism sanguine_aura and raised_guard already
// ride). Today it has none, so it plays nothing at all on the body. This
// authors that clip by pose-sample-and-blend (scripts/anim/pose_blend.mjs)
// off donor poses knight.glb already ships (every clip already baked into
// knight.glb is otherwise wired somewhere in the manifest already: idle/
// walk/attack/hit/emotes account for the full shipped library, so nothing is
// truly spare), the same technique as build_mage_ability_anims.mjs and
// build_elemental_anims.mjs. No Blender.
//
//   Warrior_Heroic_Leap  coil (2H_Melee_Attack_Chop's own windup) -> airborne
//                       (Jump_Idle's own falling/airborne silhouette) -> a
//                       driven two-hand slam on landing (2H_Melee_Attack_Chop's
//                       own impact beat) -> recover. Reads as a jump, not a
//                       swing.
//
// Sampling note: knight.glb's stock KayKit clips (everything except the
// earlier-PR-synthesized Punch_A/Shield_Bash/1H_Melee_Attack_Slice_Horizontal)
// store rotation as normalized Int16 accessors. pose_blend.mjs's sampleChannel
// only normalizes an INTERPOLATED sample (the slerp branch); a time exactly
// at a clip's first or last keyframe short-circuits to the raw, un-normalized
// short values. Every sample below lands strictly inside its donor's open
// time interval to stay off that edge.
//
// Usage: node scripts/build_warrior_ability_anims.mjs [--preview]
// Output: public/models/chars/players/warrior_ability_anims.glb (0 meshes/
// skins, 1 clip: Warrior_Heroic_Leap)
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
const SOURCE = resolve(ROOT, 'public/models/chars/players/knight.glb');
const OUT = resolve(ROOT, 'public/models/chars/players/warrior_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/warrior_ability_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const chopIdx = indexClip(root, '2H_Melee_Attack_Chop');
const jumpIdx = indexClip(root, 'Jump_Idle');

const allKeys = new Set([...idleIdx.keys(), ...chopIdx.keys(), ...jumpIdx.keys()]);
const donorFor = (key) => idleIdx.get(key) ?? jumpIdx.get(key) ?? chopIdx.get(key);

// Donor poses (Idle 1.067s; 2H_Melee_Attack_Chop 1.633s, the same windup/
// impact sample points build_mage_ability_anims.mjs's Cast_Nova borrows;
// Jump_Idle 1.067s, the rig's own airborne/falling silhouette).
const P_idle = samplePose(idleIdx, 0.3);
const P_coil = samplePose(chopIdx, 0.3); // big two-hand windup, read as crouching to launch
const P_air = samplePose(jumpIdx, 0.5); // the rig's own airborne pose
const P_slam = samplePose(chopIdx, 1.0); // the chop's downswing impact, read as the landing slam

// Idle, 2H_Melee_Attack_Chop, and Jump_Idle each carry the full 69-channel
// skeleton on this rig, so no key is actually silent across all three here,
// but every consumer of pushPoseRamp still wants a merged fallback (see
// pose_blend.mjs's mergePoses doc): a future donor swap that trims one of
// these channel sets should not silently reopen the null-fallback crash.
const P_all = mergePoses(P_idle, P_coil, P_air, P_slam);

const timeline = [[0, (k) => poseValue(P_idle, k, P_all)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.22,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_coil,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.22,
  toTime: 0.5,
  steps: 5,
  ease: easeOutCubic,
  fromPose: P_coil,
  toPose: P_air,
  fallback: P_all,
});
timeline.push([0.68, (k) => poseValue(P_air, k, P_all)]); // hang time at the arc's peak
pushPoseRamp(timeline, {
  fromTime: 0.68,
  toTime: 0.88,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_air,
  toPose: P_slam,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.88,
  toTime: 1.15,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_slam,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Warrior_Heroic_Leap',
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
