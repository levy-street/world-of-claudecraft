// Build the druid Kauriki Form's two authored clips.
//
// The body comes off the asset pipeline as a Tripo biped, and two of its generic
// preset retargets do not suit a hulking flightless bird that fights with its
// whole body:
//
//   Attack was `preset:biped:slash`, an arm swing, on a brute whose whole point
//   is that it carries no weapon.
//   Death was `preset:biped:defeat_02`, which on this rig family never falls at
//   all: across the whole 8.5s the body stays upright in its idle pose, so the
//   kiwi would stand there and wait to be looted.
//
// Both are authored here with the pose-sample-and-blend toolkit in
// scripts/anim/pose_blend.mjs (no Blender, same path as build_bow_anims.mjs).
// Neither is a straight donor blend: the haka beats and the topple are composed
// as explicit WORLD-space rotations on top of the idle pose, the bespoke
// valueFor case the module documents, because no shipped preset on this rig
// contains a stance, a thigh slap, or a body lying down to sample from.
//
//   Kauriki_Haka: the attack. Drop into a wide low stance, slap the thighs
//   twice, stomp, then fling the arms wide and drive the bill forward in the
//   challenge. It reads as a posture rather than a weapon swing, which is the
//   point: this form has no weapon.
//
//   Kauriki_Death: teeter, topple onto its back over two seconds, and go limp,
//   with the bill rolling onto its side.
//
// Axis conventions, measured off this rig rather than assumed: the model faces
// world +X with up at +Y, every L_ bone sits at negative Z and every R_ bone at
// positive Z. So while the body is UPRIGHT, a limb that hangs down swings out to
// the side about world X and swings forward or back about world Z.
//
// Usage: node scripts/build_kauriki_form_anims.mjs [--preview]
// Output: public/models/creatures/kauriki_form_anims.glb (0 meshes/skins, 2 clips)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/kauriki_form.glb');
const OUT = resolve(ROOT, 'public/models/creatures/kauriki_form_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/kauriki_form_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const hitIdx = indexClip(root, 'Hit');
const attackIdx = indexClip(root, 'Attack');
const allKeys = new Set([...idleIdx.keys(), ...hitIdx.keys(), ...attackIdx.keys()]);
const donorFor = (key) => attackIdx.get(key) ?? hitIdx.get(key) ?? idleIdx.get(key);

const P_stand = samplePose(idleIdx, 1.0);
const P_all = mergePoses(P_stand, samplePose(hitIdx, 0.2), samplePose(attackIdx, 2.2));

// --- world-space pose composition ------------------------------------------
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
const X = [1, 0, 0];
const Y = [0, 1, 0];
const Z = [0, 0, 1];
const qAbout = (axis, angle) => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};

function worldQuat(pose, bone) {
  let q = [0, 0, 0, 1];
  const stack = [];
  for (let b = bone; b; b = parentOf.get(b)) stack.unshift(b);
  for (const b of stack) q = qMul(q, pose.get(b + '|rotation') ?? restRotation.get(b));
  return q;
}

/** Give `bone` an extra rotation about a WORLD axis. Children inherit it, so a
 *  chain is listed parent-first and the amounts accumulate down the limb. */
let recorder = null;

/** Rotations are recorded while a recorder is open so the SAME correction can
 *  be replayed on other frames. Solving per frame is what made the feet jitter:
 *  numerical descent from slightly different starting poses lands on slightly
 *  different answers, and frame-to-frame disagreement IS the jitter. */
function worldRotate(pose, bone, axis, angle) {
  if (recorder) recorder.push([bone, axis, angle]);
  const parent = worldQuat(pose, parentOf.get(bone));
  const local = pose.get(bone + '|rotation') ?? restRotation.get(bone);
  pose.set(bone + '|rotation', qMul(qMul(qConj(parent), qMul(qAbout(axis, angle), parent)), local));
}

/** World position of a bone under a pose (needs offsets, so full TRS). */
function worldPos(pose, bone) {
  const stack = [];
  for (let b = bone; b; b = parentOf.get(b)) stack.unshift(b);
  let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
    return o;
  };
  for (const b of stack) {
    const node = nodeByName.get(b);
    const t = pose.get(b + '|translation') ?? node.getTranslation();
    const q = pose.get(b + '|rotation') ?? node.getRotation();
    const s2 = pose.get(b + '|scale') ?? node.getScale();
    const [x, y, z, w] = q;
    const r = [
      1 - 2 * (y * y + z * z),
      2 * (x * y - z * w),
      2 * (x * z + y * w),
      0,
      2 * (x * y + z * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z - x * w),
      0,
      2 * (x * z - y * w),
      2 * (y * z + x * w),
      1 - 2 * (x * x + y * y),
      0,
      0,
      0,
      0,
      1,
    ];
    for (let c = 0; c < 3; c++) {
      r[c] *= s2[0];
      r[4 + c] *= s2[1];
      r[8 + c] *= s2[2];
    }
    r[3] = t[0];
    r[7] = t[1];
    r[11] = t[2];
    m = mul(m, r);
  }
  return [m[3], m[7], m[11]];
}

const nodeByName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const FOOT_BONES = ['L_ToeBase', 'R_ToeBase', 'L_Foot', 'R_Foot'];
const lowestFoot = (p) => Math.min(...FOOT_BONES.map((b) => worldPos(p, b)[1]));

const ROOT_POS = 'Root|translation';
const restRootPos = P_stand.get(ROOT_POS) ?? [0, 0, 0];

// --- real mesh-space foot contact ------------------------------------------
// Bone positions are a bad proxy for where the model actually touches the
// floor: the inverse bind matrices offset bone space from mesh space, and by
// different amounts per joint, so levelling the feet by bone height leaves them
// visibly off the ground anyway. Measured per foot, that was up to 0.13 of lift
// on a body 0.96 tall. This skins the foot vertices for real, which is the only
// number worth correcting against.

const skin = root.listSkins()[0];
const skinJoints = skin.listJoints().map((j) => j.getName());
const ibmArray = skin.getInverseBindMatrices().getArray();

