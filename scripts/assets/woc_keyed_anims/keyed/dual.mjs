// Dual-wield swings (Woc_Attack_Dual, Woc_Attack_Dual#main, Woc_Attack_Dual#off),
// hand-keyed per fit at the reference's beats.
//
// The pair (and its main half, which is the same clip, as in the reference) is
// the one-hand swing (attack1h.mjs) with a second sword keyed into the left
// hand: the body, feet and right arm are that clip's keys unchanged.
// Male pair: the left sword lifts high as he coils, cocks back over the left
// shoulder and whips around flat beside the right blade's cleave, finishing
// low by his left hip. Female pair: the left sword rises and cocks back past
// her left ear while the right wraps, then swings round in front and across to
// her right before both return to guard.
// Off half, male: he coils left with the left sword raised high, the right
// foot stepping out wide, then drives it down diagonally across to his right
// knee, folding over it, and draws the foot back in.
// Off half, female: she turns her hips left with the left sword rising past
// her shoulder, then whips her hips and chest round to the right so the left
// blade sweeps flat across the front and wraps behind her right side, the
// right sword tucked back, before unwinding to guard.
// The pair's two blades and the off half's left blade peak on the same frame:
// the hit-time table needs one contact for all three.
import { clip as oneHand, SWORD_FEET } from './attack1h.mjs';
import { beats } from './beat.mjs';

const R = (at, elbowAt) => ({ at, elbowAt });

// The pair's left sword: [t, hand, elbow, blade].
const PAIR_LEFT = {
  male: [
    [0, [0.35, 0.66, 0.26], [0.27, 0.76, 0.09], [-0.18, -0.1, 0.98]],
    [0.1, [0.19, 0.88, 0.4], [0.19, 0.81, 0.2], [-0.55, 0.5, 0.67]],
    [0.2, [0.17, 1.06, 0.34], [0.12, 0.89, 0.23], [-0.13, 0.98, -0.11]],
    [0.3, [0.44, 1.1, 0.21], [0.25, 0.98, 0.19], [0.58, 0.52, -0.63]],
    [0.385, [0.51, 0.97, -0.17], [0.37, 0.85, -0.05], [-0.18, 0.47, -0.86]],
    [0.43, [0.57, 0.67, -0.12], [0.36, 0.69, -0.07], [0.66, 0.42, -0.63]],
    [0.48, [0.43, 0.42, -0.1], [0.3, 0.57, -0.07], [0.94, -0.27, -0.2]],
    [0.62, [0.35, 0.41, -0.15], [0.23, 0.58, -0.15], [0.86, -0.38, 0.33]],
    [0.8, [0.34, 0.5, -0.17], [0.21, 0.67, -0.16], [0.61, -0.28, 0.74]],
    [0.9, [0.36, 0.55, -0.01], [0.22, 0.71, -0.07], [0.38, -0.05, 0.92]],
    [1, [0.31, 0.52, 0.11], [0.21, 0.69, 0.03], [0.04, -0.16, 0.99]],
  ],
  female: [
    [0, [-0.06, 0.73, 0.22], [0.15, 0.72, 0.19], [-0.53, 0.84, -0.11]],
    [0.1, [0.17, 0.75, 0.19], [0.28, 0.72, 0.01], [-0.4, 0.89, 0.24]],
    [0.2, [0.32, 0.83, -0.08], [0.2, 0.68, -0.18], [-0.25, 0.94, -0.23]],
    [0.3, [0.35, 0.93, -0.17], [0.27, 0.74, -0.1], [-0.5, 0.25, -0.83]],
    [0.418, [0.41, 0.95, 0.06], [0.27, 0.8, 0.1], [0.15, 0.14, -0.98]],
    [0.5, [-0.02, 0.75, 0.51], [0.02, 0.72, 0.3], [0.55, 0.38, 0.74]],
    [0.68, [-0.16, 0.48, 0.32], [-0.06, 0.59, 0.2], [-0.86, -0.08, 0.5]],
    [0.8, [-0.14, 0.57, 0.27], [0.04, 0.63, 0.18], [-0.88, 0.46, 0.14]],
    [0.9, [-0.1, 0.69, 0.23], [0.11, 0.68, 0.19], [-0.52, 0.84, -0.14]],
    [1, [-0.07, 0.73, 0.22], [0.14, 0.71, 0.19], [-0.36, 0.92, -0.17]],
  ],
};

