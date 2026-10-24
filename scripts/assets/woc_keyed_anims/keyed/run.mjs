// Forward run, hand-keyed per fit.
//
// Built like an IK-foot run cycle and timed to the same beats as the imported
// reference: a short stance with the body's low point in mid-stance, then a
// long flight with the high point mid-air. Each planted foot travels back at
// exactly the game's run speed while it rolls heel, flat, ball and toe-off, so
// it cannot skate. The swing foot kicks up high behind first, passes low under
// the hip, reaches forward and paws back slightly into the next contact, joining
// the stance with matching velocity at both ends. Half a cycle of body keys
// (contact, down, toe-off, up) is authored and mirrored for the other step;
// hands are placed with `reach` and keyed as joint angles.
//
// Male: a heavy, bounding run with a forward lean, wide hips that turn hard
// against the chest, and wide pumping arms, high at both ends of the swing.
// Female: a quicker cadence, a much deeper forward lean, the chest held squarer
// while the hips turn, arms a little narrower and the stride a little shorter.
import fs from 'node:fs';
import { gaitClip, rigSpeed } from './gait.mjs';

const ANATOMY = JSON.parse(
  fs.readFileSync(new URL('../../woc_character/export_split.json', import.meta.url), 'utf8'),
);
// RUN_SPEED (7 yd/s) is the runtime's runRef: at that speed the clip plays at 1x,
// so the planted foot must move at it.
const RUN_SPEED_YD = 7;

const R = (at, elbow) => ({ at, elbow });

