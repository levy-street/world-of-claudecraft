// Balgath the cyclops variant: the bespoke clip set for the second boss silhouette.
//
// Same technique as `scripts/build_balgath_anims.mjs` (pose-sample-and-blend over the
// rig's OWN retargeted clips, via `scripts/anim/pose_blend.mjs`) but a different donor
// budget, because this rig came back with a much poorer library than the foreman's:
//
//   Idle    clean neutral stand                  <- the bookend
//   Cast    a lunge and a raised-fist guard      <- the only committed poses on the rig
//   Hit     a forward crouch, fists at the face  <- the reel, and the closest thing to a crouch
//   Jump    nearly static                        (unusable: it barely leaves the idle)
//   Attack  FOLDED, the slash preset collapsed this body  (unusable, and never wired)
//   Walk / Run / Death                            (locomotion and the death one-shot, left alone)
//
// This ships TWO clips where the foreman ships six, and that is a review outcome, not
// an oversight. The full six were baked and rendered first; Smash, EyeFlare and Roar
// came back mediocre and, worse, barely distinguishable from each other, because all
// three wanted an overhead reach this rig's donors do not contain. Shipping them would
// have put three near-identical poses behind three different mechanics, which is the
// opposite of what a telegraph is for. The two that survived did so on their own merits:
//
//  - Stomp reads: the Hit crouch is genuinely lower than the idle, so the weight drop
//    lands even without a real crouch donor.
//  - Blinded is the best clip on this rig, because the Hit donor IS a hands-at-the-face
//    crouch, which is exactly what a blinded giant does.
//
// What is deliberately NOT here, and why:
//  - No Smash. Use Stomp; a second slam that looks like the first buys nothing.
//  - No EyeFlare or Roar. This rig's own retargeted `Cast` is clean and already reads as
//    a raised channel, so the VisualDef points `cast` straight at it instead.
//  - No Wake. Rising out of a barrow needs a folded-low pose and nothing here is folded
//    low enough to blend from. Faking it from a standing donor is the exact mistake the
//    foreman's Wake made once already (the reversed-Death version, which read as a
//    standing figure shuffling). That one needs the Blender escalation path.
//
// The rig's own `Attack` is FOLDED (the slash preset collapsed this body) and is never
// wired anywhere; Stomp is what fills the attack slot.
//
// Usage: node scripts/build_balgath_cyclops_anims.mjs [--preview]
// Output: public/models/creatures/balgath_cyclops_ability_anims.glb (mesh-free, 2 clips)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/balgath_cyclops.glb');
const OUT = resolve(ROOT, 'public/models/creatures/balgath_cyclops_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/balgath_cyclops_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const castIdx = indexClip(root, 'Cast');
const hitIdx = indexClip(root, 'Hit');

const allKeys = new Set([...idleIdx.keys(), ...castIdx.keys(), ...hitIdx.keys()]);
// Cast first: it carries the widest range on this rig, so it is the best guess for a
// channel a timeline never names explicitly.
const donorFor = (key) => castIdx.get(key) ?? hitIdx.get(key) ?? idleIdx.get(key);

// --- donor poses -------------------------------------------------------------
// Timestamps chosen off a rendered 5-frame sweep of each donor, not guessed.
const P_idle = samplePose(idleIdx, 0.2);
const P_guard = samplePose(castIdx, 0.78); // fists up at chest, weight back
const P_wide = samplePose(castIdx, 0.95); // arms thrown wide, chest open
const P_lunge = samplePose(castIdx, 0.45); // the deep forward drive
const P_reelA = samplePose(hitIdx, 0.2); // forward crouch, fists at the face
const P_reelB = samplePose(hitIdx, 0.6); // the crouch, turned the other way

const P_all = mergePoses(P_idle, P_guard, P_wide, P_lunge, P_reelA, P_reelB);

const ramp = (timeline, fromTime, toTime, steps, ease, fromPose, toPose) =>
  pushPoseRamp(timeline, { fromTime, toTime, steps, ease, fromPose, toPose, fallback: P_all });

// --- Balgath_Stomp: 1.30s, impact at ~0.7s ----------------------------------
// The quick cousin. With no crouch donor the weight drop comes from the Hit crouch,
// which is genuinely lower than the idle even though it is a guard.
const stomp = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(stomp, 0, 0.34, 4, easeOutCubic, P_idle, P_reelA);
ramp(stomp, 0.34, 0.55, 3, easeInOutQuad, P_reelA, P_guard);
ramp(stomp, 0.55, 0.7, 3, easeOutCubic, P_guard, P_lunge);
ramp(stomp, 0.7, 0.95, 4, easeOutCubic, P_lunge, P_reelA);
ramp(stomp, 0.95, 1.3, 4, easeInOutQuad, P_reelA, P_idle);

// --- Balgath_Blinded: 2.20s, loops ------------------------------------------
// This rig's best clip, because the Hit donor IS a hands-at-the-face crouch: exactly
// what a blinded giant does. Returns to the opening pose so the loop cannot pop.
const blinded = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(blinded, 0, 0.35, 4, easeOutCubic, P_idle, P_reelA);
ramp(blinded, 0.35, 0.8, 4, easeInOutQuad, P_reelA, P_reelB);
ramp(blinded, 0.8, 1.15, 4, easeInOutQuad, P_reelB, P_guard); // claws at the eye
ramp(blinded, 1.15, 1.6, 4, easeInOutQuad, P_guard, P_reelA);
ramp(blinded, 1.6, 2.2, 5, easeInOutQuad, P_reelA, P_idle);

const CLIPS = [
  ['Balgath_Stomp', stomp],
  ['Balgath_Blinded', blinded],
];

const authored = [];
for (const [clipName, timeline] of CLIPS) {
  const { animation } = bakeClip(doc, { clipName, channelKeys: allKeys, timeline, donorFor });
  authored.push(animation);
}

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log('preview (mesh + rig + every clip):', PREVIEW_OUT);
}

// Production: the authored clips ONLY, mesh-free, so this composes over
// balgath_cyclops.glb through VisualDef.animUrls without shadowing its own clips.
// stripToAnimationsOnly takes the animations to KEEP and is synchronous; calling it
// bare drops every clip and writes a silently empty donor.
stripToAnimationsOnly(doc, authored);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
if (kept.length !== CLIPS.length) {
  throw new Error(`expected ${CLIPS.length} clips, wrote ${kept.length}: ${kept.join(', ')}`);
}
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