const mesh = root.listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const POS = prim.getAttribute('POSITION').getArray();
const JOINTS = prim.getAttribute('JOINTS_0').getArray();
const WEIGHTS = prim.getAttribute('WEIGHTS_0').getArray();
const VERT_COUNT = POS.length / 3;

const mat4Mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
};

/** Column-major glTF IBM for joint `i`, as a row-major 4x4. */
function ibmOf(i) {
  const m = ibmArray.slice(i * 16, i * 16 + 16);
  return [
    m[0],
    m[4],
    m[8],
    m[12],
    m[1],
    m[5],
    m[9],
    m[13],
    m[2],
    m[6],
    m[10],
    m[14],
    m[3],
    m[7],
    m[11],
    m[15],
  ];
}
const IBMS = skinJoints.map((_, i) => ibmOf(i));

/** Full world matrix of a bone under a pose (row-major). */
function worldMat(pose, bone) {
  const stack = [];
  for (let b = bone; b; b = parentOf.get(b)) stack.unshift(b);
  let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const b of stack) {
    const node = nodeByName.get(b);
    const t = pose.get(b + '|translation') ?? node.getTranslation();
    const q = pose.get(b + '|rotation') ?? node.getRotation();
    const s = pose.get(b + '|scale') ?? node.getScale();
    const [x, y, z, w] = q;
    const r = [
      (1 - 2 * (y * y + z * z)) * s[0],
      2 * (x * y - z * w) * s[1],
      2 * (x * z + y * w) * s[2],
      t[0],
      2 * (x * y + z * w) * s[0],
      (1 - 2 * (x * x + z * z)) * s[1],
      2 * (y * z - x * w) * s[2],
      t[1],
      2 * (x * z - y * w) * s[0],
      2 * (y * z + x * w) * s[1],
      (1 - 2 * (x * x + y * y)) * s[2],
      t[2],
      0,
      0,
      0,
      1,
    ];
    m = mat4Mul(m, r);
  }
  return m;
}

/** Vertices whose dominant skin weight belongs to each foot. Grouping by the
 *  dominant joint is what makes a SINGLE foot lifting visible; a whole-model
 *  minimum cannot see it while the other foot is still down. */
function footVerticesMatching(pattern) {
  const wanted = new Set(
    skinJoints.map((n, i) => (pattern.test(n) ? i : -1)).filter((i) => i >= 0),
  );
  const out = [];
  for (let v = 0; v < VERT_COUNT; v++) {
    let best = -1;
    let bestW = 0;
    for (let c = 0; c < 4; c++) {
      const w = WEIGHTS[v * 4 + c];
      if (w > bestW) {
        bestW = w;
        best = JOINTS[v * 4 + c];
      }
    }
    if (wanted.has(best)) out.push(v);
  }
  return out;
}
const FOOT_VERTS = {
  L: footVerticesMatching(/^L_(Foot|ToeBase)$/),
  R: footVerticesMatching(/^R_(Foot|ToeBase)$/),
};

/** Lowest skinned Y of one foot under a pose: the real contact height. */
function contactOf(pose, list) {
  const cache = new Map();
  const jointMat = (ji) => {
    if (!cache.has(ji)) cache.set(ji, mat4Mul(worldMat(pose, skinJoints[ji]), IBMS[ji]));
    return cache.get(ji);
  };
  let min = Infinity;
  for (const v of list) {
    const px = POS[v * 3];
    const py = POS[v * 3 + 1];
    const pz = POS[v * 3 + 2];
    let y = 0;
    for (let c = 0; c < 4; c++) {
      const w = WEIGHTS[v * 4 + c];
      if (w === 0) continue;
      const m = jointMat(JOINTS[v * 4 + c]);
      y += w * (m[4] * px + m[5] * py + m[6] * pz + m[7]);
    }
    if (y < min) min = y;
  }
  return min;
}

const footContact = (pose, side) => contactOf(pose, FOOT_VERTS[side]);
// Every vertex, for clips where the creature is not on its feet at all.
const ALL_VERTS = Array.from({ length: VERT_COUNT }, (_, i) => i);
const bodyContact = (pose) => contactOf(pose, ALL_VERTS);

const STAND_FOOT = lowestFoot(P_stand);

// --- surface alignment ------------------------------------------------------
// Palm direction and sole flatness were both hand-tuned with guessed axes, and
// both were wrong in ways that only measurement caught: the palms ended up
// facing up rather than inward (their fitted normal was 0.8 along Y), and the
// soles sat 19 to 22 degrees off flat. Rather than guess again, these fit a
// plane to the actual skinned vertices and rotate the bone by the exact angle
// between that plane's normal and where it should point.

const HAND_VERTS = { L: footVerticesMatching(/^L_Hand$/), R: footVerticesMatching(/^R_Hand$/) };

