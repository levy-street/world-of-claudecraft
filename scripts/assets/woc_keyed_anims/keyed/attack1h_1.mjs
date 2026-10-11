// Second one-handed swing (Woc_Attack_1H_1), hand-keyed per fit from the same
// guard as the first, at the reference's story beats.
//
// Male, "backhand cut": the sword comes up across his body to a chamber at the
// left shoulder with the blade upright, the torso wound hard to the left and
// the weight sunk; he unwinds into a backhand cut from upper left to lower
// right that finishes low behind his right hip, then settles back to guard.
// Female, "rising chop": she points the sword out to her right, lifts it high
// on the right with the front foot coming off the floor, stamps down into a
// deep lunge as the blade chops diagonally across to low left, sweeps it up
// across the front and returns to guard.
import { SWORD_FEET, SWORD_GUARD } from './attack1h.mjs';

const R = (at, elbow) => ({ at, elbow });
// Hand and elbow placed together (positions relative to the pelvis ground point).
const R2 = (at, elbowAt) => ({ at, elbowAt });

function male() {
  const guard = SWORD_GUARD.male;
  const { lead, rear } = SWORD_FEET.male;
  const keys = [
    { t: 0, ...guard },
    // Sword up and forward as the torso starts to wind left.
    {
      t: 0.1,
      pelvis: { pos: [-0.012, 0.54, -0.06], rot: [8, -16, 0] },
      spine: [12, 14, 0],
      chest: [14, 16, 0],
      neck: [-14, -6, 0],
      head: [-16, -8, 0],
      reach: {
        r: R([-0.36, 0.64, 0.22], [-0.8, -0.5, -0.3]),
        l: R([0.35, 0.55, -0.03], [0.6, -0.2, -1]),
      },
      blade: { r: [0.08, 0.33, 0.94] },
    },
    // Across the body, blade rising.
    {
      t: 0.22,
      pelvis: { pos: [0.03, 0.535, -0.08], rot: [8, 4, 0] },
      spine: [14, 30, -10],
      chest: [16, 38, -12],
      neck: [-14, -24, 4],
      head: [-16, -30, 4],
      clav: { r: [4, 10], l: [0, -6] },
      reach: {
        r: R([0.16, 0.77, 0.42], [-0.6, -0.6, -0.5]),
        l: R([0.24, 0.6, -0.2], [0.5, -0.3, -1]),
      },
      blade: { r: [0.4, 0.92, -0.06] },
    },
    // Chamber at the left shoulder: blade upright and back, weight sunk.
    {
      t: 0.38,
      ease: 0.6,
      pelvis: { pos: [0.015, 0.445, -0.04], rot: [6, 17, 2] },
      spine: [10, 36, -18],
      chest: [12, 44, -20],
      neck: [-10, -24, 8],
      head: [-12, -30, 8],
      clav: { r: [8, 12], l: [0, -8] },
      reach: {
        r: R([0.33, 0.81, 0.16], [-0.4, -0.7, -0.6]),
        l: R([0.1, 0.52, -0.27], [0.4, -0.3, -1]),
      },
      blade: { r: [-0.25, 0.86, -0.44] },
    },
    // Release: the hips lead, the blade starts to come round.
    {
      t: 0.53,
      pelvis: { pos: [-0.04, 0.46, -0.02], rot: [4, 6, 4] },
      spine: [8, 26, -12],
      chest: [8, 30, -14],
      neck: [-8, -16, 6],
      head: [-10, -20, 6],
      reach: {
        r: R([0.23, 0.88, 0.29], [-0.6, -0.6, -0.4]),
        l: R([0.14, 0.47, -0.24], [0.4, -0.3, -1]),
      },
      blade: { r: [0.35, 0.84, -0.41] },
    },
    // The cut: arm long across the front, blade forward and down to the right.
    {
      t: 0.62,
      ease: -1,
      pelvis: { pos: [-0.1, 0.53, -0.04], rot: [2, -9, 5] },
      spine: [0, 7, -1],
      chest: [0, 6, -1],
      neck: [-8, 6, 0],
      head: [-8, 6, 0],
      clav: { r: [0, 4], l: [0, 0] },
      reach: {
        r: R([-0.29, 0.6, 0.2], [-0.6, -0.8, 0]),
        l: R([0.26, 0.48, -0.05], [0.5, -0.3, -1]),
      },
      blade: { r: [-0.29, -0.31, 0.91] },
      bladeRange: { r: { sup: [-100, 40] } },
    },
    // Follow-through behind the right hip.
    {
      t: 0.72,
      ease: 0.5,
      pelvis: { pos: [-0.09, 0.54, -0.05], rot: [-1, -17, 5] },
      spine: [-2, -8, 2],
      chest: [-4, -10, 2],
      neck: [-4, 8, 0],
      head: [-4, 8, 0],
      clav: { r: [0, -4], l: [0, 0] },
      reach: {
        r: R([-0.21, 0.6, -0.37], [-0.3, -0.6, -1]),
        l: R([0.24, 0.55, 0.14], [0.6, -0.3, -1]),
      },
      blade: { r: [-0.72, -0.28, -0.63] },
    },
    {
      t: 0.85,
      ease: 0.6,
      pelvis: { pos: [-0.06, 0.535, -0.05], rot: [4, -23, 2] },
      spine: [4, -2, 0],
      chest: [6, -2, 0],
      neck: [-8, 6, 0],
      head: [-10, 6, 0],
      reach: {
        r: R([-0.28, 0.56, -0.24], [-0.4, -0.4, -1]),
        l: R([0.26, 0.55, 0.17], [0.6, -0.3, -1]),
      },
      blade: { r: [-0.75, -0.55, 0.0] },
    },
    { t: 1, ...guard },
    // Feet: planted; the lead heel lifts as the weight swings onto the rear leg.
    {
      t: 0,
      ease: 1,
      foot: {
        l: { pos: lead, pitch: 0, yaw: 18, knee: 6 },
        r: { pos: rear, pitch: 0, yaw: 32, knee: 8 },
      },
    },
    { t: 0.5, ease: 1, foot: { l: { pitch: 0 } } },
    { t: 0.61, ease: 0.6, foot: { l: { pitch: -16 } } },
    { t: 0.72, foot: { l: { pitch: -10 } } },
    { t: 0.82, ease: 1, foot: { l: { pitch: 0 } } },
    {
      t: 1,
      ease: 1,
      foot: {
        l: { pos: lead, pitch: 0, yaw: 18, knee: 6 },
        r: { pos: rear, pitch: 0, yaw: 32, knee: 8 },
      },
    },
  ];
  return {
    duration: 1,
    loop: false,
    family: 'attack',
    bladeTravel: 'arm',
    keys,
    lag: { 'arm.l': 0.03, 'elbow.l': 0.04, head: 0.025, neck: 0.015, 'blade.r': 0.012 },
  };
}

