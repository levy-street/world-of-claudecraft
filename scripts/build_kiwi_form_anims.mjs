// Build the druid Kiwi Form's two authored clips. The form's body came off the
// asset pipeline with generic Tripo biped preset retargets, and two of them do
// not survive contact with a bird:
//
//   Attack was `preset:biped:slash`, a 6.6-second ARM swing on a body with no
//   arms to swing, which only read as an attack because the VisualDef played it
//   at 6.6x.
//   Death was `preset:biped:defeat_02`, which on this rig never falls at all:
//   across the whole 8.5s clip the hand spread stays at its idle 0.401 and the
//   head stays at y 0.30-0.35, i.e. the kiwi stands there and waits.
//
// Both are authored here off poses already baked into kiwi_form.glb, the
// pose-sample-and-blend technique in scripts/anim/pose_blend.mjs (no Blender,
// same as build_bow_anims.mjs / build_elemental_anims.mjs). Kiwi_Death also
// authors an explicit rigid rotation at the root, the bespoke-valueFor case the
// module documents: no shipped clip on this rig contains a lying-down pose to
// sample, so the topple is computed rather than borrowed.
//
//   Kiwi_Peck: cock back, drive the head FORWARD into the target at its own
//   height, hold, recover. Committing the whole body to the shipped lunge pecks
//   the FLOOR: measured, it buys 0.278 of reach for 0.183 of drop and leaves the
//   bill 77 degrees nose down. Here the spine carries the head, the rest of the
//   body leans only part way in, and the neck is then re-aimed so the bill
//   finishes where a target actually is.
//
//   Kiwi_Death: teeter forward, then topple over backwards in one rigid piece
//   and land flat on its back, 2 seconds from upright to horizontal. The body
//   pivots about the root, which sits at ground level between the feet, so the
//   silhouette goes from a standing "l" to a flat "_" without a ragdoll.
//
// Usage: node scripts/build_kiwi_form_anims.mjs [--preview]
// Output: public/models/creatures/kiwi_form_anims.glb (0 meshes/skins, 2 clips)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  createGlbIO,
  easeInOutQuad,
  easeOutCubic,
  indexClip,
  lerpV,
  mergePoses,
  poseValue,
  pushPoseRamp,
  samplePose,
  slerpQ,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'public/models/creatures/kiwi_form.glb');
const OUT = resolve(ROOT, 'public/models/creatures/kiwi_form_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/kiwi_form_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const hitIdx = indexClip(root, 'Hit');
const attackIdx = indexClip(root, 'Attack');

const allKeys = new Set([...idleIdx.keys(), ...hitIdx.keys(), ...attackIdx.keys()]);
const donorFor = (key) => attackIdx.get(key) ?? hitIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled inside each clip's real duration (Idle 15.375s, Hit
// 1.333s, Attack 6.625s). The timestamps were measured, not guessed: walking the
// Head bone's world position across every shipped clip, Attack t=2.208 puts the
// head furthest forward of any frame the rig owns and Hit t=0.139 puts it
// furthest back.
const P_stand = samplePose(idleIdx, 4.484);
const P_cock = samplePose(hitIdx, 0.139);
const P_lunge = samplePose(attackIdx, 2.208);
const P_rise = samplePose(attackIdx, 5.797);

// The chain that carries the head forward, split so the strike can be aimed.
// Driving the whole body into the shipped lunge pecks the FLOOR: measured, it
// buys 0.278 of reach for 0.183 of drop and leaves the bill 77 degrees nose
// down. The spine does the carrying, the body leans only part way, and the neck
// is then corrected so the bill finishes level.
const NECK = ['NeckTwist01', 'NeckTwist02', 'Head'];
const SPINE = ['Waist', 'Spine01', 'Spine02'];
const NECK_COMMIT = 0.35;
const SPINE_COMMIT = 1;
const BODY_COMMIT = 0.3;
// A kiwi carries its bill a few degrees nose down at rest; the strike aims
// there rather than at dead level, so the peck still reads as a downward jab
// into a target instead of a level sword thrust.
const AIM_PITCH_DEG = -6;

const parentOf = new Map();
for (const node of root.listNodes()) {
  for (const child of node.listChildren()) parentOf.set(child.getName(), node.getName());
}
const restRotation = new Map(root.listNodes().map((n) => [n.getName(), n.getRotation()]));

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
const AXIS_X = [1, 0, 0];
const AXIS_Y = [0, 1, 0];
const AXIS_Z = [0, 0, 1];
const qAbout = (axis, angle) => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};