/** Evenly spread unit directions, for the plane fit below. */
const PROBE_DIRS = (() => {
  const out = [];
  for (let i = 0; i < 240; i++) {
    const y = 1 - (i / 239) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * Math.PI * (3 - Math.sqrt(5));
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
})();

/** Skinned world positions of a vertex group under a pose. */
function skinnedPoints(pose, verts) {
  const cache = new Map();
  const jointMat = (ji) => {
    if (!cache.has(ji)) cache.set(ji, mat4Mul(worldMat(pose, skinJoints[ji]), IBMS[ji]));
    return cache.get(ji);
  };
  const out = [];
  for (const v of verts) {
    const px = POS[v * 3];
    const py = POS[v * 3 + 1];
    const pz = POS[v * 3 + 2];
    let x = 0;
    let y = 0;
    let z = 0;
    for (let c = 0; c < 4; c++) {
      const w = WEIGHTS[v * 4 + c];
      if (w === 0) continue;
      const m = jointMat(JOINTS[v * 4 + c]);
      x += w * (m[0] * px + m[1] * py + m[2] * pz + m[3]);
      y += w * (m[4] * px + m[5] * py + m[6] * pz + m[7]);
      z += w * (m[8] * px + m[9] * py + m[10] * pz + m[11]);
    }
    out.push([x, y, z]);
  }
  return out;
}

/** Normal of the plane best fitting a point cloud: the direction of least
 *  spread. Brute force over PROBE_DIRS, which is plenty for a flat-ish hand or
 *  sole and avoids pulling in an eigen solver. Sign is resolved toward `hint`. */

/** Rotate `bone` so the plane through `verts` faces `target`. Closed form: the
 *  axis is the cross product of the current normal and the target, the angle is
 *  the angle between them. Two passes absorb the small error from rotating a
 *  bone whose children carry some of the vertices. */

/** How far from level the underside of a foot is: the height range of its
 *  lowest fifth of vertices. Zero means the sole is lying flat.
 *
 *  This replaces a plane fit for the feet. Fitting a plane to a chunky
 *  three-toed foot finds the widest plane through its volume, which is not the
 *  sole, so aligning that normal left the soles 20-plus degrees off. The
 *  underside is what touches the floor, so measure the underside. */
function soleSpread(pose, side) {
  const ys = skinnedPoints(pose, FOOT_VERTS[side])
    .map((p) => p[1])
    .sort((a, b) => a - b);
  const low = ys.slice(0, Math.max(3, Math.floor(ys.length * 0.2)));
  return low[low.length - 1] - low[0];
}

/** Rotate a foot until its underside lies flat, by direct numerical descent on
 *  soleSpread over the two axes that tip it. */
function flattenSole(pose, side) {
  const bone = side + '_Foot';
  // Halve the step whenever no direction improves, rather than stopping: a
  // fixed step stalls in a shallow local minimum well short of flat.
  let STEP = 0.06;
  for (let pass = 0; pass < 40; pass++) {
    const base = soleSpread(pose, side);
    if (base < 0.003 || STEP < 0.002) break;
    let bestAxis = null;
    let bestDelta = 0;
    let bestGain = 0;
    for (const axis of [X, Z]) {
      for (const delta of [STEP, -STEP]) {
        worldRotate(pose, bone, axis, delta);
        const gain = base - soleSpread(pose, side);
        worldRotate(pose, bone, axis, -delta);
        if (gain > bestGain) {
          bestGain = gain;
          bestAxis = axis;
          bestDelta = delta;
        }
      }
    }
    if (!bestAxis) {
      STEP /= 2;
      continue;
    }
    worldRotate(pose, bone, bestAxis, bestDelta);
  }
  return pose;
}

/** The direction from a hand to the nearest point on the torso, which is what
 *  'palm facing the body' actually means.
 *
 *  A fixed world axis cannot express this. It only reads as body-facing while
 *  the creature stands upright and square to that axis: once the arm swings
 *  across the chest the constant axis is no longer the inward direction, and
 *  once the body topples for the death the axis points off into the world
 *  entirely. Deriving it from the pose holds in every orientation. */
function bodyward(pose, side) {
  const pts = skinnedPoints(pose, HAND_VERTS[side]);
  const hand = [0, 0, 0];
  for (const q of pts) for (let i = 0; i < 3; i++) hand[i] += q[i] / pts.length;
  const a = worldPos(pose, 'Pelvis');
  const b = worldPos(pose, 'NeckTwist01');
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  // Closest point on the torso segment, so a hand at the hip aims at the hip
  // and a hand at the chest aims at the chest.
  let t = 0;
  if (len2 > 1e-9) {
    t = ((hand[0] - a[0]) * ab[0] + (hand[1] - a[1]) * ab[1] + (hand[2] - a[2]) * ab[2]) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const dir = [a[0] + ab[0] * t - hand[0], a[1] + ab[1] * t - hand[1], a[2] + ab[2] * t - hand[2]];
  const d = Math.hypot(dir[0], dir[1], dir[2]);
  if (d < 1e-6) return side === 'L' ? [0, 0, 1] : [0, 0, -1];
  return [dir[0] / d, dir[1] / d, dir[2] / d];
}

/** Rotate a vector by a quaternion. */
function qRot(q, v) {
  const [x, y, z, w] = q;
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [
    v[0] + w * t[0] + (y * t[2] - z * t[1]),
    v[1] + w * t[1] + (z * t[0] - x * t[2]),
    v[2] + w * t[2] + (x * t[1] - y * t[0]),
  ];
}

// Which way the palm faces, in the hand bone's OWN local frame.
//
// This is a rig fact, established by rendering each hand from all six of its
// local axes and looking: the broad brown palm pad faces +X on the left hand
// and -X on the right. It is NOT derivable from the mesh. A plane fit to the
// hand vertices, which is what this used to do, is meaningless here: the two
// hands measure only 0.82 and 0.66 flat (a real flat hand is nearer 0.2), they
// are not even mirrored meshes (114 verts against 70), and their fitted normals
// disagree about which axis is thinnest. Fitting a plane to a chunky paw finds
// the widest plane through its VOLUME, exactly the trap the soles hit.
const PALM_AXIS = { L: [1, 0, 0], R: [-1, 0, 0] };

/** Turn a hand so its palm faces the body, by rotating the palm axis itself
 *  onto the bodyward direction. Closed form and exact. */
function aimPalm(pose, side) {
  const bone = side + '_Hand';
  for (let pass = 0; pass < 2; pass++) {
    const n = qRot(worldQuat(pose, bone), PALM_AXIS[side]);
    const t = bodyward(pose, side);
    const dot = Math.max(-1, Math.min(1, n[0] * t[0] + n[1] * t[1] + n[2] * t[2]));
    const angle = Math.acos(dot);
    if (angle < 0.004) break;
    const axis = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    if (len < 1e-6) break;
    worldRotate(pose, bone, [axis[0] / len, axis[1] / len, axis[2] / len], angle);
  }
  return pose;
}

const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l < 1e-9 ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l];
};

