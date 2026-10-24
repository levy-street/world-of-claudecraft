// Unarmed swings (Woc_Attack_Unarmed_0 right, Woc_Attack_Unarmed_1 left),
// hand-keyed per fit from the same fist guard, at the reference's beats.
//
// Both fits fight from the sword stance (same feet and hips as the one-hand
// guard) with the fists up by the chin.
// Male: the right is a wide hook: he coils right with the fist drawn back past
// his ear, then fires it around and across while the rear foot leaves the
// floor and drives in, and settles back. The left mirrors the idea: the coil
// goes left with the left fist cocked high, and the hook crosses to his right.
// Female: the right is an overhand: she sinks and coils right with the fist
// pulled behind her shoulder, swings it up and over and down across the
// front, the rear heel up and sliding in. The left is a quick hook: a short
// coil left, then a fast turn to her right that whips the left fist across at
// head height while the right fist guards the chin.
import { SWORD_FEET } from './attack1h.mjs';
import { beats } from './beat.mjs';

const GUARD = {
  male: {
    P: [-0.04, 0.53, -0.05],
    r: [-3, -26, 0],
    T: [32, 13, -4],
    H: [2, 0],
    hR: [-0.12, 0.86, 0.26],
    eR: [-0.24, 0.71, 0.14],
    hL: [0.03, 0.87, 0.3],
    eL: [0.18, 0.72, 0.22],
    clav: { l: [0, 0], r: [0, 0] },
    forearm: { l: 70, r: 70 },
    wrist: { l: [10, 0], r: [10, 0] },
  },
  female: {
    P: [0, 0.54, -0.01],
    r: [-2, -42, 0],
    T: [4, 4, -2],
    H: [16, -3],
    hR: [-0.22, 0.82, 0.07],
    eR: [-0.21, 0.74, -0.13],
    hL: [0.01, 0.84, 0.22],
    eL: [0.19, 0.74, 0.18],
    clav: { l: [0, 0], r: [0, 0] },
    forearm: { l: 70, r: 70 },
    wrist: { l: [10, 0], r: [10, 0] },
  },
};

/** Male feet (both swings): the rear foot leaves the floor and drives in under the hook. */
function maleFeet() {
  const { lead, rear } = SWORD_FEET.male;
  return [
    {
      t: 0,
      ease: 1,
      foot: {
        l: { pos: lead, pitch: 0, yaw: -16, knee: 6 },
        r: { pos: rear, pitch: 0, yaw: 24, knee: 8 },
      },
    },
    { t: 0.22, ease: 1, foot: { r: { pos: rear, pitch: -4 } } },
    // The heel peels up about the ball before the foot leaves the floor.
    { t: 0.3, ease: 1, foot: { r: { pos: rear, pitch: -24 } } },
    { t: 0.36, foot: { r: { pos: [-0.152, 0.02, -0.11], pitch: -32 } } },
    { t: 0.46, foot: { r: { pos: [-0.11, 0.08, -0.035], pitch: -38 } } },
    { t: 0.55, foot: { r: { pos: [-0.14, 0.045, -0.13], pitch: -30 } } },
    { t: 0.62, foot: { r: { pos: [-0.174, 0.012, -0.19], pitch: -14 } } },
    { t: 0.67, foot: { r: { pos: [-0.177, 0.003, -0.228], pitch: -4 } } },
    { t: 0.72, ease: 1, foot: { r: { pos: rear, pitch: 0 } } },
    {
      t: 1,
      ease: 1,
      foot: {
        l: { pos: lead, pitch: 0, yaw: -16, knee: 6 },
        r: { pos: rear, pitch: 0, yaw: 24, knee: 8 },
      },
    },
  ];
}

function femaleFeet(variant) {
  const { lead, rear } = SWORD_FEET.female;
  const rest = {
    l: { pos: lead, pitch: 0, yaw: -25, knee: 4 },
    r: { pos: rear, pitch: 0, yaw: 40, knee: 6 },
  };
  if (variant === 1)
    return [
      { t: 0, ease: 1, foot: rest },
      { t: 1, ease: 1, foot: rest },
    ];
  // The overhand: the rear heel comes up and the ball slides in; the lead heel lifts a touch.
  return [
    { t: 0, ease: 1, foot: rest },
    { t: 0.22, ease: 1, foot: { r: { pos: rear, pitch: 0 }, l: { pos: lead, pitch: 0 } } },
    { t: 0.32, foot: { l: { pos: lead, pitch: -8 } } },
    { t: 0.4, foot: { r: { pos: [-0.17, 0, -0.17], pitch: -22 } } },
    {
      t: 0.5,
      ease: 0.6,
      foot: { r: { pos: [-0.2, 0, -0.14], pitch: -28 }, l: { pos: [0.14, 0, 0.14], pitch: 0 } },
    },
    { t: 0.62, ease: 0.6, foot: { r: { pos: [-0.2, 0, -0.14], pitch: -27 } } },
    {
      t: 0.8,
      foot: { r: { pos: [-0.16, 0, -0.2], pitch: -15 }, l: { pos: [0.156, 0, 0.15], pitch: -3 } },
    },
    { t: 0.92, ease: 1, foot: { r: { pos: rear, pitch: 0 }, l: { pos: lead, pitch: 0 } } },
    { t: 1, ease: 1, foot: rest },
  ];
}

