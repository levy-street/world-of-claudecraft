// Crouching (Woc_Crouch_Idle and the eight Woc_Crouch_* directions),
// hand-keyed per fit at the reference's beats.
//
// Idle: a low, coiled ready stance in the sword stance's footing, shoulders
// rolling a little as the weight shifts. Walk: a slow sneak, one long stride a
// side per loop: the swinging foot lifts high and reaches forward toes-down,
// sets down flat, and slides back under the body as the heel peels up late,
// the hips and chest counter-rotating with each step and the hands held ready.
// The eight directions are the same sneak with the whole body turned to face
// the way it goes (as in the reference); `turned` rotates these keys about the
// vertical axis, so each direction is this one authored walk.
import { beats } from './beat.mjs';

const WALK = {
  male: [
    {
      t: 0,
      P: [-0.01, 0.47, 0.02],
      r: [0, 0, -5],
      T: [41, -23, 4],
      H: [13, -3, 3],
      hR: [-0.3, 0.56, -0.06],
      eR: [-0.17, 0.73, -0.09],
      hL: [0.14, 0.57, 0.39],
      eL: [0.2, 0.64, 0.19],
      blade: { r: [-0.64, -0.24, 0.73], l: [-0.85, 0.23, 0.48] },
      bladeFace: { r: [-0.58, 0.77, -0.26], l: [0.3, 0.95, 0.08] },
    },
    {
      t: 0.27,
      P: [-0.01, 0.46, 0.02],
      r: [0, -3, -5],
      T: [42, -18, 1],
      H: [12, -2, 3],
      hR: [-0.3, 0.55, -0.05],
      eR: [-0.18, 0.73, -0.08],
      hL: [0.14, 0.56, 0.38],
      eL: [0.2, 0.64, 0.19],
      blade: { r: [-0.6, -0.26, 0.75], l: [-0.85, 0.23, 0.47] },
      bladeFace: { r: [-0.61, 0.76, -0.22], l: [0.31, 0.95, 0.09] },
    },
    {
      t: 0.53,
      P: [-0.01, 0.47, 0.02],
      r: [0, -7, -3],
      T: [43, -9, -3],
      H: [11, -1, 1],
      hR: [-0.3, 0.55, -0.03],
      eR: [-0.19, 0.74, -0.07],
      hL: [0.14, 0.57, 0.37],
      eL: [0.2, 0.64, 0.18],
      blade: { r: [-0.53, -0.31, 0.79], l: [-0.85, 0.24, 0.48] },
      bladeFace: { r: [-0.65, 0.74, -0.14], l: [0.33, 0.94, 0.12] },
    },
    {
      t: 0.8,
      P: [0, 0.49, 0.02],
      r: [0, -10, 0],
      T: [44, -4, -6],
      H: [10, 0, 0],
      hR: [-0.3, 0.57, -0.02],
      eR: [-0.2, 0.76, -0.06],
      hL: [0.13, 0.58, 0.36],
      eL: [0.2, 0.66, 0.17],
      blade: { r: [-0.45, -0.36, 0.82], l: [-0.84, 0.24, 0.49] },
      bladeFace: { r: [-0.69, 0.72, -0.06], l: [0.34, 0.93, 0.13] },
    },
    {
      t: 1.07,
      P: [0.01, 0.49, 0.02],
      r: [0, -8, 3],
      T: [44, -7, -5],
      H: [11, 0, 0],
      hR: [-0.3, 0.58, -0.02],
      eR: [-0.21, 0.77, -0.06],
      hL: [0.13, 0.59, 0.37],
      eL: [0.19, 0.66, 0.17],
      blade: { r: [-0.43, -0.37, 0.82], l: [-0.83, 0.24, 0.5] },
      bladeFace: { r: [-0.7, 0.71, -0.05], l: [0.34, 0.93, 0.11] },
    },
    {
      t: 1.33,
      P: [0.01, 0.48, 0.02],
      r: [0, -4, 5],
      T: [42, -16, -1],
      H: [12, -1, 0],
      hR: [-0.31, 0.57, -0.04],
      eR: [-0.21, 0.76, -0.08],
      hL: [0.13, 0.58, 0.38],
      eL: [0.19, 0.65, 0.18],
      blade: { r: [-0.46, -0.34, 0.82], l: [-0.83, 0.24, 0.5] },
      bladeFace: { r: [-0.69, 0.72, -0.09], l: [0.33, 0.94, 0.08] },
    },
    {
      t: 1.6,
      P: [0.01, 0.46, 0.02],
      r: [0, 2, 5],
      T: [41, -26, 4],
      H: [13, -1, 0],
      hR: [-0.3, 0.56, -0.06],
      eR: [-0.2, 0.75, -0.09],
      hL: [0.13, 0.56, 0.39],
      eL: [0.19, 0.63, 0.19],
      blade: { r: [-0.51, -0.33, 0.79], l: [-0.83, 0.23, 0.51] },
      bladeFace: { r: [-0.67, 0.74, -0.13], l: [0.32, 0.95, 0.08] },
    },
    {
      t: 1.87,
      P: [0.01, 0.46, 0.02],
      r: [0, 7, 3],
      T: [42, -37, 9],
      H: [13, -1, 0],
      hR: [-0.3, 0.57, -0.08],
      eR: [-0.18, 0.76, -0.1],
      hL: [0.13, 0.54, 0.4],
      eL: [0.19, 0.62, 0.2],
      blade: { r: [-0.6, -0.33, 0.73], l: [-0.83, 0.2, 0.52] },
      bladeFace: { r: [-0.62, 0.77, -0.17], l: [0.3, 0.95, 0.11] },
    },
    {
      t: 2.13,
      P: [0, 0.48, 0.02],
      r: [0, 10, 1],
      T: [42, -44, 13],
      H: [12, -1, -1],
      hR: [-0.29, 0.6, -0.1],
      eR: [-0.17, 0.78, -0.1],
      hL: [0.14, 0.55, 0.4],
      eL: [0.19, 0.64, 0.2],
      blade: { r: [-0.67, -0.31, 0.68], l: [-0.83, 0.17, 0.53] },
      bladeFace: { r: [-0.57, 0.79, -0.2], l: [0.27, 0.95, 0.13] },
    },
    {
      t: 2.4,
      P: [-0.01, 0.49, 0.02],
      r: [0, 8, -2],
      T: [42, -41, 12],
      H: [12, -1, 0],
      hR: [-0.29, 0.61, -0.1],
      eR: [-0.17, 0.78, -0.1],
      hL: [0.15, 0.57, 0.4],
      eL: [0.2, 0.65, 0.2],
      blade: { r: [-0.69, -0.28, 0.67], l: [-0.83, 0.17, 0.54] },
      bladeFace: { r: [-0.55, 0.8, -0.24], l: [0.27, 0.96, 0.11] },
    },
    {
      t: 2.67,
      P: [-0.01, 0.49, 0.02],
      r: [0, 4, -4],
      T: [41, -32, 8],
      H: [13, -2, 2],
      hR: [-0.3, 0.59, -0.08],
      eR: [-0.17, 0.76, -0.1],
      hL: [0.15, 0.58, 0.4],
      eL: [0.2, 0.65, 0.2],
      blade: { r: [-0.68, -0.25, 0.69], l: [-0.83, 0.21, 0.52] },
      bladeFace: { r: [-0.56, 0.79, -0.26], l: [0.28, 0.95, 0.08] },
    },
  ],
  female: [
    {
      t: 0,
      P: [0, 0.5, -0.01],
      r: [0, -15, -5],
      T: [41, -27, 0],
      H: [11, -3, 0],
      hR: [-0.18, 0.58, -0.18],
      eR: [-0.11, 0.76, -0.1],
      hL: [0.05, 0.52, 0.34],
      eL: [0.2, 0.63, 0.22],
      blade: { r: [-0.76, -0.53, 0.38], l: [-0.9, 0.41, 0.13] },
      bladeFace: { r: [-0.64, 0.7, -0.32], l: [0.4, 0.68, 0.62] },
    },
    {
      t: 0.27,
      P: [0, 0.5, -0.01],
      r: [-1, -18, -5],
      T: [42, -22, -1],
      H: [12, -2, 1],
      hR: [-0.18, 0.58, -0.17],
      eR: [-0.11, 0.76, -0.1],
      hL: [0.06, 0.53, 0.33],
      eL: [0.2, 0.64, 0.22],
      blade: { r: [-0.77, -0.54, 0.33], l: [-0.9, 0.41, 0.14] },
      bladeFace: { r: [-0.64, 0.66, -0.39], l: [0.41, 0.69, 0.6] },
    },
    {
      t: 0.53,
      P: [0.01, 0.52, -0.01],
      r: [-1, -21, -3],
      T: [43, -17, -3],
      H: [13, -2, 2],
      hR: [-0.18, 0.58, -0.16],
      eR: [-0.11, 0.77, -0.09],
      hL: [0.05, 0.54, 0.33],
      eL: [0.19, 0.65, 0.22],
      blade: { r: [-0.77, -0.56, 0.32], l: [-0.88, 0.46, 0.12] },
      bladeFace: { r: [-0.63, 0.57, -0.52], l: [0.44, 0.7, 0.57] },
    },
    {
      t: 0.8,
      P: [0.02, 0.52, -0.01],
      r: [-2, -21, 1],
      T: [42, -19, -2],
      H: [10, -3, 2],
      hR: [-0.18, 0.58, -0.14],
      eR: [-0.12, 0.77, -0.1],
      hL: [0.03, 0.55, 0.33],
      eL: [0.17, 0.65, 0.22],
      blade: { r: [-0.75, -0.54, 0.38], l: [-0.86, 0.5, 0.08] },
      bladeFace: { r: [-0.65, 0.48, -0.59], l: [0.46, 0.7, 0.54] },
    },
    {
      t: 1.07,
      P: [0.03, 0.51, -0.01],
      r: [-2, -19, 4],
      T: [41, -25, 1],
      H: [9, -4, 2],
      hR: [-0.2, 0.57, -0.15],
      eR: [-0.12, 0.76, -0.11],
      hL: [0.01, 0.54, 0.34],
      eL: [0.16, 0.64, 0.23],
      blade: { r: [-0.72, -0.51, 0.48], l: [-0.86, 0.51, 0.05] },
      bladeFace: { r: [-0.7, 0.47, -0.54], l: [0.44, 0.7, 0.56] },
    },
    {
      t: 1.33,
      P: [0.04, 0.5, -0.01],
      r: [-3, -15, 4],
      T: [41, -34, 4],
      H: [11, -5, 3],
      hR: [-0.2, 0.57, -0.15],
      eR: [-0.11, 0.76, -0.12],
      hL: [0, 0.52, 0.33],
      eL: [0.15, 0.63, 0.23],
      blade: { r: [-0.68, -0.48, 0.56], l: [-0.88, 0.47, 0.05] },
      bladeFace: { r: [-0.73, 0.54, -0.42], l: [0.4, 0.69, 0.61] },
    },
    {
      t: 1.6,
      P: [0.03, 0.51, -0.01],
      r: [-3, -12, 3],
      T: [42, -41, 6],
      H: [14, -5, 3],
      hR: [-0.21, 0.6, -0.16],
      eR: [-0.11, 0.78, -0.12],
      hL: [0, 0.52, 0.33],
      eL: [0.15, 0.63, 0.23],
      blade: { r: [-0.64, -0.49, 0.59], l: [-0.9, 0.42, 0.07] },
      bladeFace: { r: [-0.73, 0.63, -0.27], l: [0.36, 0.66, 0.66] },
    },
    {
      t: 1.87,
      P: [0.02, 0.52, -0.01],
      r: [-2, -10, 0],
      T: [41, -44, 7],
      H: [12, -5, 1],
      hR: [-0.2, 0.62, -0.18],
      eR: [-0.1, 0.8, -0.12],
      hL: [0.01, 0.53, 0.34],
      eL: [0.16, 0.64, 0.23],
      blade: { r: [-0.65, -0.51, 0.56], l: [-0.91, 0.4, 0.09] },
      bladeFace: { r: [-0.7, 0.7, -0.17], l: [0.35, 0.64, 0.69] },
    },
    {
      t: 2.13,
      P: [0.01, 0.52, -0.01],
      r: [0, -10, -2],
      T: [40, -41, 5],
      H: [9, -5, -1],
      hR: [-0.19, 0.62, -0.19],
      eR: [-0.1, 0.79, -0.12],
      hL: [0.02, 0.54, 0.34],
      eL: [0.17, 0.64, 0.23],
      blade: { r: [-0.7, -0.52, 0.49], l: [-0.9, 0.42, 0.1] },
      bladeFace: { r: [-0.66, 0.73, -0.17], l: [0.37, 0.64, 0.68] },
    },
    {
      t: 2.4,
      P: [0, 0.5, -0.01],
      r: [0, -13, -5],
      T: [40, -33, 3],
      H: [9, -4, 0],
      hR: [-0.19, 0.59, -0.19],
      eR: [-0.1, 0.77, -0.11],
      hL: [0.04, 0.53, 0.34],
      eL: [0.19, 0.63, 0.22],
      blade: { r: [-0.74, -0.51, 0.43], l: [-0.9, 0.42, 0.11] },
      bladeFace: { r: [-0.64, 0.73, -0.24], l: [0.39, 0.65, 0.65] },
    },
  ],
};

