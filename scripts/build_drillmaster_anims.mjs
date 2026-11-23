// Build the Muster Drillmaster's two clips (content/mirefen_muster.ts muster_drillmaster):
// the knight rig carrying the camp's stake mallet (scripts/assets/muster_effigy/), which
// until now stood with the mallet held out level (the rig's plain Idle) and chopped at
// nothing on a loop. Pose-sample-and-blend off the knight's own shipped clips
// (scripts/anim/pose_blend.mjs), plus a small two-bone arm solve for the one pose no donor
// clip has: a man leaning on a planted mallet.
//
//   Drill_Rest (loop): at ease between blows. The mallet stands on its head in front of him
//   and a little to his right, its handle slanting back up to his hands, both hands
//   stacked on it at shoulder height, his back bent a touch forward onto it. The legs and
//   the breathing are the rig's Idle, slowed down.
//   Drill_Pound (one-shot, 1.35 s at time scale 1): from the rest he hauls the mallet up
//   over his shoulder (the two-handed chop's windup), brings it down so the head meets
//   the ground in front of him at exactly MUSTER_DRILL_POUND_IMPACT (0.55 s,
//   src/sim/muster_drill.ts: the moment the sim lands the shockwave and the dust), holds
//   the blow for a beat, and settles back into the lean.
//
// The mallet's grip frame is the KayKit two-handed axe's (model.py): the handle runs along
// the hand slot's +Y from the butt (-0.43) to the crown (1.29), the head's centre about
// 1.05 up it. So "the head on the ground" is a target for the hand slot's position AND its
// +Y axis, which the arm solve below meets.
//
// Usage: node scripts/build_drillmaster_anims.mjs [--preview]
// Output: public/models/chars/players/drillmaster_anims.glb (0 meshes/skins, 2 clips)
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
const OUT = resolve(ROOT, 'public/models/chars/players/drillmaster_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/drillmaster_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

/** The sim's strike frame (src/sim/muster_drill.ts MUSTER_DRILL_POUND_IMPACT). */
const IMPACT = 0.55;
/** The rest loop's length: the Idle breath, slowed to an at-ease pace. */
const REST_SECONDS = 2.4;
/** Hand slot to the head's centre along the handle (model units, the axe grip frame). */
const HEAD_ALONG_HANDLE = 1.05;
/** The drum's radius: its centre sits this far above the ground when it is planted. */
const HEAD_RADIUS = 0.24;

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();
const nodes = root.listNodes();
const byName = new Map(nodes.map((n) => [n.getName(), n]));
const parentOf = new Map();
for (const n of nodes) for (const c of n.listChildren()) parentOf.set(c, n);

const idleIdx = indexClip(root, 'Idle');
const chopIdx = indexClip(root, '2H_Melee_Attack_Chop');
const allKeys = new Set([...idleIdx.keys(), ...chopIdx.keys()]);
const donorFor = (key) => idleIdx.get(key) ?? chopIdx.get(key);

// ---------------------------------------------------------------------------
// quaternion helpers and forward kinematics over a sampled pose
// ---------------------------------------------------------------------------
function qmul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
function qrot(q, v) {
  const [x, y, z, w] = q;
  const uv = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]];
  const uuv = [y * uv[2] - z * uv[1], z * uv[0] - x * uv[2], x * uv[1] - y * uv[0]];
  return [
    v[0] + 2 * (w * uv[0] + uuv[0]),
    v[1] + 2 * (w * uv[1] + uuv[1]),
    v[2] + 2 * (w * uv[2] + uuv[2]),
  ];
}
function qaxis(axis, angle) {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
function qnorm(q) {
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};

/** World position and rotation of a node under a pose (the rig carries no scale). */
function worldOf(pose, node) {
  const chain = [];
  for (let n = node; n; n = parentOf.get(n)) chain.unshift(n);
  let p = [0, 0, 0];
  let q = [0, 0, 0, 1];
  for (const n of chain) {
    const t = pose.get(`${n.getName()}|translation`) ?? n.getTranslation();
    const r = pose.get(`${n.getName()}|rotation`) ?? n.getRotation();
    const rt = qrot(q, t);
    p = [p[0] + rt[0], p[1] + rt[1], p[2] + rt[2]];
    q = qmul(q, r);
  }
  return { p, q };
}

/**
 * Solve an arm (upper arm, forearm, wrist) so its hand slot lands on `pos` and, when
 * `dir` is given, its +Y (the mallet's handle) points along `dir`. Deterministic
 * coordinate descent on small local rotations, pulled back toward the starting pose so
 * the elbow keeps the donor's natural bend. Mutates and returns `pose`.
 */
function solveArm(pose, side, pos, dir) {
  const bones = [`upperarm.${side}`, `lowerarm.${side}`, `wrist.${side}`];
  const slot = byName.get(`handslot.${side}`);
  const start = bones.map((b) => pose.get(`${b}|rotation`) ?? byName.get(b).getRotation());
  const params = new Float64Array(bones.length * 3);
  const axes = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const apply = () => {
    bones.forEach((b, i) => {
      let q = start[i];
      for (let a = 0; a < 3; a++) q = qmul(q, qaxis(axes[a], params[i * 3 + a]));
      pose.set(`${b}|rotation`, qnorm(q));
    });
  };
  const cost = () => {
    apply();
    const { p, q } = worldOf(pose, slot);
    const d = sub(p, pos);
    let c = dot(d, d) * 40;
    if (dir) {
      const y = qrot(q, [0, 1, 0]);
      c += (1 - dot(y, dir)) * 6;
    }
    for (let i = 0; i < params.length; i++) c += params[i] * params[i] * 0.02;
    return c;
  };
  let best = cost();
  for (let step = 0.3; step > 0.0005; step *= 0.6) {
    for (let pass = 0; pass < 40; pass++) {
      let improved = false;
      for (let i = 0; i < params.length; i++) {
        for (const s of [step, -step]) {
          params[i] += s;
          const c = cost();
          if (c < best - 1e-12) {
            best = c;
            improved = true;
          } else {
            params[i] -= s;
          }
        }
      }
      if (!improved) break;
    }
  }
  apply();
  return pose;
}

/** A copy of a pose with a bone's local rotation turned by `angle` about local `axis`. */
function turned(pose, bone, axis, angle) {
  const out = new Map(pose);
  const q = out.get(`${bone}|rotation`) ?? byName.get(bone).getRotation();
  out.set(`${bone}|rotation`, qnorm(qmul(q, qaxis(axis, angle))));
  return out;
}

// ---------------------------------------------------------------------------
// the rest: leaning on the planted mallet
// ---------------------------------------------------------------------------
// The knight faces +Z, his right is -X. His hands stack on the handle at shoulder height;
// the head stands on the ground ahead and a little right, so the handle slants forward
// and he leans onto it.
const GRIP = [-0.3, 1.02, 0.36];
const headAt = [-0.5, HEAD_RADIUS, 0.36 + 0.66];
const HANDLE = unit(sub(headAt, GRIP));
// Where the planted head's centre actually ends up: GRIP + HANDLE * HEAD_ALONG_HANDLE.
const HEAD = GRIP.map((v, i) => v + HANDLE[i] * HEAD_ALONG_HANDLE);

/** The lean on top of an Idle pose: back bent onto the mallet, both arms on the handle. */
function leaning(idlePose, armsFrom) {
  let pose = new Map(idlePose);
  // a slight forward bend at the spine and chest, weight onto the handle
  pose = turned(pose, 'spine', [1, 0, 0], 0.1);
  pose = turned(pose, 'chest', [1, 0, 0], 0.06);
  // the arms start from the chop's follow-through (both hands low on the handle), which
  // keeps the solve near a pose the rig was authored to make
  for (const b of ['upperarm', 'lowerarm', 'wrist', 'hand', 'handslot']) {
    for (const side of ['r', 'l']) {
      const key = `${b}.${side}|rotation`;
      const v = armsFrom.get(key);
      if (v) pose.set(key, v);
    }
  }
  solveArm(pose, 'r', GRIP, HANDLE);
  // the left hand rests on top of the right, a hand's width up the handle
  const right = worldOf(pose, byName.get('handslot.r'));
  const up = qrot(right.q, [0, -1, 0]);
  solveArm(
    pose,
    'l',
    right.p.map((v, i) => v + up[i] * 0.13),
    null,
  );
  return pose;
}

const P_follow = samplePose(chopIdx, 1.14);
const idleDur = Math.max(...[...idleIdx.values()].map((c) => c.times[c.times.length - 1]));
const REST_STEPS = 16;
const restPoses = [];
for (let s = 0; s <= REST_STEPS; s++) {
  // the Idle breath, stretched over the rest loop; the arm solve is per frame so the hands
  // stay on the handle while the chest rises and falls
  const tIdle = (s / REST_STEPS) * idleDur;
  restPoses.push(leaning(samplePose(idleIdx, tIdle), P_follow));
}
const P_all = mergePoses(restPoses[0], samplePose(idleIdx, 0), samplePose(chopIdx, 0.8));

const restTimeline = restPoses.map((pose, s) => [
  (s / REST_STEPS) * REST_SECONDS,
  (key) => poseValue(pose, key, P_all),
]);
const rest = bakeClip(doc, {
  clipName: 'Drill_Rest',
  channelKeys: allKeys,
  timeline: restTimeline,
  donorFor,
});

// ---------------------------------------------------------------------------
// the pound: up over the shoulder, down onto the ground, back to the lean
// ---------------------------------------------------------------------------
const P_rest = restPoses[0];
// The chop's windup, the head high behind his shoulder (0.49 s of 1.633).
const P_raise = samplePose(chopIdx, 0.49);
// Coming over (0.82 s): the head passing overhead.
const P_over = samplePose(chopIdx, 0.82);
// The chop's own contact frame (0.98 s) with the back bent further into the blow and
// the knees giving a little, so the drum meets the ground rather than stopping short.
const P_hit = turned(
  turned(samplePose(chopIdx, 0.98), 'spine', [1, 0, 0], 0.12),
  'chest',
  [1, 0, 0],
  0.08,
);
// ...and the arms solved so the head's centre sits a drum's radius above the ground,
// straight out ahead of him on his right.
{
  const { p, q } = worldOf(P_hit, byName.get('handslot.r'));
  const y = qrot(q, [0, 1, 0]);
  const head = p.map((v, i) => v + y[i] * HEAD_ALONG_HANDLE);
  const want = [head[0], HEAD_RADIUS, head[2]];
  const handle = unit(sub(want, p));
  solveArm(P_hit, 'r', p, handle);
}
const P_settle = samplePose(chopIdx, 1.14);

const pound = [[0, (k) => poseValue(P_rest, k, P_all)]];
const ramp = (fromTime, toTime, steps, ease, fromPose, toPose) =>
  pushPoseRamp(pound, { fromTime, toTime, steps, ease, fromPose, toPose, fallback: P_all });
ramp(0, 0.32, 6, easeInOutQuad, P_rest, P_raise);
ramp(0.32, 0.45, 3, (t) => t * t, P_raise, P_over);
ramp(0.45, IMPACT, 3, (t) => t * t, P_over, P_hit);
ramp(IMPACT, 0.78, 4, easeOutCubic, P_hit, P_settle);
ramp(0.78, 1.35, 8, easeInOutQuad, P_settle, P_rest);
const poundClip = bakeClip(doc, {
  clipName: 'Drill_Pound',
  channelKeys: allKeys,
  timeline: pound,
  donorFor,
});

// Report where the blow lands (model units: +Z ahead, -X to his right), which the sim's
// stake offset in src/sim/muster_drill.ts mirrors after the rig's scale.
{
  const { p, q } = worldOf(P_hit, byName.get('handslot.r'));
  const y = qrot(q, [0, 1, 0]);
  const head = p.map((v, i) => v + y[i] * HEAD_ALONG_HANDLE);
  const g = worldOf(P_rest, byName.get('handslot.r'));
  const gy = qrot(g.q, [0, 1, 0]);
  console.log(
    'rest head',
    g.p.map((v, i) => (v + gy[i] * HEAD_ALONG_HANDLE).toFixed(3)).join(','),
    'impact head',
    head.map((v) => v.toFixed(3)).join(','),
    'planned',
    HEAD.map((v) => v.toFixed(3)).join(','),
  );
}

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + clips): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, [rest.animation, poundClip.animation]);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);
const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
