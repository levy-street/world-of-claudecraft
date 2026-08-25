// Balgath, the Mirefen world boss: his bespoke clip set.
//
// Sampled from `balgath_clip_donor.glb`, a mesh-free rig carrying the eight clips the
// Tripo creature lane retargeted onto the FOREMAN candidate. That body lost the design
// bake-off to the cyclops and its mesh is gone, but its retargeted poses are what these
// clips were authored from and the two rigs share all 41 joint names, so the donor was
// stripped to bones-and-clips (1.6 MB to 438 KB) rather than deleted: without it these
// six clips would be unreproducible.
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
//   Balgath_Sleep    the night (mob/slumber.ts). He folds down into a mound of granite
//                    beside the fallen star and BREATHES: a slow loop whose last key is its
//                    first, so it can hold from dusk to dawn without a pop at the wrap. From
//                    a distance it has to read as a boulder, so it is the lowest, most
//                    compact silhouette the donor set can reach, sunk into the ground.
//   Balgath_Wake     the dawn one-shot on the asleep-to-awake edge (the same rise the
//                    scheduled spawn always meant). Its first key IS the sleep loop's first
//                    key, so the edge is seamless: a beat still in the mound, then a slow
//                    heavy lever up to standing with both arms thrown up at full height.
//   Balgath_Swipe    the ORDINARY auto-attack. Small and quick on purpose, so the two
//                    telegraphed slams stay rare and therefore stay meaningful.
//   Balgath_Barrowsweep  the backhand he throws at whatever is chasing him WHILE HE RUNS
//                    (mob/warpath.ts travel phase). Its lower body is sampled straight off
//                    the Run cycle, which is the whole trick: the renderer plays an attack
//                    as a full-body one-shot, so an ordinary swing clip would freeze his
//                    legs mid-stride while the sim slid him forward at 6.25 u/s. That skate
//                    is exactly the artifact this pass exists to remove, so the sweep keeps
//                    running underneath and only the spine and arms leave the run.
//   Balgath_Hammer   the whack-a-mole fist: ONE arm up, held while the ring burns down,
//                    then driven into the ground.
//   Balgath_Cleave   the low arc across his front, the fight's one jump check.
//
//   THOSE TWO ARE NOT POSE-BLENDED. They are keyframed in Blender against this same rig
//   (scripts/anim/blender_author_balgath_slams.py, samples committed to
//   scripts/anim_data/balgath_slam_clips.json) and this file only bakes the samples. They
//   escalated because the technique's own test is met: the retargeted donor set carries no
//   horizontal swing and no one-armed gesture at all, so neither silhouette exists to be
//   sampled. The pose-blend versions they replace masked half the body out of a two-armed
//   overhead chop, which is why the hammer read as a crouch and the sweep as a scoop.
//   Balgath_Barrowfall  the arrival slam that ends a chase: he plants over the landmark,
//                    takes his full height with both fists overhead, holds, and drives them
//                    down. Bigger and slower than the circle-smash on purpose, and its
//                    impact frame is authored to land ON the telegraph fuse.
//
// Usage: node scripts/build_balgath_anims.mjs [--preview]
// Output: public/models/creatures/balgath_ability_anims.glb (mesh-free, 12 clips)
import { readFileSync } from 'node:fs';
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
  mergePoses,
  poseValue,
  pushPoseRamp,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'public/models/creatures/balgath_clip_donor.glb');
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
// The locomotion cycle, sampled as a MOVING donor rather than as a fixed pose: it is what
// keeps Barrowsweep's legs striding under the swing.
const runIdx = indexClip(root, 'Run');
const RUN_CYCLE = 1.292; // one full Run cycle, so the sweep's legs start and end in step