const IDLE = {
  male: [
    {
      t: 0,
      P: [-0.04, 0.46, -0.1],
      r: [-3, -26, -1],
      T: [41, 11, -7],
      H: [12, 5, -1],
      hR: [-0.36, 0.53, -0.01],
      eR: [-0.23, 0.69, -0.07],
      hL: [0.26, 0.5, 0.24],
      eL: [0.21, 0.65, 0.09],
      blade: { r: [-0.31, -0.28, 0.91], l: [-0.29, 0, 0.96] },
      bladeFace: { r: [-0.52, 0.85, 0.09], l: [0.6, 0.78, 0.18] },
    },
    {
      t: 0.3,
      P: [-0.01, 0.47, -0.08],
      r: [-3, -26, -1],
      T: [42, 4, -4],
      H: [11, 5, 0],
      hR: [-0.35, 0.55, -0.07],
      eR: [-0.23, 0.72, -0.1],
      hL: [0.22, 0.51, 0.27],
      eL: [0.21, 0.67, 0.12],
      blade: { r: [-0.35, -0.42, 0.84], l: [-0.47, -0.06, 0.88] },
      bladeFace: { r: [-0.62, 0.77, 0.13], l: [0.56, 0.76, 0.34] },
    },
    {
      t: 0.55,
      P: [0.02, 0.46, -0.06],
      r: [-3, -26, -1],
      T: [41, 8, -6],
      H: [12, 5, -1],
      hR: [-0.35, 0.51, -0.04],
      eR: [-0.25, 0.7, -0.07],
      hL: [0.23, 0.52, 0.27],
      eL: [0.22, 0.66, 0.1],
      blade: { r: [-0.28, -0.52, 0.81], l: [-0.46, 0.07, 0.88] },
      bladeFace: { r: [-0.76, 0.64, 0.15], l: [0.56, 0.79, 0.23] },
    },
    {
      t: 0.85,
      P: [0, 0.47, -0.07],
      r: [-3, -26, -1],
      T: [40, 15, -10],
      H: [12, 5, -2],
      hR: [-0.35, 0.5, 0.01],
      eR: [-0.25, 0.69, -0.03],
      hL: [0.27, 0.55, 0.23],
      eL: [0.21, 0.67, 0.06],
      blade: { r: [-0.28, -0.43, 0.86], l: [-0.27, 0.18, 0.95] },
      bladeFace: { r: [-0.74, 0.67, 0.09], l: [0.57, 0.82, 0.01] },
    },
  ],
  female: [
    {
      t: 0,
      P: [0, 0.45, -0.01],
      r: [2, -42, 3],
      T: [46, -7, -5],
      H: [12, -2, 1],
      hR: [-0.18, 0.57, -0.28],
      eR: [-0.15, 0.68, -0.11],
      hL: [-0.05, 0.51, 0.32],
      eL: [0.13, 0.59, 0.26],
      blade: { r: [-0.81, -0.25, -0.54], l: [-0.92, 0.36, -0.12] },
      bladeFace: { r: [-0.16, 0.96, -0.21], l: [0.28, 0.85, 0.43] },
    },
    {
      t: 0.3,
      P: [-0.01, 0.47, -0.03],
      r: [6, -41, -1],
      T: [41, -16, -1],
      H: [17, -1, 1],
      hR: [-0.2, 0.59, -0.27],
      eR: [-0.11, 0.71, -0.12],
      hL: [-0.1, 0.56, 0.31],
      eL: [0.09, 0.61, 0.28],
      blade: { r: [-0.96, -0.03, -0.26], l: [-0.76, 0.58, -0.28] },
      bladeFace: { r: [0.06, 0.94, -0.35], l: [0.45, 0.79, 0.42] },
    },
    {
      t: 0.55,
      P: [0, 0.45, 0],
      r: [-4, -42, -4],
      T: [43, -27, 2],
      H: [17, 0, 2],
      hR: [-0.15, 0.58, -0.3],
      eR: [-0.08, 0.7, -0.14],
      hL: [-0.14, 0.52, 0.27],
      eL: [0.07, 0.58, 0.27],
      blade: { r: [-0.96, 0.06, -0.25], l: [-0.73, 0.52, -0.44] },
      bladeFace: { r: [0.16, 0.92, -0.37], l: [0.26, 0.81, 0.52] },
    },
    {
      t: 0.85,
      P: [0.01, 0.47, 0.02],
      r: [-10, -42, 1],
      T: [49, -21, -2],
      H: [12, -1, 1],
      hR: [-0.13, 0.59, -0.32],
      eR: [-0.11, 0.7, -0.14],
      hL: [-0.09, 0.49, 0.26],
      eL: [0.1, 0.58, 0.25],
      blade: { r: [-0.84, -0.18, -0.51], l: [-0.89, 0.3, -0.34] },
      bladeFace: { r: [-0.05, 0.96, -0.26], l: [0.06, 0.83, 0.56] },
    },
  ],
};