// Arm adjustment, as an ordered list of tuning PASSES.
//
// Not a flat set of totals, deliberately. These rotations are about different
// axes and do not commute: a pitch followed by a yaw is not the same pose as
// their sums applied together, and a roll axis is read off the arm AFTER the
// spread has moved it. Summing successive tuning rounds would therefore drift
// away from what was actually dialled. Replaying the rounds in order
// reproduces the viewer exactly, which is where these numbers were judged.
//
// Each pass, per arm, applies in this order: spread out, then the rolls
// shoulder-down, then where the hand points. Positive spread always means
// OUTWARD; the left/right mirroring is applied at use.
//
// Why by eye at all: the palm direction is not recoverable from this mesh.
// Four derivations disagreed (a plane fit is meaningless on hands that measure
// 0.82 and 0.66 flat; the render-read axis pointed 56 percent along the
// forearm, which no palm can do; a claw-plane fit put the left hand on -Z and
// the right on +X; a projected-area fit put the left broad face on the floor),
// and the two hands are not even mirrored meshes, 114 vertices against 70.
const ARM_PASSES = [
  {
    L: { clav: 7, sup: 17, upper: 70, fore: 90, hand: -45, pitch: 0, yaw: 0 },
    R: { clav: 14, sup: 5, upper: -43, fore: -104, hand: 45, pitch: 0, yaw: 0 },
  },
  {
    L: { clav: -3, sup: 0, upper: -5, fore: -3, hand: -13, pitch: -61, yaw: -66 },
    R: { clav: -3, sup: 1, upper: 9, fore: -11, hand: 0, pitch: -63, yaw: 89 },
  },
];

// Which bone each roll turns, and the segment whose direction is its axis. The
// hand has no child joint on this rig, so it rolls about the forearm segment it
// sits on, which is what pronation actually is.
const ROLL_CHAIN = [
  ['upper', 'Upperarm', 'Upperarm', 'Forearm'],
  ['fore', 'Forearm', 'Forearm', 'Hand'],
  ['hand', 'Hand', 'Forearm', 'Hand'],
];

const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const rad = (deg) => (deg * Math.PI) / 180;

/** Replay every tuning pass on one arm, in order.
 *
 *  Spread, then the rolls shoulder-down, then where the hand points. Each axis
 *  is recomputed from the pose as it stands, so a later pass sees the arm the
 *  earlier ones left behind, exactly as the live viewer did. All constants, so
 *  nothing here can shimmy from frame to frame. */
function twistArm(pose, side) {
  const sign = side === 'L' ? 1 : -1;
  for (const pass of ARM_PASSES) {
    const v = pass[side];
    if (!v) continue;
    for (const [key, bone] of [
      ['clav', 'Clavicle'],
      ['sup', 'Upperarm'],
    ]) {
      if (!v[key]) continue;
      worldRotate(pose, side + '_' + bone, X, sign * rad(v[key]));
    }
    for (const [key, bone, from, to] of ROLL_CHAIN) {
      if (!v[key]) continue;
      const a = worldPos(pose, side + '_' + from);
      const b = worldPos(pose, side + '_' + to);
      const axis = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      if (!axis[0] && !axis[1] && !axis[2]) continue;
      worldRotate(pose, side + '_' + bone, axis, rad(v[key]));
    }
    const hand = side + '_Hand';
    if (v.pitch) {
      const w = worldPos(pose, hand);
      const e = worldPos(pose, side + '_Forearm');
      const f = norm3([w[0] - e[0], w[1] - e[1], w[2] - e[2]]);
      const pitchAxis = norm3(cross3(Y, f));
      if (pitchAxis[0] || pitchAxis[1] || pitchAxis[2]) {
        worldRotate(pose, hand, pitchAxis, rad(v.pitch));
      }
    }
    if (v.yaw) worldRotate(pose, hand, Y, rad(v.yaw));
  }
  return pose;
}

const twistHands = (pose) => {
  twistArm(pose, 'L');
  twistArm(pose, 'R');
  return pose;
};
/** Soles flat on the ground, palms turned to face the body. The palm targets
 *  are mirrored: the left hand sits at negative Z, so its palm faces +Z toward
 *  the body centre line, and the right hand the other way. */
function alignLimbs(pose, { soles = true, palms = true } = {}) {
  if (soles) {
    flattenSole(pose, 'L');
    flattenSole(pose, 'R');
  }
  if (palms) {
    aimPalm(pose, 'L');
    aimPalm(pose, 'R');
  }
  return pose;
}

const STAND_CONTACT = Math.min(footContact(P_stand, 'L'), footContact(P_stand, 'R'));

/** Drive each knee independently until BOTH feet rest on the standing plane,
 *  measured against the skinned mesh rather than the bones.
 *
 *  Grounding the body as a whole pins whichever foot is lowest and lets the
 *  other float by however far apart they were, and this rig stands with its
 *  feet at different heights to begin with. Measured per foot, that left one
 *  foot up to 0.13 off the floor mid-dance.
 *
 *  The step size is solved numerically rather than assumed. Which way a knee
 *  rotation moves the foot, and how far, depends on the pose it is applied to,
 *  and a hand-picked gain either crawls or diverges (a fixed 2.6 sent it to
 *  0.36 of lift). Probing the actual derivative each pass and clamping the step
 *  converges in a handful of iterations from any starting sign. */