const allKeys = new Set([
  ...idleIdx.keys(),
  ...castIdx.keys(),
  ...attackIdx.keys(),
  ...jumpIdx.keys(),
  ...hitIdx.keys(),
  ...deathIdx.keys(),
  ...runIdx.keys(),
]);
// Donor preference for a channel a timeline never names: the swing rig first, since
// most of these clips are swings.
const donorFor = (key) =>
  attackIdx.get(key) ??
  castIdx.get(key) ??
  jumpIdx.get(key) ??
  hitIdx.get(key) ??
  deathIdx.get(key) ??
  runIdx.get(key) ??
  idleIdx.get(key);

// --- donor poses -------------------------------------------------------------
// The sample times here are ABSOLUTE SECONDS into each donor, and getting that wrong is
// the single biggest quality trap in this file. An earlier cut read them as fractions and
// sampled every donor inside its first half second: Attack at 0.38 of a 6.63s clip, Cast
// at 0.62 of 5.42s. Both windows are pre-roll, so every "overhead raise" and every
// "landed slam" in the shipped set was really a near-neutral standing pose with the arms
// slightly out, and all seven clips came out reading as the same small gesture. It looked
// deliberate and was not.
//
// These times come from tmp/donor_scan.mjs, which runs forward kinematics over the donor
// rig and reports hand height as a fraction of hip-to-head (so >1 is genuinely overhead)
// plus forward reach, at 40 samples per clip. The numbers in the comments are that
// readout. Re-derive them the same way if a donor is ever rebaked; do not guess.
//
// None of these donors animate Root or Pelvis translation at all (verified channel by
// channel), so a blend between any two of them is pure bone rotation and cannot slide the
// body: that is what makes sampling from deep inside a clip safe here. The sleep pose is
// the one deliberate exception, and it is authored rather than sampled: `sunk` below
// writes the Hip translation on purpose, straight down, to put his soles in the ground.
const P_idle = samplePose(idleIdx, 0.2); // neutral standing bookend
const P_raise = samplePose(attackIdx, 1.66); // arms coming up, hands at 0.87
const P_top = samplePose(attackIdx, 1.99); // BOTH fists overhead: R 1.08, L 1.62
const P_swing = samplePose(attackIdx, 2.18); // committed, driving down through the body
const P_impact = samplePose(attackIdx, 2.32); // landed: hands BELOW the hip (-0.45), reach 1.97
const P_recover = samplePose(attackIdx, 2.75); // still down in it, weight forward
const P_settle = samplePose(attackIdx, 3.31); // straightening back up
const P_crouch = samplePose(jumpIdx, 0.45); // legs loaded, hands lowest of the jump
const P_extend = samplePose(jumpIdx, 1.24); // legs driven out, both hands up
const P_reelA = samplePose(hitIdx, 0.4); // struck, head thrown back
const P_reelB = samplePose(hitIdx, 0.83); // the recoil the other way
const P_scry = samplePose(castIdx, 3.9); // the cast's own highest hold, for the eye
const P_scryLow = samplePose(castIdx, 2.3); // its lower hold, so the channel can breathe

// Every donor merged once, so a channel that only SOME donors animate still has a
// value at every blend step instead of null-ing out (pose_blend.mjs mergePoses).
const P_all = mergePoses(
  P_idle,
  P_raise,
  P_top,
  P_swing,
  P_impact,
  P_recover,
  P_settle,
  P_crouch,
  P_extend,
  P_reelA,
  P_reelB,
  P_scry,
  P_scryLow,
);

const ramp = (timeline, fromTime, toTime, steps, ease, fromPose, toPose) =>
  pushPoseRamp(timeline, { fromTime, toTime, steps, ease, fromPose, toPose, fallback: P_all });

/**
 * Which channels are legs-and-root rather than spine-and-arms.
 *
 * Used twice, for opposite reasons: to keep the run cycle under an authored swing
 * (Barrowsweep), and to keep the legs PLANTED under a small one (the auto-attack). Both
 * exist because every donor on this rig folds the whole body into its gesture, so a
 * fraction of a slam is a crouch unless the lower half is held out of it.
 */
const LOWER_BODY = /^(Root|Hip|Pelvis|[LR]_(Thigh|Calf|Foot|ToeBase|ThighTwist\d+|CalfTwist\d+))\|/;