// One foot's sneak cycle. Ground keys [t, along, pitch]: the foot is down,
// its anchor `along` the walk and rolling up onto the ball as `pitch` goes
// negative; contact slides back at an even rate. Air keys [t, along, height,
// flex]: the ankle itself is placed (as a free foot, toes pointed by `flex`),
// since a lifted, toes-down foot is not a heel-up roll about a ball on the floor.
// The first air key keeps the toe-off ankle angle (dorsiflexed over the deeply
// bent shin), and the toes drop as the foot swings through.
const STRIDE = {
  male: {
    duration: 2.8,
    x: 0.075,
    ground: [
      [0.93, 0.231, 0],
      [1.47, -0.041, 0],
      [1.6, -0.104, -6],
      [2.0, -0.283, -24],
      [2.27, -0.321, -34],
    ],
    air: [
      [0, -0.09, 0.207, -35],
      [0.27, 0.03, 0.194, -30],
      [0.4, 0.121, 0.169, -25],
      [0.53, 0.199, 0.145, -20],
      [0.67, 0.251, 0.123, -14],
      [0.8, 0.265, 0.101, -8],
      [2.4, -0.298, 0.164, 30],
      [2.53, -0.262, 0.179, 12],
      [2.67, -0.218, 0.191, -12],
    ],
  },
  female: {
    duration: 2.5,
    x: 0.05,
    ground: [
      [0.8, 0.197, 0],
      [1.33, -0.049, 0],
      [1.6, -0.17, -14],
      [1.87, -0.274, -24],
      [2.0, -0.309, -30],
    ],
    air: [
      [0, -0.126, 0.172, -45],
      [0.27, -0.017, 0.151, -40],
      [0.4, 0.07, 0.142, -24],
      [0.53, 0.139, 0.12, -6],
      [0.67, 0.186, 0.09, 0],
      [2.13, -0.31, 0.16, 25],
      [2.27, -0.283, 0.177, 3],
      [2.4, -0.236, 0.18, -22],
    ],
  },
};

