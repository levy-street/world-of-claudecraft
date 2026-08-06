// Build the hunter's bow-shot animation clip GLB.
//
// The KayKit ranged clips have no bow shot: 2H_Ranged_Shoot is the crossbow
// shoulder-aim, Aiming/Shooting are near-static drawn holds, and Reload is a
// down-then-up crank (the frame-by-frame audit strips in the Season 1 armory
// work). So this script AUTHORS one: it samples donor poses off the shared
// Rig_Medium skeleton (Idle for the bookends, Reload's reach-forward moment,
// the Aiming full-draw hold) and lays out a purpose-built keyframe timeline:
//
//   0.00        idle
//   0.14        raise the bow + reach the string hand forward (nock)
//   0.14-0.46   eased pull back to the full-draw hold (the draw)
//   0.46-0.55   hold at full draw (anticipation)
//   0.55-0.60   release: the string hand springs PAST the hold (overshoot
//               extrapolated on the left-arm chain), tiny torso kick
//   0.60-0.95   follow-through, ease back to idle
//
// BOW_RELEASE_AT (0.55s) is the visual string-snap pose. Auto Shot gameplay
// launches immediately; this authored timing is presentation-only.
//
// The pose-sample-and-blend mechanics (donor indexing, channel sampling,
// clip baking) live in scripts/anim/pose_blend.mjs, shared with
// scripts/build_mage_ability_anims.mjs and scripts/build_elemental_anims.mjs.
// This file keeps only what's specific to the bow-draw timeline itself.
//
// Source (CC0 1.0, no attribution required, already credited in CREDITS.md):
//   KayKit Character Pack: Adventurers 1.0 - Kay Lousberg
//   https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
//   addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb (76 clips)
// Any Adventurers character works as the donor: the rig + clips are identical
// across them; only the (discarded) mesh differs.
//
//   node scripts/build_bow_anims.mjs <source-Adventurers-character.glb>
//
// Output: public/models/chars/players/bow_anims.glb (one clip: Bow_Draw_Shot)

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  blendValue,
  createGlbIO,
  easeInOutQuad,
  easeOutCubic,
  indexClip,
  poseValue,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export const BOW_CLIP_NAME = 'Bow_Draw_Shot';
export const BOW_RELEASE_AT = 0.55; // seconds into the clip at timeScale 1

// Donor poses: clip name + absolute time (seconds) to sample.
const POSE_IDLE = { clip: 'Idle', at: 0.2 };
const POSE_REACH = { clip: '2H_Ranged_Reload', at: 0.33 }; // string hand forward on the bow
const POSE_HOLD = { clip: '2H_Ranged_Aiming', at: 0.5 }; // full-draw hold

// The string-hand chain that springs on release (overshoot past the hold).
const RELEASE_CHAIN = new Set(['upperarm.l', 'lowerarm.l', 'wrist.l', 'hand.l', 'handslot.l']);
const RELEASE_OVERSHOOT = 0.22;

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error('usage: node scripts/build_bow_anims.mjs <source-Adventurers-character.glb>');
  process.exit(1);
}
const OUT = resolve(ROOT, 'public/models/chars/players/bow_anims.glb');

// ---------------------------------------------------------------------------
// donor sampling
// ---------------------------------------------------------------------------
const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, POSE_IDLE.clip);
const reachIdx = indexClip(root, POSE_REACH.clip);
const holdIdx = indexClip(root, POSE_HOLD.clip);

// The channel set we author = the union of channels across donors, so a bone
// animated by any donor gets explicit keys (missing entries fall back to the
// idle donor's sample, else stay unkeyed).
const channelKeys = new Set([...idleIdx.keys(), ...reachIdx.keys(), ...holdIdx.keys()]);

const P_idle = samplePose(idleIdx, POSE_IDLE.at);
const P_reach = samplePose(reachIdx, POSE_REACH.at);
const P_hold = samplePose(holdIdx, POSE_HOLD.at);

// Release pose: the string-hand chain overshoots PAST the hold along the
// reach->hold direction; everything else stays at the hold.
function releaseValue(key, nodeName) {
  const hold = poseValue(P_hold, key, P_idle);
  if (!RELEASE_CHAIN.has(nodeName)) return hold;
  const reach = poseValue(P_reach, key, P_idle) ?? hold;
  return blendValue(key, reach, hold, 1 + RELEASE_OVERSHOOT);
}

// ---------------------------------------------------------------------------
// the authored timeline
// ---------------------------------------------------------------------------
const DRAW_STEPS = 8;
const FOLLOW_STEPS = 5;

/** [time, valueFor(key, nodeName)] rows, shared by every channel. */
const timeline = [];
timeline.push([0, (k) => poseValue(P_idle, k, P_hold)]);
// raise + reach the string (fast, slightly eased)
timeline.push([
  0.07,
  (k) => blendValue(k, poseValue(P_idle, k, P_hold), poseValue(P_reach, k, P_idle), 0.55),
]);
timeline.push([0.14, (k) => poseValue(P_reach, k, P_idle)]);
// the draw: eased pull from reach to the full-draw hold
for (let s = 1; s <= DRAW_STEPS; s++) {
  const f = s / DRAW_STEPS;
  const t = 0.14 + (0.46 - 0.14) * f;
  const e = easeOutCubic(f);
  timeline.push([
    t,
    (k) => blendValue(k, poseValue(P_reach, k, P_idle), poseValue(P_hold, k, P_idle), e),
  ]);
}
// anticipation hold
timeline.push([0.55, (k) => poseValue(P_hold, k, P_idle)]);
// release snap (fast overshoot on the string-hand chain)
timeline.push([0.6, (k, node) => releaseValue(k, node)]);
// follow-through back to idle
for (let s = 1; s <= FOLLOW_STEPS; s++) {
  const f = s / FOLLOW_STEPS;
  const t = 0.6 + (0.95 - 0.6) * f;
  const e = easeInOutQuad(f);
  timeline.push([
    t,
    (k, node) => blendValue(k, releaseValue(k, node), poseValue(P_idle, k, P_hold), e),
  ]);
}

// ---------------------------------------------------------------------------
// bake the clip + write the GLB
// ---------------------------------------------------------------------------
const { animation, authored, times } = bakeClip(doc, {
  clipName: BOW_CLIP_NAME,
  channelKeys,
  timeline,
  donorFor: (key) => holdIdx.get(key) ?? reachIdx.get(key) ?? idleIdx.get(key),
});

stripToAnimationsOnly(doc, [animation]);
await doc.transform(prune(), dedup());

await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
console.log(`channels authored: ${authored}, keys per channel: ${times.length}`);
console.log(`release at ${BOW_RELEASE_AT}s of ${times[times.length - 1]}s`);
