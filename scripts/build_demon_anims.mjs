// Build the warlock demon pet family's bespoke attack clip (issue #2889
// round 2). mob_demon AND mob_demonalt both share the literal BIPED14
// ClipMap object, by reference, with 4 OTHER unrelated families in
// src/render/characters/manifest.ts (mob_bear, mob_yeti, mob_murloc,
// mob_troll), so the little orange emberkin and the bulky gloomshade (both
// demonalt.glb, differentiated only by entity colour and the mob
// template's scale per the manifest comment on mob_demon) "attack" with the
// same generic Punch/Weapon as an orc troll or a frog murloc. Authors one
// distinct clip by pose-sample-and-blend (scripts/anim/pose_blend.mjs) off
// donor poses already baked into the shipped demonalt.glb itself: Idle (the
// bookend), Weapon (the two-hand attack donor), and Yes, a currently UNUSED
// clip this GLB ships (a downward nod). No Blender: see
// .claude/skills/blender-anim-pipeline/SKILL.md.
//
//   Demon_Attack: raise the weapon (Weapon's early windup), nod down
//   sharply (Yes, a demonic downward nod), slash through the full Weapon
//   impact pose, settle to idle.
//
// mob_demon and mob_demonalt already share their base tint-only
// differentiation (both point at demonalt.glb, entity-tinted), so sharing
// this new attack too is consistent with how the rest of that pairing
// already works: one output GLB, one new ClipMap, both VisualDefs wired to
// it in the same change.
//
// Usage: node scripts/build_demon_anims.mjs [--preview]
// Output: public/models/creatures/demon_ability_anims.glb (0 meshes/skins,
// 1 clip: Demon_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/demonalt.glb');
const OUT = resolve(ROOT, 'public/models/creatures/demon_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/demon_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const weaponIdx = indexClip(root, 'Weapon');
const yesIdx = indexClip(root, 'Yes');

const allKeys = new Set([...idleIdx.keys(), ...weaponIdx.keys(), ...yesIdx.keys()]);
const donorFor = (key) => weaponIdx.get(key) ?? yesIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 1.000s,
// Weapon 0.833s, Yes 1.667s).
const P_idle = samplePose(idleIdx, 0.3);
const P_raise = samplePose(weaponIdx, 0.13); // early weapon raise, windup
const P_nod = samplePose(yesIdx, 0.42); // demonic downward nod
const P_slash = samplePose(weaponIdx, 0.66); // full weapon impact, the slash

// Locomotion (Idle) and the gesture donors (Weapon, Yes) don't all animate
// the same channel set on this rig: merge every donor pose once so every
// channel any of them animates has SOME fallback instead of null-ing out.
const P_all = mergePoses(P_idle, P_raise, P_nod, P_slash);

const timeline = [[0, (k) => poseValue(P_idle, k, P_raise)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.17,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_raise,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.17,
  toTime: 0.38,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_raise,
  toPose: P_nod,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.38,
  toTime: 0.62,
  steps: 5,
  ease: easeOutCubic,
  fromPose: P_nod,
  toPose: P_slash,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.62,
  toTime: 0.92,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_slash,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Demon_Attack',
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