/** Foot keys for both feet: the right runs the same stride half a loop later. */
function strideFeet(fit) {
  const { duration, x, ground, air } = STRIDE[fit];
  const out = [];
  for (const [side, offset, sign] of [
    ['l', 0, 1],
    ['r', duration / 2, -1],
  ]) {
    const at = (t) => Math.round(((t + offset) % duration) * 1000) / 1000;
    // The ground/air blend weights ease in and out at every key, so a blend
    // settles instead of overshooting and stopping dead.
    const weights = (t, onGround) => ({
      t: at(t),
      ease: 1,
      foot: { [side]: { plant: onGround ? 1 : 0, air: onGround ? 0 : 1 } },
    });
    for (const [t, along, pitch] of ground)
      out.push(weights(t, true), {
        t: at(t),
        // Flat contact passes straight through: the anchor slides at an even rate.
        ...(pitch === 0 ? { ease: -1 } : {}),
        foot: { [side]: { pos: [sign * x, 0, along], pitch, yaw: 0, knee: 8 } },
      });
    // The grounded roll still blends in while the foot lifts off and sets down,
    // so it holds the toe-off pitch until the foot is clear, then flattens for
    // the landing (fully airborne, the ankle angle alone sets the foot).
    const [toeOff, , lastPitch] = ground.at(-1);
    for (const [t, along, height, flex] of air)
      out.push(weights(t, false), {
        t: at(t),
        foot: {
          [side]: {
            pos: [sign * x, 0, along],
            ankle: [sign * x, height, along],
            pitch: t > toeOff ? lastPitch : 0,
            flex,
            yaw: 0,
            airYaw: 0,
            knee: 8,
          },
        },
      });
  }
  // A loop wraps each channel's keys, so neither foot needs a key on the seam.
  return out;
}