function levelFeet(pose) {
  // Level to whichever foot is HIGHER, never to the lower one. Bending a knee
  // lifts a foot easily but cannot push one below the leg's reach, so aiming
  // at the lower foot leaves the other stalled a couple of centimetres up,
  // which is exactly the hovering foot this used to have. Raising the low foot
  // to meet the high one always has a solution; the body is then dropped onto
  // the floor as a whole, which is a translation and always exact.
  const PROBE = 0.05;
  const MAX_STEP = 0.35;
  const target = Math.max(footContact(pose, 'L'), footContact(pose, 'R'));
  for (let pass = 0; pass < 16; pass++) {
    let worst = 0;
    for (const side of ['L', 'R']) {
      const bone = side + '_Calf';
      const y0 = footContact(pose, side);
      const error = STAND_CONTACT - y0;
      if (Math.abs(error) < 0.0008) continue;
      worst = Math.max(worst, Math.abs(error));
      // Probe all three world axes and use whichever actually moves this foot.
      // The knee hinge is not the same world axis on both legs once the thighs
      // are splayed apart, so a single hard-coded axis converges on one side
      // and stalls on the other.
      let bestAxis = null;
      let bestSlope = 0;
      for (const axis of [Z, X, Y]) {
        // Probe the KNEE ALONE. Rolling the foot back by the same angle to keep
        // the sole flat very nearly cancels the height the knee just bought, so
        // probing the pair together reports a slope of ~0 and the solver
        // correctly concludes it cannot help, then does nothing. Height is
        // solved on the knee; the sole is kept flat by the fixed offsets in
        // legs() instead.
        worldRotate(pose, bone, axis, PROBE);
        const slope = (footContact(pose, side) - y0) / PROBE;
        worldRotate(pose, bone, axis, -PROBE);
        if (Number.isFinite(slope) && Math.abs(slope) > Math.abs(bestSlope)) {
          bestSlope = slope;
          bestAxis = axis;
        }
      }
      if (!bestAxis || Math.abs(bestSlope) < 1e-4) continue;
      const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, error / bestSlope));
      worldRotate(pose, bone, bestAxis, step);
    }
    if (worst === 0) break;
  }
  // Report what the solve ACHIEVED, not what it aimed at. The two differ
  // whenever a leg runs out of reach, and dropping the body by the aim rather
  // than the result buries the whole model by the shortfall.
  return Math.min(footContact(pose, 'L'), footContact(pose, 'R'));
}

function pose(ops, { drive = 0 } = {}) {
  const out = new Map(P_stand);
  for (const [bone, axis, angle] of ops) worldRotate(out, bone, axis, angle);
  alignLimbs(out, { soles: false, palms: true });
  twistHands(out);
  // Height and sole angle pull against each other, so alternate them. The sole
  // orientation is the SAME closed-form target on every pose, which is what
  // keeps the soles from shimmying between keys.
  let plane = 0;
  for (let pass = 0; pass < 3; pass++) {
    plane = levelFeet(out);
    pinFootOrientation(out, 'L', FLAT_FOOT_WORLD.L);
    pinFootOrientation(out, 'R', FLAT_FOOT_WORLD.R);
  }
  plane = Math.min(footContact(out, 'L'), footContact(out, 'R'));
  out.set(ROOT_POS, [
    restRootPos[0] + drive,
    restRootPos[1] + (STAND_CONTACT - plane),
    restRootPos[2],
  ]);
  return out;
}

/** Like pushPoseRamp, but re-grounds every keyframe it emits.
 *
 *  pushPoseRamp lerps the two end poses INCLUDING their root translations, and
 *  a lerped root does not match the foot height the lerped LEG ROTATIONS
 *  actually produce. Measured on the first cut of the haka, that sank the body
 *  below the floor on 37% of frames even though every authored key was correct,
 *  because the dips all live between the keys. Re-deriving the lift per emitted
 *  key from the blended pose is the fix. */
function rampGrounded(timeline, { fromTime, toTime, steps, ease, fromPose, toPose }) {
  for (let step = 1; step <= steps; step++) {
    const f = step / steps;
    const e = ease(f);
    const blended = new Map();
    for (const key of allKeys) {
      if (key === ROOT_POS) continue;
      const a = poseValue(fromPose, key, P_all);
      const b = poseValue(toPose, key, P_all);
      if (a && b) blended.set(key, blendValue(key, a, b, e));
    }
    const fromRoot = fromPose.get(ROOT_POS) ?? restRootPos;
    const toRoot = toPose.get(ROOT_POS) ?? restRootPos;
    // Re-level the BLENDED pose, not just the authored ends. Interpolated leg
    // rotations put the feet somewhere neither end pose predicted, which is
    // where the drift lives.
    // No JOINT solving here: the end poses already carry the limb corrections,
    // and re-running a numerical descent per blended key is what shook the feet
    // apart, because each frame converged somewhere slightly different.
    //
    // The root height is still corrected, because that is a single scalar. It
    // cannot disagree with itself frame to frame, so it holds the feet down
    // without reintroducing the jitter.
    // The blend runs in LOCAL space, so a sole that is flat at both ends is
    // NOT flat in between: the calf orientation differs between the ends, and
    // the foot inherits the interpolated parent. Re-pin to the same fixed
    // WORLD orientation the ends use. Closed form, so this cannot shimmy.
    // Same local-space blend problem as the soles: a palm aimed correctly at
    // both ends still drifts in between, so re-aim it here too.
    alignLimbs(blended, { soles: false, palms: true });
    twistHands(blended);
    pinFootOrientation(blended, 'L', FLAT_FOOT_WORLD.L);
    pinFootOrientation(blended, 'R', FLAT_FOOT_WORLD.R);
    const drop = STAND_CONTACT - Math.min(footContact(blended, 'L'), footContact(blended, 'R'));
    blended.set(ROOT_POS, [
      fromRoot[0] + (toRoot[0] - fromRoot[0]) * e,
      restRootPos[1] + drop,
      restRootPos[2],
    ]);
    timeline.push([fromTime + (toTime - fromTime) * f, (key) => poseValue(blended, key, P_all)]);
  }
}

// --- planting the feet ------------------------------------------------------
// Feet that drift or shimmy while the creature is standing still are the single
// most obvious fault on this rig, and every attempt to solve them per frame
// made it worse: a numerical descent converges somewhere slightly different on
// each frame, and that disagreement IS the jitter.
//
// So neither of these solves anything per frame.
//
// The legs branch at Hip > Pelvis and the torso at Hip > Waist, which means the
// whole lower body can be held rigid while the upper body keeps animating. For
// a clip where the creature is not going anywhere, that is not an approximation
// of planted feet, it is planted feet: the bones literally cannot move.
const LOWER_BODY = [
  'Hip',
  'Pelvis',
  'L_Thigh',
  'L_ThighTwist01',
  'L_ThighTwist02',
  'L_Calf',
  'L_CalfTwist01',
  'L_CalfTwist02',
  'L_Foot',
  'L_ToeBase',
  'R_Thigh',
  'R_ThighTwist01',
  'R_ThighTwist02',
  'R_Calf',
  'R_CalfTwist01',
  'R_CalfTwist02',
  'R_Foot',
  'R_ToeBase',
];