/**
 * A pose PART of the way from one donor to another, baked into a pose of its own.
 *
 * The donor slam poses are now sampled from where the real motion is, which makes them
 * enormous: P_impact has both fists below the hip and thrown two body-lengths forward.
 * That is exactly right for the telegraphed slams and far too much for an ordinary
 * auto-attack, so the small swing is authored as a fraction of the big one rather than as
 * a different gesture. One donor vocabulary, two weights, and the difference between them
 * is a number a reviewer can change.
 */
const partial = (from, to, amount, upperOnly = false) => {
  const out = new Map();
  for (const key of allKeys) {
    const a = poseValue(from, key, P_all);
    const b = poseValue(to, key, P_all);
    if (!a || !b) continue;
    out.set(key, upperOnly && LOWER_BODY.test(key) ? a : blendValue(key, a, b, amount));
  }
  return out;
};

// The auto-attack, as a fraction of the slam and from the waist UP. Taken full-body it
// came out as a crouch rather than a swing, because the donor folds the legs into the
// gesture too; held to the upper half he stays planted and throws an arm, which is what
// an ordinary swing from a giant is.
const P_jab = partial(P_idle, P_swing, 0.7, true);
const P_jabHit = partial(P_idle, P_impact, 0.55, true);

/** The arm chains, for a blend that weights them apart from the body (the sleep fold). */
const ARMS = /^[LR]_(Clavicle|Upperarm|Forearm|Hand|UpperarmTwist\d+|ForearmTwist\d+)\|/;

/**
 * A full-body blend with the ARMS on their own weight.
 *
 * `partial` cannot author the sleep pose, and the reason is worth keeping: on this rig
 * the forward fold of the slam donors lives in the HIP rotation, not the spine, so an
 * upper-body-only blend toward P_impact leaves him standing with a bowed head (rendered:
 * 97% of idle height, a brooding stance, not a mound). The body has to take the fold whole.
 * But at the body's weight the arms are the slam's arms, both fists thrown two body-lengths
 * forward, and that reads as a giant mid-slam rather than one asleep. Half that weight and
 * the fists knuckle down beside the head instead, which is the resting shape.
 */
const fold = (from, to, body, arms) => {
  const out = new Map();
  for (const key of allKeys) {
    const a = poseValue(from, key, P_all);
    const b = poseValue(to, key, P_all);
    if (!a || !b) continue;
    out.set(key, blendValue(key, a, b, ARMS.test(key) ? arms : body));
  }
  return out;
};

/**
 * The same pose, sunk straight down into the ground by `depth` (donor units).
 *
 * Every donor keeps the Hip at a fixed height and folds the legs under it, so a crouch
 * blended out of them lifts the FEET rather than lowering the body: the circle-smash's
 * impact frame hovers 0.04 above his idle sole line. Held for a whole night that hover
 * is the first thing anyone sees, so the sleep pose translates the Hip down instead.
 * Hip-local +Z is world UP here: Root's world rotation is the same quarter-turn
 * (-0.5, 0.5, 0.5, 0.5) in every donor pose, measured by forward kinematics, so the
 * offset is one component and cannot drift sideways. Sinking is fine (his soles end up
 * ankle-deep in the fen, which a mound of granite should be); hovering is not.
 */
const sunk = (pose, depth) => {
  const out = new Map(pose);
  const t = poseValue(pose, 'Hip|translation', P_all);
  out.set('Hip|translation', [t[0], t[1], t[2] - depth]);
  return out;
};

