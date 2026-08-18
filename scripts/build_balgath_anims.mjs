// Balgath, the Buried Foreman: the Mirefen world boss's bespoke clip set.
//
// Authored by POSE-SAMPLE-AND-BLEND off the poses already baked into his own rig
// (`scripts/anim/pose_blend.mjs`, the technique `build_elemental_anims.mjs` and
// `build_mage_ability_anims.mjs` established). No Blender, and deliberately so: an
// earlier cut of these clips hand-keyed Euler rotations onto the Tripo skeleton in
// Blender and the arms never came up, because "raise the arm" is a different local
// axis on every rig and this one is not mixamo's. Sampling the rig's OWN clips sidesteps
// the whole problem: every donor pose is already correct in Balgath's bone space, so a
// blend between two of them cannot be axis-wrong. (`scripts/anim/blender_bake_balgath.py`
// remains as the escalation path for a pose no donor can reach.)
//
// The eight donors the creature lane retargeted onto him, and what each is good for:
//   Idle    neutral standing bookend
//   Cast    both arms raised overhead        <- the windup every slam needs
//   Attack  a committed downward swing       <- the impact frame
//   Jump    crouch and extend                <- leg drive for the stomp
//   Hit     a struck recoil                  <- the blinded reel
//   Death   a collapse to the ground         <- played BACKWARD, it is a rise
//   Walk / Run                                (locomotion, left alone)
//
// Clips authored here, and why each exists mechanically:
//   Balgath_Smash    the telegraphed circle-smash payoff. Long windup so the ground ring
//                    reads BEFORE it lands, a held beat at the top, then a fast drive down.
//   Balgath_Stomp    the shockwave stomp: shorter, legs-first, no overhead hold.
//   Balgath_EyeFlare the scrying channel under the bigCast bar. Holds the raised pose
//                    almost flat through the middle so any cast length looks intentional.
//   Balgath_Blinded  the fight's whole low-level counterplay made visible: he reels and
//                    claws, off the axis he normally tracks on. Loops, so it can hold for
//                    as long as the blind lasts.
//   Balgath_Roar     the enrage flourish.
//   Balgath_Wake     his rise out of the barrow at the scheduled spawn: held folded low,
//                    then levered upright with both arms thrown up at full height.
//
// Usage: node scripts/build_balgath_anims.mjs [--preview]
// Output: public/models/creatures/balgath_ability_anims.glb (mesh-free, 6 clips)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/balgath_foreman.glb');
const OUT = resolve(ROOT, 'public/models/creatures/balgath_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/balgath_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const castIdx = indexClip(root, 'Cast');
const attackIdx = indexClip(root, 'Attack');
const jumpIdx = indexClip(root, 'Jump');
const hitIdx = indexClip(root, 'Hit');
const deathIdx = indexClip(root, 'Death');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...castIdx.keys(),
  ...attackIdx.keys(),
  ...jumpIdx.keys(),
  ...hitIdx.keys(),
  ...deathIdx.keys(),
]);
// Donor preference for a channel a timeline never names: the swing rig first, since
// most of these clips are swings.
const donorFor = (key) =>
  attackIdx.get(key) ??
  castIdx.get(key) ??
  jumpIdx.get(key) ??
  hitIdx.get(key) ??
  deathIdx.get(key) ??
  idleIdx.get(key);

// --- donor poses -------------------------------------------------------------
const P_idle = samplePose(idleIdx, 0.2);
const P_raise = samplePose(castIdx, 0.42); // arms up, mid-raise
const P_top = samplePose(castIdx, 0.62); // the highest point of the cast
const P_swing = samplePose(attackIdx, 0.38); // committed downswing
const P_impact = samplePose(attackIdx, 0.55); // the landed frame
const P_recover = samplePose(attackIdx, 0.82); // follow-through settle
const P_crouch = samplePose(jumpIdx, 0.18); // legs loaded
const P_extend = samplePose(jumpIdx, 0.46); // legs driven out
const P_reelA = samplePose(hitIdx, 0.28); // struck, reeling one way
const P_reelB = samplePose(hitIdx, 0.62); // the recoil the other way

// Every donor merged once, so a channel that only SOME donors animate still has a
// value at every blend step instead of null-ing out (pose_blend.mjs mergePoses).
const P_all = mergePoses(
  P_idle,
  P_raise,
  P_top,
  P_swing,
  P_impact,
  P_recover,
  P_crouch,
  P_extend,
  P_reelA,
  P_reelB,
);

const ramp = (timeline, fromTime, toTime, steps, ease, fromPose, toPose) =>
  pushPoseRamp(timeline, { fromTime, toTime, steps, ease, fromPose, toPose, fallback: P_all });