const FITS = {
  male: {
    // Whole 60 Hz frames, so contact and toe-off land exactly on baked keys.
    period: 48 / 60,
    stance: 9 / 60,
    contact: 0.14,
    track: 0.064,
    toeOut: -12,
    airYaw: -10,
    // Foot pitch through stance (fraction of stance): heel strike, flat, heel rise.
    stancePitch: [
      [0, 6],
      [0.22, 0],
      [0.55, 0],
      [0.82, -14],
      [1, -34],
    ],
    // Swing ankle keys: [fraction of swing, z, height, ankle flex relative to shin, lateral].
    swing: [
      [0.12, -0.35, 0.24, -34, 0],
      [0.27, -0.39, 0.36, -30, 0],
      [0.42, -0.26, 0.32, -18, 0],
      [0.57, -0.08, 0.22, -6, 0],
      [0.72, 0.12, 0.185, 2, 0],
      [0.86, 0.245, 0.15, 8, 0],
      [0.94, 0.21, 0.11, 10, 0],
    ],
    knee: { stance: 9, swing: 11 },
    // Half-cycle body keys at cycle phase (0 = left contact); the second half mirrors them.
    half: [
      {
        p: 0,
        pelvis: { pos: [0.008, 0.543, 0], rot: [8, -7, 1] },
        spine: [4, 7, 0.5],
        chest: [4, 9, 0.5],
        neck: [-3, -6, -0.5],
        head: [-4, -7, -0.5],
        clav: { l: [-1, -3], r: [1, 4] },
        reach: {
          r: R([-0.19, 0.63, 0.27], [-0.3, -0.5, -1]),
          l: R([0.24, 0.6, 0.03], [0.4, 0.1, -1]),
        },
        forearm: { l: 15, r: 15 },
        wrist: { l: [8, 4], r: [8, 4] },
      },
      {
        p: 0.09,
        pelvis: { pos: [0.012, 0.515, 0], rot: [10, 0, 2] },
        spine: [5, 0, 1],
        chest: [5, 0, 1],
        neck: [-4, 0, -1],
        head: [-5, 0, -1],
        clav: { l: [-2, 0], r: [-2, 0] },
        reach: {
          r: R([-0.215, 0.51, 0.13], [-0.3, -0.2, -1]),
          l: R([0.22, 0.525, 0.12], [0.3, -0.2, -1]),
        },
      },
      {
        p: 0.19,
        pelvis: { pos: [0.006, 0.545, 0], rot: [8, 8, 1] },
        spine: [4, -8, 0.5],
        chest: [3, -10, 0.5],
        neck: [-3, 8, 0],
        head: [-4, 9, 0],
        clav: { l: [1, 3], r: [-1, -3] },
        reach: {
          r: R([-0.23, 0.6, 0.04], [-0.4, 0.1, -1]),
          l: R([0.2, 0.62, 0.25], [0.3, -0.5, -1]),
        },
      },
      {
        p: 0.34,
        pelvis: { pos: [0, 0.598, 0], rot: [5, 14, 0] },
        spine: [2.5, -15, 0],
        chest: [2.5, -17, 0],
        neck: [-2, 14, 0],
        head: [-3, 17, 0],
        clav: { l: [3, 5], r: [2, -4] },
        reach: {
          r: R([-0.24, 0.69, -0.01], [-0.4, 0.3, -1]),
          l: R([0.17, 0.74, 0.35], [0.3, -0.6, -1]),
        },
      },
    ],
  },
  female: {
    period: 48 / 60,
    stance: 9 / 60,
    contact: 0.14,
    track: 0.052,
    toeOut: -14,
    airYaw: -10,
    stancePitch: [
      [0, 6],
      [0.22, 0],
      [0.55, 0],
      [0.82, -14],
      [1, -34],
    ],
    swing: [
      [0.12, -0.35, 0.24, -34, 0],
      [0.27, -0.39, 0.36, -30, 0],
      [0.42, -0.26, 0.32, -18, 0],
      [0.57, -0.08, 0.22, -6, 0],
      [0.72, 0.12, 0.185, 2, 0],
      [0.86, 0.245, 0.15, 8, 0],
      [0.94, 0.21, 0.11, 10, 0],
    ],
    knee: { stance: 9, swing: 11 },
    half: [
      {
        p: 0,
        pelvis: { pos: [0.007, 0.543, 0], rot: [7, -7, 1] },
        spine: [3.5, 6.5, 0.5],
        chest: [3, 8, 0.5],
        neck: [-2.5, -5.5, -0.5],
        head: [-3.5, -6.5, -0.5],
        clav: { l: [-1, -3], r: [1, 4] },
        reach: {
          r: R([-0.158, 0.63, 0.27], [-0.3, -0.5, -1]),
          l: R([0.208, 0.6, 0.03], [0.4, 0.1, -1]),
        },
        forearm: { l: 15, r: 15 },
        wrist: { l: [8, 4], r: [8, 4] },
      },
      {
        p: 0.09,
        pelvis: { pos: [0.01, 0.515, 0], rot: [9, 0, 2] },
        spine: [4.5, 0, 1],
        chest: [4, 0, 1],
        neck: [-3.5, 0, -1],
        head: [-4.5, 0, -1],
        clav: { l: [-2, 0], r: [-2, 0] },
        reach: {
          r: R([-0.183, 0.525, 0.13], [-0.3, -0.2, -1]),
          l: R([0.188, 0.525, 0.12], [0.3, -0.2, -1]),
        },
      },
      {
        p: 0.19,
        pelvis: { pos: [0.005, 0.545, 0], rot: [7, 8, 1] },
        spine: [3.5, -7.5, 0.5],
        chest: [2, -9, 0.5],
        neck: [-2.5, 7.5, 0],
        head: [-3.5, 8.5, 0],
        clav: { l: [1, 3], r: [-1, -3] },
        reach: {
          r: R([-0.198, 0.6, 0.04], [-0.4, 0.1, -1]),
          l: R([0.168, 0.62, 0.25], [0.3, -0.5, -1]),
        },
      },
      {
        p: 0.34,
        pelvis: { pos: [0, 0.598, 0], rot: [4.5, 13.5, 0] },
        spine: [2, -14, 0],
        chest: [1.5, -15, 0],
        neck: [-1.5, 13, 0],
        head: [-2.5, 16, 0],
        clav: { l: [3, 5], r: [2, -4] },
        reach: {
          r: R([-0.208, 0.69, -0.01], [-0.4, 0.3, -1]),
          l: R([0.138, 0.74, 0.35], [0.3, -0.6, -1]),
        },
      },
    ],
  },
};

export function clip(fit, model) {
  return gaitClip({ ...FITS[fit], speed: rigSpeed(ANATOMY, fit, RUN_SPEED_YD) }, model);
}