// --- Balgath_Smash: 1.75s, impact at ~0.95s ---------------------------------
// The long slow lift is the mechanic: the telegraph ring is drawn at cast start and
// players need every frame of it. The 0.15s hold at the top is the "now" beat.
const smash = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(smash, 0, 0.5, 6, easeInOutQuad, P_idle, P_raise);
ramp(smash, 0.5, 0.8, 4, easeOutCubic, P_raise, P_top);
smash.push([0.95, (k) => poseValue(P_top, k, P_all)]); // held beat at full height
ramp(smash, 0.95, 1.08, 3, easeOutCubic, P_top, P_swing); // drive down, fast
ramp(smash, 1.08, 1.18, 2, easeOutCubic, P_swing, P_impact);
ramp(smash, 1.18, 1.4, 4, easeOutCubic, P_impact, P_recover);
ramp(smash, 1.4, 1.56, 3, easeOutCubic, P_recover, P_settle); // heaving back upright
ramp(smash, 1.56, 1.75, 3, easeInOutQuad, P_settle, P_idle);

// --- Balgath_Stomp: 1.30s, impact at ~0.7s ----------------------------------
// Legs first, no overhead: it is the quicker cousin, and reads differently at a glance
// so a raid can tell which mechanic is coming from the silhouette alone.
const stomp = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(stomp, 0, 0.34, 4, easeOutCubic, P_idle, P_crouch);
ramp(stomp, 0.34, 0.55, 3, easeInOutQuad, P_crouch, P_extend);
ramp(stomp, 0.55, 0.7, 3, easeOutCubic, P_extend, P_impact);
ramp(stomp, 0.7, 0.92, 4, easeOutCubic, P_impact, P_recover);
ramp(stomp, 0.92, 1.08, 2, easeOutCubic, P_recover, P_settle);
ramp(stomp, 1.08, 1.3, 3, easeInOutQuad, P_settle, P_idle);

// --- Balgath_EyeFlare: 2.60s, loops -----------------------------------------
// Rise into the raised pose, then hold it nearly still (a slow breath between two
// near-identical samples) so a long channel never looks like a stuck frame, then settle.
const eyeFlare = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(eyeFlare, 0, 0.55, 5, easeOutCubic, P_idle, P_scryLow);
ramp(eyeFlare, 0.55, 1.3, 4, easeInOutQuad, P_scryLow, P_scry);
ramp(eyeFlare, 1.3, 2.05, 4, easeInOutQuad, P_scry, P_scryLow);
ramp(eyeFlare, 2.05, 2.6, 5, easeInOutQuad, P_scryLow, P_idle);

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
//
// The donor pose here is the HIT recoil, not the slam wind-up, and the swap was made off a
// render: P_top has both fists overhead but the spine already pitched forward into the
// swing, so a roar built on it folded him downward and read as flinching. The struck
// recoil is the only donor on this rig that throws the head back and opens the chest,
// which is the shape a bellow actually has.
const roar = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(roar, 0, 0.28, 3, easeOutCubic, P_idle, P_crouch); // coil
ramp(roar, 0.28, 0.55, 3, easeOutCubic, P_crouch, P_reelA); // head back, chest open
roar.push([1.0, (k) => poseValue(P_reelA, k, P_all)]); // held: the bark rides this
ramp(roar, 1.0, 1.6, 6, easeInOutQuad, P_reelA, P_idle);

// --- Balgath_Swipe: 0.85s ---------------------------------------------------
// His ORDINARY melee swing, and the reason the two big slams are not in the generic
// attack array: a boss whose every auto-attack plays the telegraphed circle-smash
// animation teaches players to ignore the telegraph, because they see it constantly and
// it usually means nothing. This is short, flat and unmistakably smaller: a backhand off
// the same swing donor, no windup ceremony, no held beat at the top.
const swipe = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(swipe, 0, 0.18, 3, easeOutCubic, P_idle, P_jab);
ramp(swipe, 0.18, 0.32, 2, easeOutCubic, P_jab, P_jabHit);
ramp(swipe, 0.32, 0.55, 3, easeOutCubic, P_jabHit, P_jab);
ramp(swipe, 0.55, 0.85, 4, easeInOutQuad, P_jab, P_idle);