/** World-space orientation of a bone under the given pose (rotation only: the
 *  bill angle does not depend on any bone offset). */
function worldQuat(pose, bone) {
  let q = [0, 0, 0, 1];
  const stack = [];
  for (let b = bone; b; b = parentOf.get(b)) stack.unshift(b);
  for (const b of stack) q = qMul(q, pose.get(b + '|rotation') ?? restRotation.get(b));
  return q;
}

/** Pitch of the bill in degrees, positive nose up. The bill runs along the head
 *  bone's local MINUS Z: at rest that axis points along world +X, which is the
 *  direction the model faces (the head bone's local +Z points out the back of
 *  the skull, and aiming with that sign drives the bill into the chest). The
 *  check that this is the right axis is the rest pose, which comes out at the
 *  few degrees nose down a kiwi actually carries. */
function billPitchDeg(pose) {
  const [x, y, z, w] = worldQuat(pose, 'Head');
  // -(q applied to (0, 0, 1))
  const vx = -2 * (x * z + w * y);
  const vy = -2 * (y * z - w * x);
  const vz = -(1 - 2 * (x * x + y * y));
  const len = Math.hypot(vx, vy, vz) || 1;
  return (Math.asin(vy / len) * 180) / Math.PI;
}

/** Give `bone` an extra rotation of `angle` about a WORLD axis, leaving its
 *  parents where they are. Bone-local axes are permuted differently per limb on
 *  this rig, so world axes are the only frame in which "swing the wing outward"
 *  stays one readable number. Children inherit it, so a chain is applied top
 *  down and the amounts accumulate down the limb. */
function worldRotate(pose, bone, axis, angle) {
  const parent = worldQuat(pose, parentOf.get(bone));
  const local = pose.get(bone + '|rotation') ?? restRotation.get(bone);
  pose.set(bone + '|rotation', qMul(qMul(qConj(parent), qMul(qAbout(axis, angle), parent)), local));
}

/** Rotate the neck chain until the bill sits at `targetDeg`. Composing world
 *  rotations onto a chain is not linear, so this converges rather than solving
 *  in one step; a few passes land well inside a tenth of a degree. */
function aimBill(pose, targetDeg) {
  for (let pass = 0; pass < 6; pass++) {
    const error = targetDeg - billPitchDeg(pose);
    if (Math.abs(error) < 0.05) break;
    const share = (error * Math.PI) / 180 / NECK.length;
    for (const bone of NECK) worldRotate(pose, bone, AXIS_Z, share);
  }
  return pose;
}

/** The strike: spine carries the head forward, the body leans part way in, and
 *  the neck is then re-aimed so the bill finishes pointing where the target is
 *  rather than at the ground. */
function forwardStrike() {
  const pose = new Map(P_stand);
  for (const [key, target] of P_lunge) {
    const [bone, path] = key.split('|');
    const from = P_stand.get(key);
    if (!from) {
      pose.set(key, target);
      continue;
    }
    const amount = NECK.includes(bone)
      ? NECK_COMMIT
      : SPINE.includes(bone)
        ? SPINE_COMMIT
        : BODY_COMMIT;
    pose.set(key, path === 'rotation' ? slerpQ(from, target, amount) : lerpV(from, target, amount));
  }
  return aimBill(pose, AIM_PITCH_DEG);
}
const P_strike = forwardStrike();
console.log(
  'peck strike: bill ' +
    billPitchDeg(P_strike).toFixed(1) +
    ' deg (rest ' +
    billPitchDeg(P_stand).toFixed(1) +
    ' deg, unaimed lunge ' +
    billPitchDeg(P_lunge).toFixed(1) +
    ' deg)',
);
// Donor clips from one rig do not always animate the same channel set, so a
// single donor pose is an incomplete fallback (pose_blend.mjs mergePoses doc):
// merge every donor once so any channel any of them touches has SOME value.
const P_all = mergePoses(P_stand, P_cock, P_strike, P_rise, P_lunge);