const LEFT_ONLY = ['arm', 'elbow', 'forearm', 'wrist', 'clav'];

/** The one-hand swing with its free left arm replaced by a keyed second sword. */
function pair(fit, model) {
  const base = oneHand(fit, model);
  const keys = base.keys.map((key) => {
    const out = { ...key };
    if (out.reach) {
      const { l, ...reach } = out.reach;
      out.reach = reach;
      if (!Object.keys(reach).length) delete out.reach;
    }
    for (const channel of LEFT_ONLY)
      if (out[channel]?.l !== undefined) {
        const { l, ...rest } = out[channel];
        out[channel] = rest;
      }
    return out;
  });
  for (const [t, at, elbowAt, blade] of PAIR_LEFT[fit])
    keys.push({ t, reach: { l: R(at, elbowAt) }, blade: { l: blade }, clav: { l: [0, 0] } });
  const { 'arm.l': _arm, 'elbow.l': _elbow, ...lag } = base.lag ?? {};
  return { ...base, keys, lag };
}

const OFF = {
  male: [
    {
      t: 0,
      P: [-0.03, 0.54, -0.04],
      r: [-3, -25, -1],
      T: [27, 25, -13],
      H: [5, 2],
      hR: [-0.35, 0.63, 0.01],
      eR: [-0.2, 0.75, -0.09],
      hL: [0.41, 0.66, 0.17],
      eL: [0.29, 0.76, 0.02],
      blade: { r: [-0.14, -0.09, 0.99], l: [0.06, -0.07, 1] },
    },
    // Coiled left, the left sword raised high.
    {
      t: 0.15,
      P: [-0.02, 0.57, 0.01],
      r: [-4, -25, -1],
      T: [6, 57, -29],
      H: [8, 5],
      hR: [-0.25, 0.75, 0.26],
      eR: [-0.21, 0.82, 0.06],
      hL: [0.49, 0.93, -0.13],
      eL: [0.3, 0.83, -0.14],
      blade: { r: [0.57, 0.19, 0.8], l: [0.45, 0.77, 0.45] },
    },
    {
      t: 0.25,
      P: [-0.02, 0.58, 0.04],
      r: [-2, -27, 0],
      T: [8, 58, -25],
      H: [8, 5],
      hR: [-0.23, 0.7, 0.28],
      eR: [-0.21, 0.78, 0.08],
      hL: [0.46, 1.07, -0.14],
      eL: [0.32, 0.93, -0.06],
      blade: { r: [0.54, 0.25, 0.8], l: [0, 0.94, -0.35] },
    },
    {
      t: 0.34,
      P: [-0.11, 0.5, 0.04],
      r: [2, -32, 1],
      T: [28, 38, -11],
      H: [4, 5],
      hR: [-0.32, 0.49, 0.14],
      eR: [-0.23, 0.63, 0],
      hL: [0.38, 1.07, 0.17],
      eL: [0.23, 0.93, 0.18],
      blade: { r: [-0.15, 0.11, 0.98], l: [0.24, 0.68, -0.69] },
    },
    // The cut: down across to the right knee.
    {
      t: 0.378,
      ease: -1,
      P: [-0.15, 0.45, 0.04],
      r: [4, -35, 2],
      T: [38, 23, -2],
      H: [4, 6],
      hR: [-0.32, 0.4, -0.01],
      eR: [-0.21, 0.57, -0.07],
      hL: [0.23, 1, 0.39],
      eL: [0.1, 0.84, 0.3],
      blade: { r: [-0.51, -0.13, 0.85], l: [0.58, 0.64, -0.51] },
    },
    {
      t: 0.428,
      ease: -1,
      P: [-0.14, 0.43, 0.03],
      r: [5, -37, 2],
      T: [48, 3, 10],
      H: [6, 8],
      hR: [-0.21, 0.4, -0.22],
      eR: [-0.14, 0.59, -0.16],
      hL: [-0.05, 0.62, 0.58],
      eL: [-0.05, 0.65, 0.37],
      blade: { r: [-0.74, -0.53, 0.41], l: [0.36, 0.45, 0.82] },
    },
    {
      t: 0.483,
      P: [-0.11, 0.42, 0.02],
      r: [6, -38, 3],
      T: [51, -20, 21],
      H: [9, 6],
      hR: [-0.08, 0.47, -0.32],
      eR: [-0.08, 0.63, -0.18],
      hL: [-0.13, 0.31, 0.36],
      eL: [-0.11, 0.5, 0.27],
      blade: { r: [-0.66, -0.75, -0.05], l: [-0.31, -0.52, 0.8] },
    },
    {
      t: 0.6,
      ease: 0.6,
      P: [-0.06, 0.45, -0.01],
      r: [4, -36, 2],
      T: [53, -33, 23],
      H: [14, 2],
      hR: [-0.06, 0.54, -0.35],
      eR: [-0.06, 0.68, -0.19],
      hL: [-0.05, 0.33, 0.28],
      eL: [-0.01, 0.53, 0.23],
      blade: { r: [-0.6, -0.79, -0.1], l: [-0.65, -0.63, 0.43] },
    },
    {
      t: 0.72,
      P: [-0.01, 0.51, -0.03],
      r: [1, -31, 1],
      T: [49, -15, 14],
      H: [13, -4],
      hR: [-0.18, 0.54, -0.31],
      eR: [-0.11, 0.71, -0.19],
      hL: [0.12, 0.45, 0.25],
      eL: [0.12, 0.65, 0.19],
      blade: { r: [-0.68, -0.66, 0.31], l: [-0.61, -0.57, 0.55] },
    },
    {
      t: 0.82,
      P: [-0.02, 0.53, -0.04],
      r: [-2, -27, 0],
      T: [38, 6, 1],
      H: [5, -6],
      hR: [-0.29, 0.53, -0.15],
      eR: [-0.17, 0.7, -0.14],
      hL: [0.28, 0.51, 0.16],
      eL: [0.21, 0.7, 0.07],
      blade: { r: [-0.58, -0.36, 0.73], l: [-0.25, -0.3, 0.92] },
    },
    {
      t: 0.92,
      ease: 0.6,
      P: [-0.04, 0.53, -0.05],
      r: [-3, -26, -1],
      T: [32, 13, -4],
      H: [2, 0],
      hR: [-0.32, 0.53, -0.09],
      eR: [-0.18, 0.7, -0.11],
      hL: [0.31, 0.52, 0.11],
      eL: [0.21, 0.69, 0.03],
      blade: { r: [-0.5, -0.23, 0.83], l: [0.04, -0.16, 0.99] },
    },
    {
      t: 1,
      ease: 1,
      P: [-0.04, 0.53, -0.05],
      r: [-3, -26, -1],
      T: [32, 13, -4],
      H: [2, 0],
      hR: [-0.32, 0.53, -0.09],
      eR: [-0.18, 0.7, -0.11],
      hL: [0.31, 0.52, 0.11],
      eL: [0.21, 0.69, 0.03],
      blade: { r: [-0.5, -0.23, 0.83], l: [0.04, -0.16, 0.99] },
    },
  ],
  female: [
    {
      t: 0,
      P: [-0.01, 0.55, -0.02],
      r: [-2, -37, -2],
      T: [4, -3, -3],
      H: [16, 0],
      hR: [-0.16, 0.54, -0.24],
      eR: [-0.06, 0.72, -0.21],
      hL: [-0.01, 0.73, 0.23],
      eL: [0.19, 0.72, 0.16],
      blade: { r: [-0.55, 0.09, 0.83], l: [-0.54, 0.84, 0.05] },
    },
    // Hips turn left, the left sword rising past her shoulder.
    {
      t: 0.1,
      P: [-0.01, 0.54, -0.04],
      r: [-1, -20, -2],
      T: [12, 24, -9],
      H: [27, 5],
      hR: [-0.22, 0.56, -0.2],
      eR: [-0.15, 0.75, -0.12],
      hL: [0.23, 0.73, 0.16],
      eL: [0.27, 0.72, -0.04],
      blade: { r: [0.01, -0.47, 0.88], l: [-0.24, 0.86, 0.45] },
    },
    {
      t: 0.2,
      P: [0, 0.5, -0.04],
      r: [-1, -4, -2],
      T: [14, 58, -12],
      H: [27, 7],
      hR: [-0.22, 0.52, 0.09],
      eR: [-0.2, 0.72, 0.03],
      hL: [0.3, 0.84, -0.14],
      eL: [0.16, 0.69, -0.19],
      blade: { r: [0.84, -0.05, 0.53], l: [-0.35, 0.93, -0.15] },
    },
    {
      t: 0.3,
      P: [0, 0.51, -0.03],
      r: [-2, -10, -2],
      T: [13, 73, -15],
      H: [24, 5],
      hR: [-0.06, 0.54, 0.27],
      eR: [-0.17, 0.66, 0.14],
      hL: [0.26, 0.95, -0.27],
      eL: [0.19, 0.77, -0.19],
      blade: { r: [0.85, 0.53, 0], l: [-0.79, 0.47, -0.39] },
    },
    {
      t: 0.38,
      P: [0, 0.53, 0.01],
      r: [-2, -30, -2],
      T: [15, 48, -20],
      H: [24, 6],
      hR: [-0.21, 0.6, 0.25],
      eR: [-0.21, 0.7, 0.08],
      hL: [0.44, 0.93, -0.03],
      eL: [0.29, 0.78, -0.02],
      blade: { r: [0.84, 0.38, 0.39], l: [-0.2, 0.5, -0.84] },
    },
    // The whip: hips and chest round to the right, the left blade flat across.
    {
      t: 0.43,
      ease: -1,
      P: [0, 0.53, 0.04],
      r: [-2, -52, -1],
      T: [18, 10, -20],
      H: [23, -6],
      hR: [-0.32, 0.67, 0.05],
      eR: [-0.2, 0.74, -0.1],
      hL: [0.36, 0.83, 0.36],
      eL: [0.2, 0.76, 0.22],
      blade: { r: [0.5, 0.39, 0.77], l: [0.62, 0.5, -0.6] },
    },
    {
      t: 0.47,
      ease: -1,
      P: [0, 0.5, 0.04],
      r: [-2, -69, -1],
      T: [27, -40, -9],
      H: [24, -34],
      hR: [-0.22, 0.66, -0.19],
      eR: [-0.03, 0.73, -0.21],
      hL: [-0.27, 0.71, 0.44],
      eL: [-0.15, 0.72, 0.27],
      blade: { r: [-0.22, 0.48, 0.85], l: [0.25, 0.22, 0.94] },
    },
    {
      t: 0.515,
      P: [0, 0.46, 0.03],
      r: [-2, -86, 0],
      T: [28, -70, -6],
      H: [20, -58],
      hR: [-0.02, 0.66, -0.26],
      eR: [0.15, 0.71, -0.15],
      hL: [-0.5, 0.63, 0.02],
      eL: [-0.3, 0.66, 0.05],
      blade: { r: [-0.7, 0.46, 0.54], l: [-0.94, 0.1, 0.33] },
    },
    {
      t: 0.6,
      ease: 0.6,
      P: [0, 0.47, -0.01],
      r: [-2, -90, 0],
      T: [24, -91, 1],
      H: [9, -88],
      hR: [0.24, 0.61, -0.11],
      eR: [0.23, 0.75, 0.04],
      hL: [-0.34, 0.47, -0.19],
      eL: [-0.22, 0.58, -0.09],
      blade: { r: [-0.93, 0.13, -0.35], l: [-0.62, -0.13, -0.78] },
    },
    {
      t: 0.7,
      P: [0, 0.5, -0.01],
      r: [-2, -75, 1],
      T: [18, -84, 8],
      H: [5, -77],
      hR: [0.33, 0.58, -0.12],
      eR: [0.23, 0.75, -0.03],
      hL: [-0.28, 0.48, -0.13],
      eL: [-0.17, 0.6, -0.01],
      blade: { r: [-0.76, -0.29, -0.58], l: [-0.49, -0.01, -0.87] },
    },
    // Unwinding to guard.
    {
      t: 0.8,
      P: [0, 0.53, -0.01],
      r: [-3, -56, 1],
      T: [10, -44, 7],
      H: [9, -36],
      hR: [0.13, 0.51, -0.3],
      eR: [0.11, 0.7, -0.2],
      hL: [-0.25, 0.61, 0.12],
      eL: [-0.06, 0.67, 0.18],
      blade: { r: [-0.98, -0.18, 0.02], l: [-0.7, 0.51, -0.5] },
    },
    {
      t: 0.9,
      P: [0, 0.54, -0.01],
      r: [-2, -43, 0],
      T: [2, -12, 0],
      H: [11, -3],
      hR: [-0.14, 0.51, -0.26],
      eR: [-0.03, 0.69, -0.22],
      hL: [-0.09, 0.72, 0.22],
      eL: [0.12, 0.7, 0.19],
      blade: { r: [-0.7, 0.2, 0.69], l: [-0.42, 0.9, -0.15] },
    },
    {
      t: 1,
      ease: 0.8,
      P: [0, 0.54, -0.01],
      r: [-2, -42, 0],
      T: [1, -10, -1],
      H: [11, -1],
      hR: [-0.16, 0.52, -0.25],
      eR: [-0.04, 0.69, -0.22],
      hL: [-0.07, 0.73, 0.22],
      eL: [0.14, 0.71, 0.19],
      blade: { r: [-0.64, 0.23, 0.74], l: [-0.36, 0.92, -0.16] },
    },
  ],
};