// --- Balgath_Smash: 1.75s, impact at ~0.95s ---------------------------------
// The long slow lift is the mechanic: the telegraph ring is drawn at cast start and
// players need every frame of it. The 0.15s hold at the top is the "now" beat.
const smash = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(smash, 0, 0.5, 6, easeInOutQuad, P_idle, P_raise);
ramp(smash, 0.5, 0.8, 4, easeOutCubic, P_raise, P_top);
smash.push([0.95, (k) => poseValue(P_top, k, P_all)]); // held beat at full height
ramp(smash, 0.95, 1.08, 3, easeOutCubic, P_top, P_swing); // drive down, fast
ramp(smash, 1.08, 1.18, 2, easeOutCubic, P_swing, P_impact);
ramp(smash, 1.18, 1.42, 4, easeOutCubic, P_impact, P_recover);
ramp(smash, 1.42, 1.75, 5, easeInOutQuad, P_recover, P_idle);

// --- Balgath_Stomp: 1.30s, impact at ~0.7s ----------------------------------
// Legs first, no overhead: it is the quicker cousin, and reads differently at a glance
// so a raid can tell which mechanic is coming from the silhouette alone.
const stomp = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(stomp, 0, 0.34, 4, easeOutCubic, P_idle, P_crouch);
ramp(stomp, 0.34, 0.55, 3, easeInOutQuad, P_crouch, P_extend);
ramp(stomp, 0.55, 0.7, 3, easeOutCubic, P_extend, P_impact);
ramp(stomp, 0.7, 0.95, 4, easeOutCubic, P_impact, P_recover);
ramp(stomp, 0.95, 1.3, 4, easeInOutQuad, P_recover, P_idle);

// --- Balgath_EyeFlare: 2.60s, loops -----------------------------------------
// Rise into the raised pose, then hold it nearly still (a slow breath between two
// near-identical samples) so a long channel never looks like a stuck frame, then settle.
const eyeFlare = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(eyeFlare, 0, 0.55, 5, easeOutCubic, P_idle, P_raise);
ramp(eyeFlare, 0.55, 1.3, 4, easeInOutQuad, P_raise, P_top);
ramp(eyeFlare, 1.3, 2.05, 4, easeInOutQuad, P_top, P_raise);
ramp(eyeFlare, 2.05, 2.6, 5, easeInOutQuad, P_raise, P_idle);

// --- Balgath_Blinded: 2.20s, loops ------------------------------------------
// Reel one way, the other, and claw at the eye. Returns to the opening pose on the
// last key so the loop point cannot pop while the blind holds.
const blinded = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(blinded, 0, 0.35, 4, easeOutCubic, P_idle, P_reelA);
ramp(blinded, 0.35, 0.8, 4, easeInOutQuad, P_reelA, P_reelB);
ramp(blinded, 0.8, 1.15, 4, easeInOutQuad, P_reelB, P_raise); // hand up to the eye
ramp(blinded, 1.15, 1.6, 4, easeInOutQuad, P_raise, P_reelA);
ramp(blinded, 1.6, 2.2, 5, easeInOutQuad, P_reelA, P_idle);

// --- Balgath_Roar: 1.60s ----------------------------------------------------
// A short coil, then everything thrown open and held. The enrage bark rides this.
const roar = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(roar, 0, 0.28, 3, easeOutCubic, P_idle, P_crouch);
ramp(roar, 0.28, 0.55, 3, easeOutCubic, P_crouch, P_top);
roar.push([0.95, (k) => poseValue(P_top, k, P_all)]); // held, chest open
ramp(roar, 0.95, 1.6, 6, easeInOutQuad, P_top, P_idle);

// --- Balgath_Wake: 3.40s ----------------------------------------------------
// He levers himself up out of the barrow: held low and folded, then a slow push to
// standing, then both arms thrown up as he takes his full height.
//
// This was first built by sampling the Death collapse in REVERSE, which is elegant in
// principle and did not work in practice: on this rig the collapse lives mostly in ROOT
// TRANSLATION rather than in bone pose, so the reversed samples all read as a standing
// figure shuffling. The crouch donor carries its low pose in the bones themselves, so it
// survives the blend. Verified by render, not by reasoning.
const wake = [[0, (k) => poseValue(P_crouch, k, P_all)]];
wake.push([0.55, (k) => poseValue(P_crouch, k, P_all)]); // a beat still folded in the mound
ramp(wake, 0.55, 1.5, 6, easeInOutQuad, P_crouch, P_extend);
ramp(wake, 1.5, 2.3, 5, easeOutCubic, P_extend, P_raise);
ramp(wake, 2.3, 2.9, 4, easeOutCubic, P_raise, P_top); // arms thrown up at full height
ramp(wake, 2.9, 3.4, 4, easeInOutQuad, P_top, P_idle);

const CLIPS = [
  ['Balgath_Smash', smash],
  ['Balgath_Stomp', stomp],
  ['Balgath_EyeFlare', eyeFlare],
  ['Balgath_Blinded', blinded],
  ['Balgath_Roar', roar],
  ['Balgath_Wake', wake],
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
// balgath_foreman.glb through VisualDef.animUrls without shadowing its own clips.
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