/** Copy every lower-body channel, plus the root, from `anchor` into `pose`. The
 *  torso and head keep whatever the clip was doing. */
function freezeStance(pose, anchor) {
  for (const bone of LOWER_BODY) {
    for (const path of ['translation', 'rotation', 'scale']) {
      const key = bone + '|' + path;
      const value = anchor.get(key);
      if (value) pose.set(key, value.slice());
    }
  }
  const rootRot = anchor.get(ROOT_ROT);
  const rootPos = anchor.get(ROOT_POS);
  if (rootRot) pose.set(ROOT_ROT, rootRot.slice());
  if (rootPos) pose.set(ROOT_POS, rootPos.slice());
  return pose;
}

/** Force a foot to a fixed WORLD orientation by solving the local rotation
 *  directly: local = inverse(parentWorld) * target. Exact, closed form, and
 *  identical on every frame, so a sole pinned this way cannot shimmy the way a
 *  searched one does. */
function pinFootOrientation(pose, side, targetWorld) {
  const parent = worldQuat(pose, parentOf.get(side + '_Foot'));
  pose.set(side + '_Foot|rotation', qMul(qConj(parent), targetWorld));
  return pose;
}

// The flattened stance every clip pins against, solved ONCE.
const FLAT_STANCE = (() => {
  const base = new Map(P_stand);
  alignLimbs(base, { soles: false, palms: true });
  // Bring the two feet onto one plane, once. Solved on a single static pose
  // that is then copied to every frame, so there is no per-frame disagreement
  // left for it to shimmy with.
  // Height and sole angle fight each other: levelFeet rotates the calves and
  // the feet inherit that tilt, while flattening the feet shifts which vertex
  // is lowest and so moves the height. Alternate them, re-pinning the sole
  // orientation in closed form after each height pass, and both settle.
  levelFeet(base);
  flattenSole(base, 'L');
  flattenSole(base, 'R');
  const flatL = worldQuat(base, 'L_Foot');
  const flatR = worldQuat(base, 'R_Foot');
  for (let pass = 0; pass < 3; pass++) {
    levelFeet(base);
    pinFootOrientation(base, 'L', flatL);
    pinFootOrientation(base, 'R', flatR);
  }
  const low = Math.min(footContact(base, 'L'), footContact(base, 'R'));
  const rp = base.get(ROOT_POS) ?? restRootPos;
  base.set(ROOT_POS, [rp[0], rp[1] + (STAND_CONTACT - low), rp[2]]);
  return base;
})();
const FLAT_FOOT_WORLD = {
  L: worldQuat(FLAT_STANCE, 'L_Foot'),
  R: worldQuat(FLAT_STANCE, 'R_Foot'),
};

// --- Kauriki_Haka ----------------------------------------------------------
// Arms hang down at rest, so world X splays them out to the sides (positive for
// the L side, which sits at negative Z) and world Z swings them fore and aft.
// The legs work the same way; the neck pitches the bill down and forward on a
// NEGATIVE Z rotation.
//
// The dance is parahu / whakatangi, the slapping of arms and thighs, over a
// body that drops onto every beat. THE FEET NEVER LEAVE THE FLOOR.
//
// Two earlier cuts got that wrong in different ways and are worth recording so
// nobody reintroduces them. Raising one knee at a time is a rotation about
// world Z, which swings the whole thigh FORWARD: on a body this hunched it
// reads as kicking a leg out in front, not as a stamp. Jumping instead put both
// feet in the air together, which fixed the kick but still left the soles
// swinging up off the ground. So the legs now do exactly one thing, a symmetric
// knee bend, and the grounding lift in `pose` turns that bend into hip height
// with the feet pinned to the floor. The beat is the body dropping, not the
// feet moving.
//
// The slap has its own constraint: the arms are short stubs that vanish against
// the plumage when tucked, so each slap travels from fully OPEN, where they
// break the silhouette against the background, to in against the thigh. The eye
// catches the arc, not the contact, and the torso fold plus the body drop carry
// the impact.

/** Symmetric stance with a given knee bend, feet held flat on the floor.
 *
 *  The foot rotations are not decoration: a knee bend and a thigh splay both
 *  propagate down the chain and tip the sole with them, which lifts the toes or
 *  the heel off the ground. Cancelling both at the foot keeps the sole level at
 *  every depth, so the leg can fold and unfold without the foot ever appearing
 *  to leave the floor. */
const legs = (bend) => [
  ['L_Thigh', X, 0.5],
  ['R_Thigh', X, -0.5],
  ['L_Calf', Z, bend],
  ['R_Calf', Z, bend],
  ['L_Foot', Z, -bend],
  ['R_Foot', Z, -bend],
  ['L_Foot', X, -0.34],
  ['R_Foot', X, 0.34],
];

/** Head jutted forward, bill swung toward `turn` so it tracks the beat.
 *
 *  Every rotation here is NEGATIVE about Z because forward is +X and the spine
 *  points up: a positive Z rotation tips the torso BACKWARD. An earlier cut had
 *  the waist positive and the neck negative, so the body leaned back while the
 *  head reached forward and the whole thing read as bending over backwards. */
const headOut = (turn) => [
  ['Waist', Z, -0.14],
  ['Spine01', Z, -0.07],
  ['NeckTwist01', Z, 0.16],
  ['NeckTwist01', X, turn],
  ['NeckTwist02', X, turn * 0.8],
  ['Head', X, turn * 0.5],
];

// Roll applied down the forearm so the palms face the BODY rather than
// forward. The rig binds with the hands pronated, which on a haka reads wrong:
// the hands should present inward toward the chest and thighs they strike.
// Split across the twist bone and the hand so the wrist does not shear.
const palmsIn = (amount) => [
  ['L_ForearmTwist02', Y, amount],
  ['R_ForearmTwist02', Y, -amount],
  ['L_Hand', Y, amount * 0.6],
  ['R_Hand', Y, -amount * 0.6],
];
const PALM_ROLL = 1.1;

