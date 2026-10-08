// Arm jitter of a Balgath GLB clip: how hard the shoulder girdle and the arm shake
// frame to frame, read off the file the game loads (so a ship-time quantization or
// resample regression shows up here, not only an authoring one).
//
//   node scripts/assets/balgath_cyclops/arm_jitter.mjs <glb> [Clip,Clip]
//
// Every arm bone's WORLD rotation is sampled at the build rate (24 fps) the way the
// mixer samples it (linear keys, slerp), and differenced twice:
//
//   velocity      w_i = rotation vector of q_(i+1) * q_i^-1      (degrees per frame)
//   acceleration  a_i = w_(i+1) - w_i                            (degrees per frame^2)
//
// `maxAccel` is the largest |a_i|: a blow landing or a recoil is a big one, by design.
// `tremor` is the high-frequency part only: a frame whose acceleration flips direction
// against BOTH neighbours (a_(i-1), a_i, a_(i+1) zig-zag), scored by the smallest of the
// three. One impact is one flip and scores near nothing; a limb that oscillates between
// two poses on alternate frames (the 12 Hz shake of the first Blender build, about 24
// there) scores its full swing. The build fails a clip whose tremor passes
// ARM_TREMOR_LIMIT; review.py's `checks` mode applies the same measure in Blender.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder } from 'meshoptimizer';
import { createGlbIO, indexClip, sampleChannel } from '../../anim/pose_blend.mjs';

/** The bones measured, both sides: the girdle and the whole arm. */
export const ARM_JITTER_BONES = Object.freeze(
  ['L_', 'R_'].flatMap((s) => ['Clavicle', 'UpperArm', 'Forearm', 'Hand'].map((b) => s + b)),
);
/** Degrees per frame^2 of zig-zag acceleration a clip may carry on any arm bone. */
export const ARM_TREMOR_LIMIT = 2.5;
export const ARM_JITTER_FPS = 24;

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map((v) => v / l);
};

/** Rotation vector (degrees) of a unit quaternion, shortest way round. */
function rotVec(q) {
  const s = q[3] < 0 ? -1 : 1;
  const w = Math.min(1, q[3] * s);
  const ang = (2 * Math.acos(w) * 180) / Math.PI;
  const n = Math.sqrt(Math.max(0, 1 - w * w));
  if (n < 1e-9) return [0, 0, 0];
  return [(q[0] * s * ang) / n, (q[1] * s * ang) / n, (q[2] * s * ang) / n];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * Jitter of one rotation series (unit quaternions at a fixed rate): the largest
 * acceleration and the largest zig-zag (tremor), each with its frame.
 */
export function rotationJitter(qs) {
  const w = [];
  for (let i = 0; i + 1 < qs.length; i++) w.push(rotVec(qmul(qs[i + 1], qinv(qs[i]))));
  const a = [];
  for (let i = 0; i + 1 < w.length; i++) a.push(sub(w[i + 1], w[i]));
  let maxAccel = 0;
  let accelFrame = 0;
  a.forEach((v, i) => {
    if (len(v) > maxAccel) {
      maxAccel = len(v);
      accelFrame = i + 1;
    }
  });
  let tremor = 0;
  let tremorFrame = 0;
  for (let i = 1; i + 1 < a.length; i++) {
    if (dot(a[i - 1], a[i]) < 0 && dot(a[i], a[i + 1]) < 0) {
      const s = Math.min(len(a[i - 1]), len(a[i]), len(a[i + 1]));
      if (s > tremor) {
        tremor = s;
        tremorFrame = i + 1;
      }
    }
  }
  return { maxAccel, accelFrame, tremor, tremorFrame };
}

/** World rotation sampler for one clip of a gltf-transform Root (null clip: the rest pose). */
export function worldSampler(root, clipName) {
  const idx = clipName === null ? new Map() : indexClip(root, clipName);
  const parent = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parent.set(c, n);
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  let duration = 0;
  for (const ch of idx.values()) duration = Math.max(duration, ch.times[ch.times.length - 1]);
  const local = (node, t) => {
    const ch = idx.get(`${node.getName()}|rotation`);
    return qnorm(ch ? sampleChannel(ch, t) : node.getRotation());
  };
  return {
    duration,
    world(bone, t) {
      let node = byName.get(bone);
      if (!node) return null;
      let q = local(node, t);
      for (node = parent.get(node); node; node = parent.get(node)) q = qmul(local(node, t), q);
      return q;
    },
  };
}

/**
 * Per-bone jitter of every arm bone in one clip, plus the clip's worst. Times are in
 * seconds from the clip's start.
 */
export function clipArmJitter(root, clipName, fps = ARM_JITTER_FPS) {
  const s = worldSampler(root, clipName);
  // on the build's own frame grid: a clip of 0.85 s is keyed at 0, 1/24, ... 20/24 and
  // a stretched grid would read the linear keys between frames as a ripple
  const n = Math.max(2, Math.floor(s.duration * fps + 1e-6));
  const bones = {};
  let worst = { bone: '', tremor: 0, t: 0, maxAccel: 0 };
  for (const bone of ARM_JITTER_BONES) {
    const qs = [];
    for (let f = 0; f <= n; f++) {
      const q = s.world(bone, f / fps);
      if (!q) break;
      qs.push(q);
    }
    if (qs.length < 4) continue;
    const j = rotationJitter(qs);
    bones[bone] = j;
    if (j.tremor > worst.tremor)
      worst = { ...worst, bone, tremor: j.tremor, t: j.tremorFrame / fps };
    worst.maxAccel = Math.max(worst.maxAccel, j.maxAccel);
  }
  return { clip: clipName, duration: s.duration, bones, worst };
}

/** Every clip of a gltf-transform Root, measured. */
export function armJitterReport(root) {
  return root.listAnimations().map((a) => clipArmJitter(root, a.getName()));
}

/** The clips over the tremor limit, as readable lines (empty when the file is clean). */
export function armJitterFailures(report, limit = ARM_TREMOR_LIMIT) {
  return report
    .filter((r) => r.worst.tremor > limit)
    .map(
      (r) =>
        `${r.clip}: ${r.worst.bone} shakes ${r.worst.tremor.toFixed(2)} deg/frame^2 at ${r.worst.t.toFixed(2)} s (limit ${limit})`,
    );
}

const isMain =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [, , file, only] = process.argv;
  if (!file) {
    console.error('usage: arm_jitter.mjs <glb> [Clip,Clip]');
    process.exit(1);
  }
  await MeshoptDecoder.ready;
  const doc = await createGlbIO().readBinary(fs.readFileSync(file));
  const pick = only ? new Set(only.split(',')) : null;
  const report = armJitterReport(doc.getRoot()).filter((r) => !pick || pick.has(r.clip));
  for (const r of report) {
    const flag = r.worst.tremor > ARM_TREMOR_LIMIT ? 'FAIL' : 'ok  ';
    console.log(
      `JITTER ${r.clip.padEnd(22)} ${flag} tremor=${r.worst.tremor.toFixed(2)}@${r.worst.bone || '-'}@${r.worst.t.toFixed(2)} maxAccel=${r.worst.maxAccel.toFixed(1)}`,
    );
  }
  const fails = armJitterFailures(report);
  console.log('JITTER_FAILS', fails.length);
  process.exitCode = fails.length ? 1 : 0;
}
