// Backpedal (Woc_Walk_Back), hand-keyed per fit on the shared gait machinery.
//
// The game backpedals at 4.55 yd/s, so this is a quick backward jog rather
// than a walk, timed to the same beats as the reference: each foot reaches back
// high, lands on the ball behind the body, rolls flat and is picked up in front
// with the toes lifting. The torso stays turned a little to the right of the
// direction of travel, as if checking over the shoulder.
// Asymmetric postures cannot mirror, so the body is keyed over the full cycle.
//
// Male: a slight backward lean, hips and chest turned right, fists carried in
// front at the belt and pumping short with the steps.
// Female: lighter and quicker, hips square and swaying, the chest turned and
// tilted right, arms hanging nearly straight and swinging behind the hips.
import fs from 'node:fs';
import { gaitClip, rigSpeed } from './gait.mjs';

const ANATOMY = JSON.parse(
  fs.readFileSync(new URL('../../woc_character/export_split.json', import.meta.url), 'utf8'),
);
// The runtime's walkBackRef for WOC bodies: at 4.55 yd/s the clip plays at 1x.
const BACKPEDAL_SPEED_YD = 4.55;
const R = (at, elbow) => ({ at, elbow });

const FITS = {
  male: {
    period: 35 / 60,
    stance: 13 / 60,
    travel: [0, -1],
    contact: 0.2,
    track: 0.064,
    toeOut: -12,
    airYaw: -9,
    leftContact: 0.33,
    // Ball first behind the body, flat, then the toes lift as the foot leaves in front.
    stancePitch: [
      [0, -14],
      [0.25, 0],
      [0.75, 0],
      [1, 9],
    ],
    swing: [
      [0.2, -0.17, 0.17, 2, 0],
      [0.45, 0.04, 0.205, -8, 0],
      [0.7, 0.24, 0.19, -18, 0],
      [0.88, 0.29, 0.14, -20, 0],
    ],
    swingFlex: [6, -14],
    knee: { stance: 9, swing: 11 },
    cycle: [
      // Left foot lands behind; right fist back and low, left forward.
      {
        p: 0.33,
        pelvis: { pos: [0.006, 0.568, 0], rot: [-3, -9, 1] },
        spine: [-2, -4, -1],
        chest: [-3, -5, -1],
        neck: [2, 8, 0],
        head: [3, 10, 0],
        clav: { l: [0, 2], r: [0, -1] },
        reach: {
          r: R([-0.21, 0.54, -0.04], [-0.3, -0.2, -1]),
          l: R([0.165, 0.59, 0.1], [0.3, -0.3, -1]),
        },
        forearm: { l: 10, r: 10 },
        wrist: { l: [8, 4], r: [8, 4] },
      },
      {
        p: 0.46,
        pelvis: { pos: [0.008, 0.561, 0], rot: [-2, -12, 1.5] },
        spine: [-2, -5, -1],
        chest: [-3.5, -6, -1],
        neck: [2, 9, 0],
        head: [3, 11, 0],
      },
      {
        p: 0.58,
        pelvis: { pos: [0.002, 0.574, 0], rot: [-3.5, -16, 0.5] },
        spine: [-2.5, -6, -1],
        chest: [-4, -7, -1],
        neck: [2.5, 11, 0],
        head: [3.5, 13, 0],
        reach: {
          r: R([-0.18, 0.575, 0.06], [-0.3, -0.3, -1]),
          l: R([0.19, 0.56, 0.02], [0.3, -0.2, -1]),
        },
      },
      // Right foot lands behind; fists swap.
      {
        p: 0.83,
        pelvis: { pos: [-0.006, 0.568, 0], rot: [-3, -17, -1] },
        spine: [-2, -6, -1],
        chest: [-3, -6, -1],
        neck: [2, 11, 0],
        head: [3, 13, 0],
        clav: { l: [0, -1], r: [0, 2] },
        reach: {
          r: R([-0.16, 0.59, 0.1], [-0.3, -0.3, -1]),
          l: R([0.215, 0.54, -0.04], [0.3, -0.2, -1]),
        },
      },
      {
        p: 0.96,
        pelvis: { pos: [-0.008, 0.561, 0], rot: [-2, -14, -1.5] },
        spine: [-2, -5, -1],
        chest: [-3.5, -6, -1],
        neck: [2, 10, 0],
        head: [3, 12, 0],
      },
      {
        p: 0.08,
        pelvis: { pos: [-0.002, 0.574, 0], rot: [-3.5, -10, -0.5] },
        spine: [-2.5, -5, -1],
        chest: [-4, -6, -1],
        neck: [2.5, 9, 0],
        head: [3.5, 11, 0],
        reach: {
          r: R([-0.195, 0.56, 0.02], [-0.3, -0.2, -1]),
          l: R([0.18, 0.575, 0.06], [0.3, -0.3, -1]),
        },
      },
    ],
  },
  female: {
    period: 35 / 60,
    stance: 13 / 60,
    travel: [0, -1],
    contact: 0.2,
    track: 0.052,
    toeOut: -14,
    airYaw: -10,
    leftContact: 0.33,
    stancePitch: [
      [0, -14],
      [0.25, 0],
      [0.75, 0],
      [1, 9],
    ],
    swing: [
      [0.2, -0.17, 0.17, 2, 0],
      [0.45, 0.04, 0.205, -8, 0],
      [0.7, 0.24, 0.19, -18, 0],
      [0.88, 0.29, 0.14, -20, 0],
    ],
    swingFlex: [6, -14],
    knee: { stance: 9, swing: 11 },
    cycle: [
      {
        p: 0.33,
        pelvis: { pos: [0.005, 0.568, 0], rot: [-2.5, -8, 1] },
        spine: [-1.5, -3.5, -0.5],
        chest: [0, -2, 0],
        neck: [0.5, 6, 0],
        head: [2, 8, 0],
        clav: { l: [0, 2], r: [0, -1] },
        reach: {
          r: R([-0.175, 0.565, -0.02], [-0.3, -0.2, -1]),
          l: R([0.135, 0.59, 0.1], [0.3, -0.3, -1]),
        },
        forearm: { l: 10, r: 10 },
        wrist: { l: [8, 4], r: [8, 4] },
      },
      {
        p: 0.46,
        pelvis: { pos: [0.007, 0.561, 0], rot: [-1.5, -11, 1.5] },
        spine: [-1.5, -4.5, -0.5],
        chest: [-0.5, -3, 0],
        neck: [0.5, 7, 0],
        head: [2, 9, 0],
      },
      {
        p: 0.58,
        pelvis: { pos: [0.002, 0.574, 0], rot: [-3, -15, 0.5] },
        spine: [-2, -5.5, -0.5],
        chest: [-1, -4, 0],
        neck: [1, 9, 0],
        head: [2.5, 11, 0],
        reach: {
          r: R([-0.148, 0.575, 0.06], [-0.3, -0.3, -1]),
          l: R([0.158, 0.57, 0.02], [0.3, -0.2, -1]),
        },
      },
      {
        p: 0.83,
        pelvis: { pos: [-0.005, 0.568, 0], rot: [-2.5, -16, -1] },
        spine: [-1.5, -5.5, -0.5],
        chest: [0, -3, 0],
        neck: [0.5, 9, 0],
        head: [2, 11, 0],
        clav: { l: [0, -1], r: [0, 2] },
        reach: {
          r: R([-0.13, 0.59, 0.1], [-0.3, -0.3, -1]),
          l: R([0.178, 0.565, -0.02], [0.3, -0.2, -1]),
        },
      },
      {
        p: 0.96,
        pelvis: { pos: [-0.007, 0.561, 0], rot: [-1.5, -13, -1.5] },
        spine: [-1.5, -4.5, -0.5],
        chest: [-0.5, -3, 0],
        neck: [0.5, 8, 0],
        head: [2, 10, 0],
      },
      {
        p: 0.08,
        pelvis: { pos: [-0.002, 0.574, 0], rot: [-3, -9, -0.5] },
        spine: [-2, -4.5, -0.5],
        chest: [-1, -3, 0],
        neck: [1, 7, 0],
        head: [2.5, 9, 0],
        reach: {
          r: R([-0.16, 0.57, 0.02], [-0.3, -0.2, -1]),
          l: R([0.148, 0.575, 0.06], [0.3, -0.3, -1]),
        },
      },
    ],
  },
};

export function clip(fit, model) {
  return gaitClip({ ...FITS[fit], speed: rigSpeed(ANATOMY, fit, BACKPEDAL_SPEED_YD) }, model);
}
