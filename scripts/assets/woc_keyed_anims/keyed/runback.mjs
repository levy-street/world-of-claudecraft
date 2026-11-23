// Backward run (Woc_Run_Back), hand-keyed per fit on the shared gait machinery.
// The game does not play this clip; it is kept for animation tools.
//
// Same beats as the reference: each foot pushes off in front, carries on
// forward and up as it leaves, swings back high under the body, reaches far
// behind and lands on the ball. A long flight between steps, the low point just
// after touchdown, the high point mid-air, the body leaning back and the arms
// pumping hard, the forward fist rising to the chin.
// Planted feet travel at the clip's own ground speed, matched to the reference
// cadence (the runtime has no backward-run speed to match).
//
// Male: big, bounding strides with a strong hip turn against the chest and
// arms pumping high.
// Female: the same rhythm with a squarer chest, a little less lean and arms
// carried slightly lower and wider.
import { gaitClip } from './gait.mjs';

const R = (at, elbow) => ({ at, elbow });

const FITS = {
  male: {
    period: 68 / 60,
    stance: 11 / 60,
    speed: 2.2,
    travel: [0, -1],
    contact: 0.2,
    track: 0.068,
    toeOut: 5,
    leftContact: 0.48,
    stancePitch: [
      [0, -18],
      [0.3, 0],
      [0.7, 0],
      [1, 10],
    ],
    swing: [
      [0.15, -0.28, 0.18, 4],
      [0.35, -0.1, 0.205, -4],
      [0.6, 0.25, 0.27, -16],
      [0.78, 0.35, 0.27, -22],
      [0.92, 0.3, 0.16, -22],
    ],
    swingFlex: [8, -18],
    knee: { stance: 4, swing: 8 },
    half: [
      // Left lands behind: hips turned left, chest right.
      {
        p: 0.48,
        pelvis: { pos: [0.01, 0.53, 0], rot: [-4, 6, 1] },
        spine: [-3, -5, 0.5],
        chest: [-3, -6, 0.5],
        neck: [5, 0, 0],
        head: [6, 0, 0],
        clav: { l: [-1, 0], r: [-1, 0] },
        reach: {
          r: R([-0.22, 0.56, 0.06], [-0.3, -0.3, -1]),
          l: R([0.2, 0.62, 0.14], [0.3, -0.4, -1]),
        },
        forearm: { l: 15, r: 15 },
        wrist: { l: [8, 4], r: [8, 4] },
      },
      // The low point over the planted foot.
      {
        p: 0.53,
        pelvis: { pos: [0.014, 0.515, 0], rot: [-3, 2, 1.5] },
        spine: [-2.5, -6, 0.5],
        chest: [-2.5, -7, 0.5],
        neck: [4, 2, 0],
        head: [5, 3, 0],
      },
      // Rising off the front foot.
      {
        p: 0.68,
        pelvis: { pos: [0.005, 0.56, 0], rot: [-4, -8, 0.5] },
        spine: [-3, 6, 0],
        chest: [-3, 7, 0],
        neck: [5, -6, 0],
        head: [6, -7, 0],
        reach: {
          r: R([-0.2, 0.66, 0.19], [-0.3, -0.5, -1]),
          l: R([0.225, 0.58, 0.04], [0.3, -0.2, -1]),
        },
      },
      // High point: right fist up at the chin, left back.
      {
        p: 0.82,
        pelvis: { pos: [0, 0.598, 0], rot: [-6, -14, 0] },
        spine: [-4, 14, 0],
        chest: [-4, 16, 0],
        neck: [7, -13, 0],
        head: [8, -15, 0],
        clav: { l: [1, -2], r: [3, 5] },
        reach: {
          r: R([-0.158, 0.78, 0.268], [-0.3, -0.6, -1]),
          l: R([0.2, 0.64, -0.035], [0.3, 0.2, -1]),
        },
      },
    ],
  },
  female: {
    period: 68 / 60,
    stance: 11 / 60,
    speed: 2.15,
    travel: [0, -1],
    contact: 0.2,
    track: 0.066,
    toeOut: 4,
    leftContact: 0.43,
    stancePitch: [
      [0, -18],
      [0.3, 0],
      [0.7, 0],
      [1, 9],
    ],
    swing: [
      [0.15, -0.27, 0.17, 4],
      [0.35, -0.1, 0.19, -4],
      [0.6, 0.22, 0.24, -16],
      [0.78, 0.31, 0.24, -22],
      [0.92, 0.27, 0.15, -22],
    ],
    swingFlex: [8, -18],
    knee: { stance: 2, swing: 5 },
    half: [
      {
        p: 0.43,
        pelvis: { pos: [0.003, 0.53, 0], rot: [-2, 5, 0.5] },
        spine: [-1.5, -3, 0],
        chest: [-1.5, -3, 0],
        neck: [4, 0, 0],
        head: [5, 0, 0],
        clav: { l: [-1, 0], r: [-1, 0] },
        reach: {
          r: R([-0.25, 0.61, 0.03], [-0.3, -0.3, -1]),
          l: R([0.18, 0.66, 0.17], [0.3, -0.4, -1]),
        },
        forearm: { l: 20, r: 20 },
        wrist: { l: [10, 4], r: [10, 4] },
      },
      {
        p: 0.48,
        pelvis: { pos: [0.004, 0.515, 0], rot: [-1.5, 1, 1] },
        spine: [-1, -2, 0],
        chest: [-1, -2, 0],
        neck: [3, 1, 0],
        head: [4, 1, 0],
      },
      {
        p: 0.63,
        pelvis: { pos: [0.002, 0.56, 0], rot: [-2, -9, 0.5] },
        spine: [-1.5, 4, 0],
        chest: [-1.5, 5, 0],
        neck: [4, -4, 0],
        head: [5, -5, 0],
        reach: {
          r: R([-0.2, 0.68, 0.18], [-0.3, -0.5, -1]),
          l: R([0.235, 0.62, 0.02], [0.3, -0.2, -1]),
        },
      },
      {
        p: 0.77,
        pelvis: { pos: [0, 0.588, 0], rot: [-4, -13, 0] },
        spine: [-2.5, 9, 0],
        chest: [-2.5, 10, 0],
        neck: [6, -8, 0],
        head: [7, -10, 0],
        clav: { l: [1, -2], r: [3, 4] },
        reach: {
          r: R([-0.17, 0.77, 0.215], [-0.3, -0.6, -1]),
          l: R([0.21, 0.66, -0.035], [0.3, 0.2, -1]),
        },
      },
    ],
  },
};

export function clip(fit, model) {
  return gaitClip(FITS[fit], model);
}