// --- Balgath_Sleep: 3.80s, loops --------------------------------------------
// The night. He is folded down into a mound beside the fallen star, and from across the
// fen he should be mistakable for a boulder, so this is the lowest shape the donors reach.
//
// The Death donor is no help, and not for the reason the old Wake comment gave: sampled
// by forward kinematics, its Hip never leaves y=0 and its head never drops below 0.26 of
// the 0.28 standing height at ANY time in its 8.5s. The retarget simply did not carry the
// collapse, in translation or in bone. The fold this rig CAN do is the slam's landing
// (P_impact: head at 0.10, both fists below the hip), so the mound is the loaded crouch
// folded most of the way into that, arms at half weight (see `fold`), then sunk 0.08 so
// the soles sit in the ground instead of above it. Rendered from the hero, side, front
// and a 14-height distance: a rounded lump with the face down at the front, fists
// knuckled on the ground either side of it, 69% of his idle height.
//
// Then he breathes. The inhale is the fold eased a little way back toward the upright
// crouch from the waist up (legs and the sunk Hip held, so nothing under him shifts):
// about 3% of the silhouette's height, enough to read as a heave from raid distance on
// a 13-yard body and not enough to look like a nod. Two eased halves, and the LAST row
// is the first row's exact valueFor rather than the ramp's end, so the loop point cannot
// pop even by a float.
const P_sleep = sunk(fold(P_crouch, P_impact, 0.85, 0.5), 0.08);
const P_sleepIn = partial(P_sleep, P_crouch, 0.15, true);
const SLEEP_LOOP = 3.8;
const sleepRow = [0, (k) => poseValue(P_sleep, k, P_all)];
const sleep = [sleepRow];
ramp(sleep, 0, SLEEP_LOOP / 2, 6, easeInOutQuad, P_sleep, P_sleepIn); // inhale
ramp(sleep, SLEEP_LOOP / 2, SLEEP_LOOP, 6, easeInOutQuad, P_sleepIn, P_sleep); // exhale
sleep[sleep.length - 1] = [SLEEP_LOOP, sleepRow[1]]; // loop-safe: identical to key 0

// --- Balgath_Wake: 3.95s ----------------------------------------------------
// Dawn. He levers himself up out of the mound: a beat still asleep, then the rise from
// the fold to the loaded crouch (the Hip un-sinking as the spine comes up), the legs
// driving out, and both arms thrown up as he takes his full height.
//
// Its first row is the SAME valueFor as the sleep loop's first row, which is what makes
// the asleep-to-awake edge seamless: the renderer swaps clips on that edge and the pose
// it lands on is the pose it left. The old cut began from the bare P_crouch, which
// rendered as a giant already standing with his hands slightly forward (105% of idle
// height), so "held folded low" was never what it showed. The real fold is above.
//
// The rise is in TWO heaves, because one eased ramp read as a spring: the fold's top is
// his back at 69% of idle height and the crouch's is his head at 105%, so a single ramp
// had the silhouette at 98% before its midpoint (rendered at 1.1s). Pushing partway,
// settling for a beat under the weight, then finishing is what a heavy thing does.
const P_halfUp = partial(P_sleep, P_crouch, 0.45);
const wake = [[0, sleepRow[1]]];
wake.push([0.5, sleepRow[1]]); // a beat still in the mound
ramp(wake, 0.5, 1.3, 5, easeOutCubic, P_sleep, P_halfUp); // first heave, dying off
wake.push([1.55, (k) => poseValue(P_halfUp, k, P_all)]); // the weight settles
ramp(wake, 1.55, 2.2, 5, easeInOutQuad, P_halfUp, P_crouch); // second heave, to the crouch
ramp(wake, 2.2, 2.7, 4, easeInOutQuad, P_crouch, P_extend);
ramp(wake, 2.7, 3.15, 4, easeOutCubic, P_extend, P_raise);
ramp(wake, 3.15, 3.55, 4, easeOutCubic, P_raise, P_top); // arms thrown up at full height
ramp(wake, 3.55, 3.95, 4, easeInOutQuad, P_top, P_idle);