// --- Kiwi_Peck -------------------------------------------------------------
const peck = [[0, (k) => poseValue(P_stand, k, P_all)]];
// Cock back. Slower than the strike on purpose: the windup is what makes the
// snap read as a snap.
pushPoseRamp(peck, {
  fromTime: 0,
  toTime: 0.22,
  steps: 4,
  ease: easeInOutQuad,
  fromPose: P_stand,
  toPose: P_cock,
  fallback: P_all,
});
// The peck itself: ease-OUT, so it leaves fast and arrives stopped.
pushPoseRamp(peck, {
  fromTime: 0.22,
  toTime: 0.36,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_cock,
  toPose: P_strike,
  fallback: P_all,
});
// Hold the strike a beat: a peck that rebounds instantly reads as a twitch.
peck.push([0.44, (k) => poseValue(P_strike, k, P_all)]);
pushPoseRamp(peck, {
  fromTime: 0.44,
  toTime: 0.68,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_strike,
  toPose: P_rise,
  fallback: P_all,
});
pushPoseRamp(peck, {
  fromTime: 0.68,
  toTime: 0.95,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_rise,
  toPose: P_stand,
  fallback: P_all,
});

const { animation: peckClip } = bakeClip(doc, {
  clipName: 'Kiwi_Peck',
  channelKeys: allKeys,
  timeline: peck,
  donorFor,
});

// --- Kiwi_Death ------------------------------------------------------------
// The fall is one rigid rotation about the root. Root's parent (Armature) is
// identity and Root sits at ground level, so a world-space rotation composed
// onto Root's own rest rotation tips the whole body about its feet, and Root's
// translation channel is already in world axes.
const ROOT_ROT = 'Root|rotation';
const ROOT_POS = 'Root|translation';
const restRootRot =
  P_stand.get(ROOT_ROT) ??
  root
    .listNodes()
    .find((n) => n.getName() === 'Root')
    .getRotation();
const restRootPos = P_stand.get(ROOT_POS) ?? [0, 0, 0];
// Model forward is +X and up is +Y, so a positive rotation about Z carries the
// head from up (+Y) to behind (-X): a fall onto the back, not onto the face.
const FLAT = Math.PI / 2;
// Lifted as it goes over so the body comes to rest ON the ground rather than
// half-inside it (the spine axis ends up in the ground plane otherwise).
const REST_LIFT = 0.16;

/** Root pose at fall angle `theta` (radians about world Z). */
function toppled(theta) {
  const lift = (Math.min(Math.abs(theta), FLAT) / FLAT) * REST_LIFT;
  return {
    rot: qMul(qAbout(AXIS_Z, theta), restRootRot),
    pos: [restRootPos[0], restRootPos[1] + lift, restRootPos[2]],
  };
}