/** Arms thrown fully open, clear of the body: the readable half of the slap. */
const armsOpen = [
  ['L_Clavicle', X, 0.28],
  ['R_Clavicle', X, -0.28],
  ['L_Upperarm', X, 1.32],
  ['R_Upperarm', X, -1.32],
  ['L_Upperarm', Z, -0.25],
  ['R_Upperarm', Z, -0.25],
  ...palmsIn(PALM_ROLL),
];

/** Arms driven in and UP onto the torso, forearms folded so the hands finish
 *  high on the chest. The chest is a bigger, whiter target than the thighs and
 *  sits where the eye is already looking, so the strike reads from further out. */
const armsStruck = [
  ['L_Clavicle', X, -0.16],
  ['R_Clavicle', X, 0.16],
  ['L_Upperarm', X, -0.28],
  ['R_Upperarm', X, 0.28],
  ['L_Upperarm', Z, 0.12],
  ['R_Upperarm', Z, 0.12],
  ['L_Forearm', Z, 1.25],
  ['R_Forearm', Z, 1.25],
  ...palmsIn(PALM_ROLL),
];

// The bob: how far the hips travel between the top of a beat and the bottom.
const HIGH = 0.42;
const LOW = 1.02;

const P_stance = pose([...legs(0.7), ...armsOpen, ['Waist', Z, -0.1]]);
// Up on straighter legs with the arms open, ready to drop.
const P_rise = (turn) => pose([...legs(HIGH), ...armsOpen, ...headOut(turn)]);
// The beat: body dropped onto bent knees, hands struck onto the thighs, torso
// folded. Feet have not moved.
const P_beat = (turn) => pose([...legs(LOW), ...armsStruck, ...headOut(turn), ['Waist', Z, -0.2]]);

const P_riseR = P_rise(-0.24);

// The finish: the deepest drop, driven forward over the planted feet with the
// bill run out at the target.
const P_slam = pose(
  [
    ...legs(1.12),
    ...armsStruck,
    ['Waist', Z, -0.32],
    ['Spine01', Z, -0.16],
    ['NeckTwist01', Z, 0.1],
    ['NeckTwist02', Z, 0.06],
  ],
  { drive: 0.12 },
);

// Open AND close on the flattened stance, never the raw rest pose: P_stand has
// not been through levelFeet or the sole pin, so its feet sit at the rig's own
// rest tilt and the blend drags that tilt across the back half of the clip.
const haka = [[0, (k) => poseValue(P_stance, k, P_all)]];
const beat = (fromTime, toTime, fromPose, toPose, ease, steps = 5) =>
  rampGrounded(haka, { fromTime, toTime, steps, ease, fromPose, toPose });
const hold = (time, held) => haka.push([time, (k) => poseValue(held, k, P_all)]);

// ONE strike, and the clip runs 0.783s so it drops into the same swing slot as
// the bruin form Attack it replaces (measured off bear_form.glb, which the
// VisualDef plays at attackTimeScale 1).
beat(0, 0.18, P_stance, P_riseR, easeOutCubic, 4);
beat(0.18, 0.3, P_riseR, P_slam, easeOutCubic, 3);
hold(0.42, P_slam);
beat(0.42, 0.783, P_slam, P_stance, easeInOutQuad, 6);
const { animation: hakaClip } = bakeClip(doc, {
  clipName: 'Kauriki_Haka',
  channelKeys: allKeys,
  timeline: haka,
  donorFor,
});

// --- Kauriki_Death ---------------------------------------------------------
// One rigid rotation about the root, which sits at ground level, so the body
// tips about its own feet. Root's parent is identity and its translation
// channel is already in world axes.
const ROOT_ROT = 'Root|rotation';
const restRootRot = FLAT_STANCE.get(ROOT_ROT) ?? restRotation.get('Root');
const FLAT = Math.PI / 2;
const REST_LIFT = 0.17;

// Stand at the flattened stance's own root height, not the rig's rest height.
const STAND_ROOT = FLAT_STANCE.get(ROOT_POS) ?? restRootPos;

function toppled(theta) {
  const lift = (Math.min(Math.abs(theta), FLAT) / FLAT) * REST_LIFT;
  return {
    rot: qMul(qAbout(Z, theta), restRootRot),
    pos: [STAND_ROOT[0], STAND_ROOT[1] + lift, STAND_ROOT[2]],
  };
}

// Once the body is over, the world axes read off the corpse: +X runs head to
// feet, +Y is up off the ground, +Z is the bird's right. Wings and legs end up
// along +X, the axis of the fall, so they can only splay about world Y; the head
// rolls about world X, which is what drops the bill onto its side.
const LIMP = [
  ['L_Clavicle', Y, 0.2],
  ['L_Upperarm', Y, 0.6],
  ['L_Forearm', Y, 0.44],
  ['R_Clavicle', Y, -0.18],
  ['R_Upperarm', Y, -0.56],
  ['R_Forearm', Y, -0.4],
  ['L_Thigh', Y, 0.56],
  ['R_Thigh', Y, -0.5],
  ['L_Calf', Y, 0.24],
  ['R_Calf', Y, -0.2],
  ['L_Foot', Z, -0.68],
  ['R_Foot', Z, -0.6],
  ['NeckTwist01', X, 0.32],
  ['NeckTwist02', X, 0.44],
  ['Head', X, 0.7],
];

function deathPose(theta, limp) {
  // Start from the FLATTENED stance, not the raw rest pose. The death spends
  // its first beat standing, and P_stand stands on the rig's own untreated
  // feet: tilted soles, exactly the fault the haka had.
  const out = new Map(FLAT_STANCE);
  const { rot, pos } = toppled(theta);
  out.set(ROOT_ROT, rot);
  out.set(ROOT_POS, pos);
  if (limp > 0) for (const [bone, axis, angle] of LIMP) worldRotate(out, bone, axis, angle * limp);
  // Re-aim the palms AFTER the topple and the limp. Both move the hands, and
  // the body-relative target follows the body over as it falls.
  alignLimbs(out, { soles: false, palms: true });
  twistHands(out);
  // Sit the body ON the ground rather than at a hand-tuned lift. REST_LIFT was
  // a single constant standing in for the whole fall, and it cannot be right
  // at both ends: it sank the body 0.021 into the floor early and floated it
  // 0.199 above the floor through the middle. A topple pivots on whatever is
  // touching, so the correct height is simply the one that puts the lowest
  // point of the body on the ground plane, solved per frame.
  const rp = out.get(ROOT_POS) ?? restRootPos;
  out.set(ROOT_POS, [rp[0], rp[1] + (STAND_CONTACT - bodyContact(out)), rp[2]]);
  return out;
}