// --- Balgath_Barrowsweep: 1.292s authored, one full Run cycle ---------------
// The backhand he throws at whoever is chasing him, WITHOUT stopping.
//
// The renderer plays every attack as a full-body one-shot (visual.ts playOneShot), so a
// normal swing clip on a running boss replaces his stride with a planted swing for its
// whole length while the sim keeps translating him at travel speed. That is a foot skate,
// and it is the precise complaint this pass was opened on. The fix is to author the run
// INTO the clip: every lower-body channel is sampled off the live Run cycle at the same
// timeline position, so his legs never stop, and only the waist, spine, arms and head
// leave the cycle to throw the swing.
//
// Two numbers make that composite honest. The clip is exactly one Run cycle long, so the
// legs are in the same phase at both ends and the crossfade back into locomotion has
// nothing to correct. And it is WIRED at timeScale 0.75 (manifest.ts), which is what the
// locomotion state machine independently picks for his run at travel speed (6.25 u/s over
// the measured 8.38 runRef): the authored legs therefore advance at exactly the rate the
// run clip they were sampled from would have, and the composite cannot skate either.
/** Lower body from the running donor, upper body from an authored pose. */
const strideUnder = (runPose, upperPose) => (key) =>
  poseValue(LOWER_BODY.test(key) ? runPose : upperPose, key, P_all);

/** Blend two poses per channel, for the upper half of a stride-under step. */
const mixUpper = (a, b, t) => {
  const out = new Map();
  for (const key of allKeys) {
    const va = poseValue(a, key, P_all);
    const vb = poseValue(b, key, P_all);
    if (va && vb) out.set(key, blendValue(key, va, vb, t));
  }
  return out;
};

const sweep = [];
{
  // The strike lands EARLY (0.22 authored, ~0.29s at the wired 0.75 scale) because the
  // sim resolves this hit the instant it emits: a long anticipation would show the wind-up
  // after the damage number had already come off, which reads as two separate events.
  const beats = [
    [0, null, 0],
    [0.1, P_top, 0.9], // fists up, without ever leaving the stride
    [0.24, P_swing, 1], // the club comes down: this is the frame the damage belongs to
    [0.46, P_recover, 0.85],
    [0.85, P_settle, 0.4],
    [RUN_CYCLE, null, 0],
  ];
  const STEPS = 22;
  for (let i = 0; i <= STEPS; i++) {
    const t = (RUN_CYCLE * i) / STEPS;
    const runPose = samplePose(runIdx, t);
    // Where the upper body sits between the run cycle and the authored swing at time t.
    let target = null;
    let amount = 0;
    for (let b = 1; b < beats.length; b++) {
      if (t > beats[b][0]) continue;
      const [t0, p0, a0] = beats[b - 1];
      const [t1, p1, a1] = beats[b];
      const f = t1 === t0 ? 1 : easeOutCubic((t - t0) / (t1 - t0));
      target = p1 ?? p0;
      amount = a0 + (a1 - a0) * f;
      break;
    }
    const upper = target && amount > 0 ? mixUpper(runPose, target, amount) : runPose;
    sweep.push([t, strideUnder(runPose, upper)]);
  }
}

// --- Balgath_Barrowfall: 2.80s, impact at 1.40s -----------------------------
// The arrival slam that ends a chase, and the biggest thing he does.
//
// Impact is authored at 1.40s and the clip is wired at timeScale 1.0, so it lands on
// WARPATH_WRECK_FUSE_SEC exactly: the ring finishes burning down and his fists arrive on
// the same frame. Everything before that is anticipation the raid can read from across
// the fen (gather, rise to full height, a held beat with both arms overhead), and the
// long tail afterwards is the recovery window that makes the slam feel like it cost him
// something, which the shorter circle-smash deliberately does not.
const barrowfall = [[0, (k) => poseValue(P_idle, k, P_all)]];
ramp(barrowfall, 0, 0.3, 3, easeOutCubic, P_idle, P_crouch); // gather
ramp(barrowfall, 0.3, 0.75, 5, easeInOutQuad, P_crouch, P_raise);
ramp(barrowfall, 0.75, 1.05, 4, easeOutCubic, P_raise, P_top); // full height, fists up
barrowfall.push([1.22, (k) => poseValue(P_top, k, P_all)]); // the held beat
ramp(barrowfall, 1.22, 1.33, 2, easeOutCubic, P_top, P_swing); // drive down
ramp(barrowfall, 1.33, 1.4, 2, easeOutCubic, P_swing, P_impact); // LANDS on the fuse
ramp(barrowfall, 1.4, 1.75, 4, easeOutCubic, P_impact, P_recover);
barrowfall.push([1.95, (k) => poseValue(P_recover, k, P_all)]); // a beat down in the crater
ramp(barrowfall, 1.95, 2.35, 4, easeOutCubic, P_recover, P_settle); // heaving back upright
ramp(barrowfall, 2.35, 2.8, 4, easeInOutQuad, P_settle, P_idle);