const SWINGS = {
  // Right hook.
  male0: [
    {
      t: 0.1,
      P: [-0.03, 0.5, -0.04],
      r: [-3, -43, 0],
      T: [31, -13, 3],
      H: [17, -12],
      hR: [-0.24, 0.81, 0.15],
      eR: [-0.28, 0.73, -0.05],
      hL: [0.01, 0.8, 0.33],
      eL: [0.14, 0.67, 0.21],
    },
    // Coil right, fist drawn back past the ear.
    {
      t: 0.2,
      P: [-0.02, 0.51, 0.01],
      r: [-4, -56, 0],
      T: [19, -45, 16],
      H: [9, -20],
      hR: [-0.2, 0.85, -0.14],
      eR: [-0.07, 0.8, -0.31],
      hL: [-0.07, 0.72, 0.45],
      eL: [0.04, 0.73, 0.25],
    },
    // Fire: hips turn back, elbow lifts, the fist loops out wide.
    {
      t: 0.3,
      P: [0, 0.54, 0.11],
      r: [-3, -29, 0],
      T: [28, -24, 1],
      H: [11, -8],
      hR: [-0.36, 0.95, -0.15],
      eR: [-0.16, 0.9, -0.23],
      hL: [0.05, 0.68, 0.42],
      eL: [0.15, 0.71, 0.22],
    },
    {
      t: 0.4,
      ease: -1,
      P: [0.04, 0.48, 0.21],
      r: [-3, 5, 0],
      T: [37, 34, -13],
      H: [10, 17],
      hR: [-0.08, 0.74, 0.54],
      eR: [-0.12, 0.75, 0.32],
      hL: [0.38, 0.58, -0.01],
      eL: [0.24, 0.71, -0.13],
    },
    // Through: the fist finishes across at his left, low guard hand pulled back.
    {
      t: 0.5,
      P: [0.07, 0.45, 0.17],
      r: [-3, 10, 0],
      T: [39, 48, -16],
      H: [12, 19],
      hR: [0.33, 0.65, 0.22],
      eR: [0.12, 0.62, 0.29],
      hL: [0.35, 0.64, -0.3],
      eL: [0.19, 0.73, -0.19],
    },
    {
      t: 0.62,
      ease: 0.6,
      P: [0.06, 0.47, 0.1],
      r: [-3, 6, 0],
      T: [37, 46, -20],
      H: [10, 13],
      hR: [0.27, 0.65, 0.16],
      eR: [0.09, 0.62, 0.29],
      hL: [0.38, 0.61, -0.25],
      eL: [0.2, 0.72, -0.18],
    },
    // Recover toward guard.
    {
      t: 0.8,
      P: [0.01, 0.53, -0.06],
      r: [-3, -14, 0],
      T: [34, 32, -17],
      H: [7, 0],
      hR: [0.09, 0.79, 0.27],
      eR: [-0.11, 0.69, 0.26],
      hL: [0.35, 0.62, 0.13],
      eL: [0.23, 0.69, -0.04],
    },
  ],
  // Left hook.
  male1: [
    {
      t: 0.1,
      P: [-0.03, 0.5, -0.04],
      r: [-3, -4, 0],
      T: [32, 37, -14],
      H: [21, 14],
      hR: [-0.07, 0.77, 0.28],
      eR: [-0.23, 0.67, 0.16],
      hL: [0.18, 0.79, 0.24],
      eL: [0.29, 0.73, 0.06],
    },
    {
      t: 0.2,
      P: [-0.02, 0.51, 0.01],
      r: [-3, 18, 0],
      T: [16, 57, -19],
      H: [8, 16],
      hR: [-0.14, 0.72, 0.45],
      eR: [-0.16, 0.73, 0.23],
      hL: [0.25, 0.83, -0.01],
      eL: [0.2, 0.8, -0.22],
    },
    {
      t: 0.3,
      P: [0, 0.54, 0.11],
      r: [-3, 0, 0],
      T: [26, 24, -9],
      H: [5, 3],
      hR: [-0.23, 0.74, 0.36],
      eR: [-0.23, 0.74, 0.14],
      hL: [0.42, 0.89, 0.01],
      eL: [0.26, 0.86, -0.14],
    },
    {
      t: 0.4,
      ease: -1,
      P: [0.04, 0.48, 0.21],
      r: [-3, -25, 0],
      T: [38, -49, 12],
      H: [16, -25],
      hR: [-0.35, 0.64, -0.19],
      eR: [-0.15, 0.75, -0.22],
      hL: [-0.17, 0.68, 0.52],
      eL: [-0.04, 0.72, 0.34],
    },
    {
      t: 0.5,
      P: [0.07, 0.45, 0.17],
      r: [-3, -32, 0],
      T: [41, -68, 16],
      H: [19, -32],
      hR: [-0.15, 0.74, -0.45],
      eR: [-0.06, 0.78, -0.25],
      hL: [-0.41, 0.66, 0],
      eL: [-0.27, 0.61, 0.17],
    },
    {
      t: 0.62,
      ease: 0.6,
      P: [0.06, 0.47, 0.1],
      r: [-3, -33, 0],
      T: [41, -52, 16],
      H: [14, -20],
      hR: [-0.24, 0.68, -0.4],
      eR: [-0.1, 0.75, -0.24],
      hL: [-0.32, 0.63, 0.02],
      eL: [-0.21, 0.6, 0.21],
    },
    {
      t: 0.8,
      P: [0.01, 0.53, -0.06],
      r: [-3, -29, 0],
      T: [39, -12, 13],
      H: [3, -4],
      hR: [-0.36, 0.59, -0.02],
      eR: [-0.2, 0.68, -0.16],
      hL: [-0.2, 0.76, 0.21],
      eL: [0, 0.71, 0.29],
    },
    {
      t: 0.9,
      P: [-0.02, 0.53, -0.08],
      r: [-3, -27, 0],
      T: [35, 5, 2],
      H: [2, -2],
      hR: [-0.23, 0.77, 0.21],
      eR: [-0.27, 0.68, 0.01],
      hL: [-0.06, 0.84, 0.29],
      eL: [0.12, 0.73, 0.26],
    },
  ],
  // Overhand right.
  female0: [
    {
      t: 0.1,
      P: [-0.02, 0.47, -0.06],
      r: [5, -58, 5],
      T: [-8, -10, 5],
      H: [14, -8],
      hR: [-0.29, 0.78, -0.22],
      eR: [-0.11, 0.68, -0.28],
      hL: [-0.06, 0.78, 0.28],
      eL: [0.13, 0.69, 0.21],
    },
    {
      t: 0.2,
      P: [-0.02, 0.48, -0.06],
      r: [11, -61, 8],
      T: [-17, -25, 3],
      H: [13, -12],
      hR: [-0.1, 0.79, -0.41],
      eR: [0.06, 0.73, -0.29],
      hL: [-0.09, 0.73, 0.4],
      eL: [0.07, 0.72, 0.26],
    },
    {
      t: 0.3,
      P: [-0.01, 0.54, 0.04],
      r: [14, -42, 7],
      T: [-8, -20, -11],
      H: [18, -7],
      hR: [-0.16, 0.95, -0.35],
      eR: [0.02, 0.88, -0.26],
      hL: [0.01, 0.66, 0.4],
      eL: [0.14, 0.7, 0.24],
    },
    {
      t: 0.4,
      ease: -1,
      P: [0.01, 0.49, 0.22],
      r: [17, -17, 5],
      T: [3, 5, -22],
      H: [14, -7],
      hR: [-0.39, 0.92, 0.07],
      eR: [-0.21, 0.89, -0.04],
      hL: [0.22, 0.56, 0.3],
      eL: [0.25, 0.59, 0.09],
    },
    {
      t: 0.5,
      P: [0.02, 0.41, 0.23],
      r: [19, 5, 2],
      T: [19, 48, -31],
      H: [17, 2],
      hR: [0.29, 0.59, 0.36],
      eR: [0.08, 0.64, 0.37],
      hL: [0.37, 0.47, -0.04],
      eL: [0.2, 0.57, -0.14],
    },
    {
      t: 0.6,
      ease: 0.6,
      P: [0.02, 0.42, 0.16],
      r: [19, 16, 1],
      T: [31, 56, -27],
      H: [22, 5],
      hR: [0.33, 0.49, 0.23],
      eR: [0.14, 0.51, 0.33],
      hL: [0.29, 0.48, -0.2],
      eL: [0.14, 0.63, -0.17],
    },
    {
      t: 0.74,
      P: [0.01, 0.49, 0.08],
      r: [14, 6, 0],
      T: [34, 36, -24],
      H: [21, 3],
      hR: [0.18, 0.54, 0.31],
      eR: [-0.01, 0.59, 0.31],
      hL: [0.3, 0.5, -0.14],
      eL: [0.2, 0.68, -0.14],
    },
    {
      t: 0.88,
      P: [0, 0.54, 0],
      r: [1, -30, 1],
      T: [14, 17, -13],
      H: [22, 1],
      hR: [-0.13, 0.77, 0.21],
      eR: [-0.23, 0.75, 0.03],
      hL: [0.13, 0.72, 0.23],
      eL: [0.26, 0.69, 0.05],
    },
  ],
  // Quick left hook.
  female1: [
    {
      t: 0.1,
      P: [0.03, 0.47, -0.07],
      r: [-2, -23, -2],
      T: [13, 21, -8],
      H: [19, 2],
      hR: [-0.16, 0.73, 0.22],
      eR: [-0.24, 0.66, 0.05],
      hL: [0.3, 0.73, 0.18],
      eL: [0.28, 0.73, -0.04],
    },
    {
      t: 0.2,
      P: [0.05, 0.43, -0.08],
      r: [-1, 1, -2],
      T: [17, 34, -6],
      H: [15, -5],
      hR: [0, 0.66, 0.29],
      eR: [-0.16, 0.58, 0.18],
      hL: [0.36, 0.77, -0.08],
      eL: [0.2, 0.74, -0.18],
    },
    {
      t: 0.3,
      ease: -1,
      P: [0.01, 0.52, -0.01],
      r: [-1, -17, -2],
      T: [5, 1, -4],
      H: [8, -3],
      hR: [-0.19, 0.81, 0.17],
      eR: [-0.25, 0.73, -0.01],
      hL: [0.37, 0.87, 0.2],
      eL: [0.3, 0.8, 0.06],
    },
    // The hook lands: hips and chest snap right, the arm long across the front.
    {
      t: 0.35,
      ease: -1,
      P: [-0.01, 0.54, 0.01],
      r: [-1, -40, -2],
      T: [2, -35, 7],
      H: [15, -29],
      hR: [-0.24, 0.81, -0.11],
      eR: [-0.12, 0.73, -0.25],
      hL: [-0.18, 0.93, 0.41],
      eL: [-0.12, 0.87, 0.26],
    },
    {
      t: 0.4,
      P: [-0.01, 0.54, 0.01],
      r: [-2, -61, -2],
      T: [7, -35, 13],
      H: [16, -27],
      hR: [-0.2, 0.77, -0.19],
      eR: [-0.03, 0.72, -0.29],
      hL: [-0.33, 0.92, 0.3],
      eL: [-0.23, 0.86, 0.18],
    },
    {
      t: 0.5,
      P: [-0.01, 0.51, -0.01],
      r: [-2, -69, -1],
      T: [10, -32, 13],
      H: [18, -19],
      hR: [-0.18, 0.74, -0.2],
      eR: [0, 0.7, -0.29],
      hL: [-0.4, 0.87, 0.23],
      eL: [-0.28, 0.81, 0.13],
    },
    {
      t: 0.66,
      ease: 0.6,
      P: [-0.01, 0.48, -0.04],
      r: [-2, -64, 0],
      T: [9, -28, 11],
      H: [18, -21],
      hR: [-0.21, 0.74, -0.19],
      eR: [-0.04, 0.65, -0.26],
      hL: [-0.37, 0.85, 0.24],
      eL: [-0.22, 0.79, 0.19],
    },
    {
      t: 0.8,
      P: [-0.01, 0.51, -0.03],
      r: [-3, -52, 1],
      T: [6, -13, 5],
      H: [16, -15],
      hR: [-0.27, 0.78, -0.08],
      eR: [-0.15, 0.68, -0.21],
      hL: [-0.19, 0.87, 0.29],
      eL: [-0.01, 0.78, 0.27],
    },
  ],
};

export function unarmed(variant) {
  return {
    clip(fit, model) {
      const key = beats(model);
      const guard = GUARD[fit];
      const keys = [
        key(0, guard),
        ...SWINGS[`${fit}${variant}`].map(({ t, ...b }) => key(t, b)),
        key(1, guard),
        ...(fit === 'male' ? maleFeet() : femaleFeet(variant)),
      ];
      return {
        duration: 1,
        loop: false,
        family: 'attack',
        keys,
        lag: { head: 0.02, neck: 0.012, 'arm.l': 0.015, 'arm.r': 0.015 },
      };
    },
  };
}