const D = Math.PI / 180;
const spin = (v, deg) =>
  v && [
    v[0] * Math.cos(deg * D) + v[2] * Math.sin(deg * D),
    v[1],
    -v[0] * Math.sin(deg * D) + v[2] * Math.cos(deg * D),
  ];

/** A key turned about the vertical axis by `deg` (+ toward the character's left). */
function turned(key, deg) {
  if (!deg) return key;
  const out = { ...key };
  if (key.pelvis)
    out.pelvis = {
      ...key.pelvis,
      pos: spin(key.pelvis.pos, deg),
      rot: [key.pelvis.rot[0], key.pelvis.rot[1] + deg, key.pelvis.rot[2]],
    };
  if (key.reach)
    out.reach = Object.fromEntries(
      Object.entries(key.reach).map(([s, r]) => [
        s,
        { at: spin(r.at, deg), elbowAt: spin(r.elbowAt, deg) },
      ]),
    );
  for (const field of ['blade', 'bladeFace'])
    if (key[field])
      out[field] = Object.fromEntries(
        Object.entries(key[field]).map(([s, v]) => [s, spin(v, deg)]),
      );
  if (key.foot)
    out.foot = Object.fromEntries(
      Object.entries(key.foot).map(([s, f]) => [
        s,
        {
          ...f,
          ...(f.pos ? { pos: spin(f.pos, deg) } : {}),
          ...(f.ankle ? { ankle: spin(f.ankle, deg) } : {}),
          ...(f.yaw !== undefined ? { yaw: f.yaw + (s === 'l' ? deg : -deg) } : {}),
        },
      ]),
    );
  return out;
}