/**
 * The two AIMED slams come from BLENDER, not from donor poses.
 *
 * `scripts/anim/blender_author_balgath_slams.py` keyframes them against this same rig and
 * writes per-frame node-local rotations to scripts/anim_data/balgath_slam_clips.json; this
 * only bakes that data into the shipped clip GLB. They escalated for the reason the
 * pipeline's technique-2 test names: the eight retargeted donor clips carry no horizontal
 * swing at all and no one-armed gesture of any kind, so a hammer and a low sweep are
 * genuinely novel silhouettes for this rig. The pose-blend versions these replace were
 * built by masking half the body out of a two-armed overhead chop, which reads as
 * "something happened" rather than as a fist coming down on you.
 *
 * Rotation only, because that is all these clips move. Leaving translation and scale
 * unauthored keeps every bone at the bind value the glTF node already carries.
 */
const slamData = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts/anim_data/balgath_slam_clips.json'), 'utf8'),
);

/** One authored clip as a bakeClip timeline over its own sampled frames. */
function blenderClip(name) {
  const clip = slamData.clips[name];
  if (!clip) throw new Error(`balgath_slam_clips.json has no clip ${name}`);
  return clip.times.map((t, i) => [
    t,
    (key) => {
      const [bone, path] = key.split('|');
      return path === 'translation' ? clip.translation?.[bone]?.[i] : clip.rotation[bone]?.[i];
    },
  ]);
}

/**
 * The channels the authored data carries: rotation for every bone, plus translation for
 * the few the idle base displaces.
 *
 * That translation is not optional decoration. This rig's idle is a deep knuckle-down
 * crouch carried almost entirely by the Hip's OFFSET, so a rotation-only bake plays the
 * whole clip standing bolt upright: right angles, wrong body.
 */
const slamKeysFor = (name) => [
  ...slamData.bones.map((b) => `${b}|rotation`),
  ...Object.keys(slamData.clips[name].translation ?? {}).map((b) => `${b}|translation`),
];

const hammer = blenderClip('Balgath_Hammer');
const cleave = blenderClip('Balgath_Cleave');

const CLIPS = [
  ['Balgath_Smash', smash],
  ['Balgath_Stomp', stomp],
  ['Balgath_EyeFlare', eyeFlare],
  ['Balgath_Blinded', blinded],
  ['Balgath_Roar', roar],
  ['Balgath_Sleep', sleep],
  ['Balgath_Wake', wake],
  ['Balgath_Swipe', swipe],
  ['Balgath_Barrowsweep', sweep],
  ['Balgath_Barrowfall', barrowfall],
  // The Blender-authored pair carries its OWN channel list: it drives rotation only, so
  // handing it the full pose-blend key union would ask bakeClip for translation and scale
  // tracks the authored data does not have.
  ['Balgath_Hammer', hammer, slamKeysFor('Balgath_Hammer')],
  ['Balgath_Cleave', cleave, slamKeysFor('Balgath_Cleave')],
];

const authored = [];
for (const [clipName, timeline, keys] of CLIPS) {
  const { animation } = bakeClip(doc, {
    clipName,
    channelKeys: keys ?? allKeys,
    timeline,
    donorFor,
  });
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