// Once the body is over, the world axes read straight off the corpse: +X runs
// from head to feet, +Y is up off the ground, and +Z is the kiwi's right (every
// L_ bone sits at negative Z, every R_ bone at positive). That is what makes
// these readable as one number each, and why they are applied in WORLD space on
// top of the topple instead of as local bone tweaks.
//
// The wings and legs end up pointing along +X, the axis of the fall itself, so
// nothing about world X can move them: they splay about world Y. The knees and
// feet fold in the plane the body fell through, which is world Z. The head is
// the exception: the topple leaves the bill pointing straight up, so rolling
// about world X is exactly what drops it onto its side.
// Slightly different left and right so the corpse does not settle into a
// symmetrical mannequin.
const LIMP = [
  // Wings fall open off the chest.
  { bone: 'L_Clavicle', axis: AXIS_Y, angle: 0.2 },
  { bone: 'L_Upperarm', axis: AXIS_Y, angle: 0.62 },
  { bone: 'L_Forearm', axis: AXIS_Y, angle: 0.45 },
  { bone: 'R_Clavicle', axis: AXIS_Y, angle: -0.18 },
  { bone: 'R_Upperarm', axis: AXIS_Y, angle: -0.58 },
  { bone: 'R_Forearm', axis: AXIS_Y, angle: -0.42 },
  // Legs fall APART and flat. An earlier pass folded the knees about world Z
  // instead, which lifts the shins toward the sky: legs in the air is a funny
  // silhouette but it is a held pose, the opposite of limp. The knees keep only
  // enough bend to stop the legs reading as a plank.
  { bone: 'L_Thigh', axis: AXIS_Y, angle: 0.58 },
  { bone: 'R_Thigh', axis: AXIS_Y, angle: -0.52 },
  { bone: 'L_Calf', axis: AXIS_Y, angle: 0.26 },
  { bone: 'R_Calf', axis: AXIS_Y, angle: -0.22 },
  { bone: 'L_Calf', axis: AXIS_Z, angle: 0.12 },
  { bone: 'R_Calf', axis: AXIS_Z, angle: 0.09 },
  // Toes give up last.
  { bone: 'L_Foot', axis: AXIS_Z, angle: -0.7 },
  { bone: 'R_Foot', axis: AXIS_Z, angle: -0.62 },
  // The topple leaves the bill pointing straight up. This rolls the whole neck
  // until it drops onto its side, which is the whole reason the roll is about
  // world X rather than anything bone-local.
  { bone: 'NeckTwist01', axis: AXIS_X, angle: 0.32 },
  { bone: 'NeckTwist02', axis: AXIS_X, angle: 0.44 },
  { bone: 'Head', axis: AXIS_X, angle: 0.7 },
];

/** The whole body at fall angle `theta`, with the limbs `limp` of the way from
 *  held to slack (0 while it is still standing up on its own). */
function deathPose(theta, limp) {
  const pose = new Map(P_stand);
  const { rot, pos } = toppled(theta);
  pose.set(ROOT_ROT, rot);
  pose.set(ROOT_POS, pos);
  if (limp > 0) {
    for (const { bone, axis, angle } of LIMP) worldRotate(pose, bone, axis, angle * limp);
  }
  return pose;
}

function fallRow(time, theta, limp) {
  const pose = deathPose(theta, limp);
  return [time, (key) => poseValue(pose, key, P_all)];
}

// The limbs let go partway through the fall rather than on impact: a body that
// stays rigid until it lands and only then goes slack reads as two events, not
// one death. Eased out so the slack arrives early and then just settles.
const LIMP_FROM = 0.7;
const LIMP_TO = 1.75;
const limpAt = (time) =>
  easeOutCubic(Math.min(1, Math.max(0, (time - LIMP_FROM) / (LIMP_TO - LIMP_FROM))));
const beat = (time, theta) => fallRow(time, theta, limpAt(time));

// Beat by beat: stand, teeter FORWARD (the comic anticipation), then go over
// backwards under gravity, bounce once off the ground, settle flat. Two seconds
// end to end.
const death = [beat(0, 0), beat(0.16, -0.1), beat(0.34, -0.13)];
const TIP_FROM = 0.34;
const TIP_TO = 1.3;
for (let s = 1; s <= 12; s++) {
  const f = s / 12;
  // Gravity accelerates: ease IN, so the topple starts as a slow tilt and
  // arrives fast. easeInOutQuad would slow it back down right at the impact.
  death.push(beat(TIP_FROM + (TIP_TO - TIP_FROM) * f, -0.13 + (FLAT + 0.13) * f ** 2.1));
}
death.push(beat(1.42, FLAT - 0.1)); // the bounce off the ground
death.push(beat(1.56, FLAT + 0.012));
death.push(beat(1.72, FLAT - 0.03));
death.push(beat(2.0, FLAT));

const { animation: deathClip } = bakeClip(doc, {
  clipName: 'Kiwi_Death',
  channelKeys: allKeys,
  timeline: death,
  donorFor,
});

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + clips): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, [peckClip, deathClip]);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);
console.log(`wrote ${OUT}`);
console.log(
  `clips: ${root
    .listAnimations()
    .map((a) => a.getName())
    .join(', ')}`,
);