// The limbs let go partway through the fall, not on impact: a body that stays
// rigid until it lands and only then goes slack reads as two events, not one.
const limpAt = (t) => easeOutCubic(Math.min(1, Math.max(0, (t - 0.7) / 1.05)));
const fall = (t, theta) => {
  const p = deathPose(theta, limpAt(t));
  return [t, (k) => poseValue(p, k, P_all)];
};

const death = [fall(0, 0), fall(0.16, -0.1), fall(0.34, -0.13)];
for (let s = 1; s <= 12; s++) {
  const f = s / 12;
  // Gravity accelerates: ease IN, so the topple starts slow and arrives fast.
  death.push(fall(0.34 + 0.96 * f, -0.13 + (FLAT + 0.13) * f ** 2.1));
}
death.push(fall(1.42, FLAT - 0.1)); // bounce off the ground
death.push(fall(1.56, FLAT + 0.012));
death.push(fall(1.72, FLAT - 0.03));
death.push(fall(2.0, FLAT));

const { animation: deathClip } = bakeClip(doc, {
  clipName: 'Kauriki_Death',
  channelKeys: allKeys,
  timeline: death,
  donorFor,
});

/** Solve the limb corrections ONCE against a reference pose and keep the list
 *  of rotations, so every frame gets an identical, stable correction. */
// Capture the SOLE correction once, to be replayed on every frame. Solving it
// per frame is what shook the feet apart, because a numerical descent lands
// somewhere slightly different each time.
//
// The palms are deliberately NOT captured here. A rotation captured from the
// standing pose only puts the palm right for the standing pose; replayed onto
// an arm that is mid-stride or mid-cast it points the palm anywhere. Measured
// on the presets, that left Run at 0.138 and Cast at 0.264 against the body,
// with individual frames as low as -0.799, meaning the palm faced away. The
// palms are aimed live per frame instead, which is safe because aimPalm is
// closed form: it has no search to converge differently from frame to frame.
function captureLimbFix(reference, { soles }) {
  const probe = new Map(reference);
  recorder = [];
  alignLimbs(probe, { soles, palms: true });
  const ops = recorder;
  recorder = null;
  return ops;
}

const PLANTED_FIX = captureLimbFix(P_stand, { soles: true });
const MOVING_FIX = captureLimbFix(P_stand, { soles: false });
console.log('limb fix: ' + PLANTED_FIX.length + ' planted, ' + MOVING_FIX.length + ' moving');

// --- preset fixups ---------------------------------------------------------
// The two authored clips are not the whole story. Idle, Walk, Run, Hit, Cast and
// Jump are raw Tripo preset retargets, and they carry two faults the authored
// clips were fixed for: the rig binds the hands PRONATED, so the palms face
// forward instead of presenting toward the body, and the idle stands with one
// foot 0.039 off the floor. Since idle is what a tank is doing most of the time,
// those are the frames a player actually sees.
//
// The distinction that matters: foot levelling is applied ONLY to clips where
// the feet are supposed to be planted. Pinning the feet through Walk, Run or
// Jump would destroy the gait, which is the whole point of those clips.
const PALM_FIX = ['Idle', 'Walk', 'Run', 'Hit', 'Cast', 'Jump'];
// Clips where the creature is standing still, so the lower body is frozen to
// the flattened stance and the feet cannot move at all. Walk, Run and Jump are
// deliberately absent: their footwork IS the clip.
const FOOT_FIX = new Set(['Idle', 'Hit', 'Cast']);
const FIXUP_FPS = 24;

const fixedClips = [];
for (const name of PALM_FIX) {
  const idx = indexClip(root, name);
  const source = root.listAnimations().find((a) => a.getName() === name);
  const duration = Math.max(...source.listSamplers().map((s) => s.getInput().getArray().at(-1)));
  const plantFeet = FOOT_FIX.has(name);
  const frames = Math.max(2, Math.round(duration * FIXUP_FPS));
  const timeline = [];
  for (let i = 0; i <= frames; i++) {
    const t = (i / frames) * duration;
    const framePose = samplePose(idx, t);
    // Replay the correction captured from the standing pose. Re-aiming the
    // palms per frame instead was a regression: it constrains only the palm
    // axis and leaves the spin about it free, which twisted the claws round
    // to point backwards and left the hands reading as featureless blobs.
    for (const [bone, axis, angle] of plantFeet ? PLANTED_FIX : MOVING_FIX) {
      worldRotate(framePose, bone, axis, angle);
    }
    if (plantFeet) freezeStance(framePose, FLAT_STANCE);
    twistHands(framePose);
    timeline.push([t, (key) => poseValue(framePose, key, P_all)]);
  }
  const { animation } = bakeClip(doc, {
    clipName: 'Kauriki_' + name,
    channelKeys: new Set(idx.keys()),
    timeline,
    donorFor: (key) => idx.get(key),
  });
  fixedClips.push(animation);
  console.log(
    'fixed ' +
      name +
      ' -> Kauriki_' +
      name +
      '  ' +
      duration.toFixed(2) +
      's, ' +
      (frames + 1) +
      ' keys' +
      (plantFeet ? ', feet planted' : ', gait untouched'),
  );
}

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + clips): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, [hakaClip, deathClip, ...fixedClips]);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);
console.log(`wrote ${OUT}`);
console.log(
  `clips: ${root
    .listAnimations()
    .map((a) => a.getName())
    .join(', ')}`,
);
