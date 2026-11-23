// Forward walk (Woc_Walk), hand-keyed per fit on the shared gait machinery.
//
// Same beats as the reference: heel strike with the toes up, a dip as the
// weight loads, the high point over the standing foot, heel rise and toe-off;
// a low swing that lifts just after toe-off and lowers into the next heel. The
// planted foot travels at the game's walk speed (2.2 yd/s), so it cannot skate.
// Body keys cover half a cycle from the left heel strike and mirror for the right.
//
// Male: upright and unhurried, a modest hip turn against the chest, arms
// hanging almost straight and swinging from the shoulder.
// Female: a quicker, narrower step that crosses toward the midline, more hip
// sway and drop, a slight forward lean, elbows softly bent with the hands
// carried a little out from the hips.
import fs from 'node:fs';
import { gaitClip, rigSpeed } from './gait.mjs';

const ANATOMY = JSON.parse(
  fs.readFileSync(new URL('../../woc_character/export_split.json', import.meta.url), 'utf8'),
);
// The runtime's walkRef: at 2.2 yd/s the clip plays at 1x.
const WALK_SPEED_YD = 2.2;

const FITS = {
  male: {
    period: 79 / 60,
    stance: 37 / 60,
    contact: 0.25,
    track: 0.064,
    toeOut: -12,
    airYaw: -10,
    leftContact: 0.24,
    stancePitch: [
      [0, 16],
      [0.16, 0],
      [0.55, 0],
      [0.82, -18],
      [1, -44],
    ],
    swing: [
      [0.18, -0.24, 0.2, -26, 0],
      [0.42, -0.05, 0.165, -10, 0],
      [0.68, 0.14, 0.13, 4, 0],
      [0.88, 0.23, 0.112, 12, 0],
    ],
    swingFlex: [-26, 14],
    knee: { stance: 9, swing: 11 },
    half: [
      // Left heel strike: right arm forward, left back, hips turned into the step.
      {
        p: 0.24,
        pelvis: { pos: [0.003, 0.566, 0], rot: [0, -6, -0.5] },
        spine: [0, 7, 0],
        chest: [-1.5, 8, 0],
        neck: [0.5, -4, 0],
        head: [1, -5, 0],
        clav: { l: [-1, -2], r: [-1, 3] },
        arm: { r: { flex: 23, abd: 7, twist: 8 }, l: { flex: -24, abd: 9, twist: 4 } },
        elbow: { r: 22, l: 12 },
        forearm: { l: -5, r: -5 },
        wrist: { l: [6, 0], r: [6, 0] },
      },
      // Weight loads onto the left leg: the low point.
      {
        p: 0.32,
        pelvis: { pos: [0.006, 0.559, 0], rot: [0.5, -4.5, -1.5] },
        spine: [0.5, 6, 0],
        chest: [-1, 6.5, 0],
        neck: [0.5, -3, 0],
        head: [1, -4, 0],
      },
      // Over the left foot: the high point, arms passing.
      {
        p: 0.49,
        pelvis: { pos: [0.008, 0.577, 0], rot: [0, 0.5, -1.5] },
        spine: [0, -0.5, 0],
        chest: [-1.5, -1, 0],
        neck: [0.5, 0, 0],
        head: [1, 0.5, 0],
        clav: { l: [-1, 0], r: [-1, 0] },
        arm: { r: { flex: 0, abd: 7, twist: 6 }, l: { flex: 0, abd: 8, twist: 6 } },
        elbow: { r: 16, l: 16 },
      },
    ],
  },
  female: {
    period: 75 / 60,
    stance: 35 / 60,
    contact: 0.24,
    track: 0.048,
    toeOut: -14,
    airYaw: -10,
    leftContact: 0.24,
    stancePitch: [
      [0, 15],
      [0.16, 0],
      [0.55, 0],
      [0.82, -18],
      [1, -42],
    ],
    swing: [
      [0.18, -0.23, 0.19, -26, 0],
      [0.42, -0.05, 0.16, -10, 0],
      [0.68, 0.14, 0.13, 4, 0],
      [0.88, 0.22, 0.11, 12, 0],
    ],
    swingFlex: [-24, 14],
    knee: { stance: 9, swing: 11 },
    half: [
      {
        p: 0.24,
        pelvis: { pos: [0.004, 0.564, 0], rot: [1, -6, -0.8] },
        spine: [0.5, 6, 0],
        chest: [1.5, 6, 0.5],
        neck: [-1.5, -3, 0],
        head: [-1, -3.5, 0],
        clav: { l: [-1, -2], r: [-1, 3] },
        arm: { r: { flex: 23, abd: 7, twist: 8 }, l: { flex: -24, abd: 9, twist: 4 } },
        elbow: { r: 22, l: 12 },
        forearm: { l: -2, r: -2 },
        wrist: { l: [6, 0], r: [6, 0] },
      },
      {
        p: 0.32,
        pelvis: { pos: [0.007, 0.556, 0], rot: [1.5, -4.5, -1.8] },
        spine: [1, 5, 0.4],
        chest: [2, 5, 0.8],
        neck: [-1.5, -2, 0],
        head: [-1, -2.5, 0],
      },
      {
        p: 0.49,
        pelvis: { pos: [0.009, 0.576, 0], rot: [1, 0.5, -1.5] },
        spine: [0.5, -0.5, 0.3],
        chest: [1.5, -1, 0.6],
        neck: [-1.5, 0, 0],
        head: [-1, 0.5, 0],
        clav: { l: [-1, 0], r: [-1, 0] },
        arm: { r: { flex: 0, abd: 7, twist: 6 }, l: { flex: 0, abd: 8, twist: 6 } },
        elbow: { r: 16, l: 16 },
      },
    ],
  },
};

export function clip(fit, model) {
  return gaitClip({ ...FITS[fit], speed: rigSpeed(ANATOMY, fit, WALK_SPEED_YD) }, model, {
    lag: {
      arm: 0.06,
      clav: 0.04,
      elbow: 0.1,
      forearm: 0.1,
      wrist: 0.12,
      chest: 0.02,
      neck: 0.04,
      head: 0.06,
    },
  });
}