const IDLE_FEET = {
  male: {
    l: { pos: [0.198, 0, 0.093], pitch: 0, yaw: -17.5, knee: 8 },
    r: { pos: [-0.213, 0, -0.239], pitch: 0, yaw: 23.5, knee: 8 },
  },
  female: {
    l: { pos: [0.163, 0, 0.156], pitch: 0, yaw: -25.5, knee: 6 },
    r: { pos: [-0.13, 0, -0.228], pitch: 0, yaw: 38.5, knee: 6 },
  },
};

export const crouchIdle = {
  clip(fit, model) {
    const key = beats(model);
    const duration = 1.133;
    const authored = IDLE[fit].map(({ t, ...b }) =>
      key(t, { clav: { l: [0, 0], r: [0, 0] }, ...b }),
    );
    return {
      duration,
      loop: true,
      family: 'crouch',
      // Hands hang low: forward/sideways arm angles have no wrap near hanging.
      armForm: 'swing',
      bladeSteady: 6,
      keys: [
        ...authored,
        { ...authored[0], t: duration },
        { t: 0, foot: IDLE_FEET[fit] },
        { t: duration, foot: IDLE_FEET[fit] },
      ],
      lag: { head: 0.04, neck: 0.03 },
    };
  },
};

/** The sneak turned to face `deg` from straight ahead. */
export function crouchWalk(deg) {
  return {
    clip(fit, model) {
      const key = beats(model);
      const { duration } = STRIDE[fit];
      const authored = WALK[fit].map(({ t, ...b }) =>
        key(t, { clav: { l: [0, 0], r: [0, 0] }, ...b }),
      );
      const keys = [...authored, { ...authored[0], t: duration }, ...strideFeet(fit)];
      return {
        duration,
        loop: true,
        family: 'gait',
        armForm: 'swing',
        bladeSteady: 6,
        keys: keys.map((k) => turned(k, deg)),
        lag: { head: 0.04, neck: 0.03 },
      };
    },
  };
}