function female() {
  const guard = SWORD_GUARD.female;
  const { lead: front, rear: back } = SWORD_FEET.female;
  const keys = [
    { t: 0, ...guard },
    // The sword points out to her right.
    {
      t: 0.12,
      pelvis: { pos: [-0.02, 0.55, -0.04], rot: [1, -44, -2] },
      spine: [0, -8, -2],
      chest: [0, -10, -2],
      neck: [8, 22, 0],
      head: [10, 26, 0],
      reach: {
        r: R2([-0.23, 0.62, -0.28], [-0.08, 0.76, -0.27]),
        l: R2([-0.07, 0.75, 0.3], [0.13, 0.74, 0.22]),
      },
      blade: { r: [-0.5, 0.04, 0.87] },
    },
    {
      t: 0.22,
      pelvis: { pos: [-0.05, 0.565, -0.085], rot: [1, -47, -2] },
      spine: [-3, -14, -2],
      chest: [-4, -18, -2],
      neck: [10, 30, 0],
      head: [12, 36, 0],
      reach: {
        r: R2([-0.2, 0.76, -0.42], [-0.03, 0.84, -0.33]),
        l: R2([-0.14, 0.82, 0.4], [0.02, 0.82, 0.25]),
      },
      blade: { r: [-0.9, 0.01, 0.44] },
    },
    // Raised high on the right, the front foot off the floor.
    {
      t: 0.32,
      ease: 0.4,
      pelvis: { pos: [-0.06, 0.58, -0.1], rot: [1, -44, -2] },
      spine: [-5, -16, -2],
      chest: [-6, -20, -2],
      neck: [12, 32, 0],
      head: [14, 38, 0],
      clav: { r: [10, -4], l: [2, 2] },
      reach: {
        r: R2([-0.15, 0.94, -0.49], [-0.01, 0.91, -0.35]),
        l: R2([-0.13, 0.88, 0.4], [0.02, 0.87, 0.25]),
      },
      blade: { r: [-0.83, 0.46, 0.33] },
    },
    // Stamped down, blade cocked overhead.
    {
      t: 0.41,
      pelvis: { pos: [-0.02, 0.42, -0.01], rot: [1, -25, -2] },
      spine: [-3, 0, -3],
      chest: [-4, 1, -4],
      neck: [6, 8, 0],
      head: [8, 10, 0],
      clav: { r: [10, 0], l: [0, 0] },
      reach: {
        r: R2([-0.35, 1.0, -0.17], [-0.26, 0.85, -0.13]),
        l: R2([0.22, 0.63, 0.32], [0.24, 0.64, 0.11]),
      },
      blade: { r: [0.25, 0.79, -0.56] },
    },
    // The chop: deep lunge, blade coming down across her front.
    {
      t: 0.5,
      ease: -1,
      pelvis: { pos: [0.02, 0.35, 0.01], rot: [2, 8, -1] },
      spine: [10, 0, -6],
      chest: [12, 0, -8],
      neck: [-4, -4, 0],
      head: [-2, -4, 0],
      clav: { r: [2, 8], l: [-2, -4] },
      reach: {
        r: R2([-0.37, 0.67, 0.33], [-0.23, 0.68, 0.2]),
        l: R2([0.33, 0.38, 0.08], [0.27, 0.52, -0.05]),
      },
      blade: { r: [-0.82, 0.34, 0.46] },
    },
    // Low to the left, folded over the front knee.
    {
      t: 0.61,
      ease: 0.5,
      pelvis: { pos: [0.02, 0.35, -0.02], rot: [3, 8, 0] },
      spine: [18, 28, -10],
      chest: [20, 32, -12],
      neck: [-2, -12, 0],
      head: [0, -16, 0],
      clav: { r: [0, 10], l: [0, -6] },
      reach: {
        r: R2([0.23, 0.35, 0.29], [0.09, 0.46, 0.25]),
        l: R2([0.26, 0.51, -0.34], [0.16, 0.63, -0.19]),
      },
      blade: { r: [0.7, -0.56, 0.44] },
    },
    {
      t: 0.71,
      ease: 0.7,
      pelvis: { pos: [0.0, 0.37, -0.04], rot: [3, -4, 0] },
      spine: [16, 30, -10],
      chest: [18, 34, -12],
      neck: [-4, -14, 0],
      head: [-4, -18, 0],
      reach: {
        r: R2([0.18, 0.36, 0.25], [0.04, 0.44, 0.2]),
        l: R2([0.22, 0.49, -0.36], [0.15, 0.61, -0.2]),
      },
      blade: { r: [0.87, -0.44, 0.21] },
    },
    // Sweeping up across the front as she rises.
    {
      t: 0.82,
      pelvis: { pos: [0.0, 0.44, -0.04], rot: [3, -22, 0] },
      spine: [10, 22, -6],
      chest: [12, 24, -6],
      neck: [0, -6, 0],
      head: [2, -8, 0],
      reach: {
        r: R2([-0.01, 0.48, 0.31], [-0.13, 0.55, 0.18]),
        l: R2([0.29, 0.45, -0.17], [0.18, 0.64, -0.18]),
      },
      blade: { r: [0.99, -0.11, 0.09] },
    },
    { t: 1, ...guard },
    // Feet: the front foot lifts and stamps; the back heel rises into the lunge.
    {
      t: 0,
      ease: 1,
      foot: {
        l: {
          pos: front,
          ankle: [0.165, 0.085, 0.16],
          plant: 1,
          pitch: 0,
          yaw: -10,
          knee: 4,
          air: 0,
        },
        r: { pos: back, pitch: 0, yaw: 55, knee: 6 },
      },
    },
    { t: 0.18, ease: 1, foot: { l: { plant: 1, pitch: 0 } } },
    { t: 0.24, foot: { l: { plant: 1, pitch: -12 } } },
    {
      t: 0.31,
      foot: { l: { plant: 0, ankle: [0.16, 0.15, 0.115], pitch: -6, air: 0.4, flex: -10 } },
    },
    {
      t: 0.39,
      ease: 1,
      foot: { l: { plant: 1, pos: front, ankle: [0.165, 0.085, 0.16], pitch: 0, air: 0 } },
    },
    { t: 0.42, ease: 1, foot: { r: { pitch: 0 } } },
    { t: 0.5, ease: 0.6, foot: { r: { pitch: -24 } } },
    { t: 0.75, ease: 0.6, foot: { r: { pitch: -22 } } },
    { t: 0.92, ease: 1, foot: { r: { pitch: 0 } } },
    {
      t: 1,
      ease: 1,
      foot: {
        l: {
          pos: front,
          ankle: [0.165, 0.085, 0.16],
          plant: 1,
          pitch: 0,
          yaw: -10,
          knee: 4,
          air: 0,
        },
        r: { pos: back, pitch: 0, yaw: 55, knee: 6 },
      },
    },
  ];
  return {
    duration: 1,
    loop: false,
    family: 'attack',
    bladeTravel: 'arm',
    // The chop drives the blade in line with the forearm (as the reference does),
    // which needs more ulnar deviation than the default range allows.
    bladeLimits: { flex: [-75, 85], dev: [-75, 30] },
    keys,
    lag: { 'arm.l': 0.03, 'elbow.l': 0.04, head: 0.02, neck: 0.012, 'blade.r': 0.01 },
  };
}

export function clip(fit) {
  return fit === 'female' ? female() : male();
}