function offFeet(fit) {
  const { lead, rear } = SWORD_FEET[fit];
  if (fit === 'female') {
    const rest = {
      l: { pos: lead, pitch: 0, yaw: -25, knee: 4 },
      r: { pos: rear, pitch: 0, yaw: 40, knee: 6 },
    };
    // Planted; the rear heel lifts a little as the hips whip round.
    return [
      { t: 0, ease: 1, foot: rest },
      { t: 0.38, ease: 1, foot: { r: { pos: rear, pitch: 0 } } },
      { t: 0.5, foot: { r: { pos: rear, pitch: -10 } } },
      { t: 0.68, foot: { r: { pos: rear, pitch: -8 } } },
      { t: 0.85, ease: 1, foot: { r: { pos: rear, pitch: 0 } } },
      { t: 1, ease: 1, foot: rest },
    ];
  }
  const rest = {
    l: { pos: lead, pitch: 0, yaw: -16, knee: 6 },
    r: { pos: rear, pitch: 0, yaw: 24, knee: 8 },
  };
  const wide = [-0.292, 0, -0.193];
  // The rear foot steps out wide under the coil and back in after the cut.
  return [
    { t: 0, ease: 1, foot: rest },
    { t: 0.08, ease: 1, foot: { r: { pos: rear, pitch: 0 } } },
    { t: 0.13, foot: { r: { pos: [-0.185, 0.012, -0.226], pitch: -10 } } },
    { t: 0.2, foot: { r: { pos: [-0.215, 0.04, -0.215], pitch: -12 } } },
    { t: 0.27, foot: { r: { pos: [-0.27, 0.03, -0.2], pitch: -4 } } },
    { t: 0.33, ease: 1, foot: { r: { pos: wide, pitch: 0, yaw: 24 } } },
    { t: 0.7, ease: 1, foot: { r: { pos: wide, pitch: 0 } } },
    { t: 0.75, foot: { r: { pos: [-0.27, 0.01, -0.199], pitch: -4 } } },
    { t: 0.81, foot: { r: { pos: [-0.225, 0.012, -0.212], pitch: -4 } } },
    { t: 0.87, ease: 1, foot: { r: { pos: rear, pitch: 0 } } },
    { t: 1, ease: 1, foot: rest },
  ];
}

function off(fit, model) {
  const key = beats(model);
  return {
    duration: 1,
    loop: false,
    family: 'attack',
    bladeTravel: 'arm',
    bladeLimits: { flex: [-75, 85], dev: [-60, 30] },
    keys: [
      ...OFF[fit].map(({ t, ...b }) => key(t, { clav: { l: [0, 0], r: [0, 0] }, ...b })),
      ...offFeet(fit),
    ],
    lag: { head: 0.02, neck: 0.012 },
  };
}

export const dualPair = { clip: pair };
export const dualOff = { clip: off };
