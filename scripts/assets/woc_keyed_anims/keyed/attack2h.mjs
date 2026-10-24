// Two-handed swings (Woc_Attack_2H_0 and Woc_Attack_2H_1), hand-keyed per fit at
// the reference's beats. The weapon sits in the right hand; the left hand is
// keyed onto the haft and held there between keys by the grip constraint
// (grip.mjs), letting go only where the swing throws it free.
//
// Male, 2H_0 "turning sweep": from a low guard he turns hard right, standing
// the haft up beside his right shoulder while the lead foot slides wide, then
// drives the hips back through and sweeps the head flat around from behind
// his right side, across the front and out past his left, folding over it
// before the lead foot draws back in.
// Male, 2H_1 "high diagonal": the haft rises up over his left shoulder as the
// lead foot steps out, and he cuts down diagonally across to his right hip,
// the weight dropping onto bent knees, then lifts the head back to guard.
// Female, 2H_0 "overhead chop": she lifts the weapon straight up and back
// behind her head, rear foot stepping up, then chops down in front, folding at
// the waist with her eyes on the floor, and lets it carry through low past her
// right side before rising.
// Female, 2H_1 "rising drive": she coils right with the weapon high on her
// right, drops low as she swings it down past her leg and up in front, letting
// go with the left hand, which flies out for balance, then takes hold again.
import { SWORD_FEET } from './attack1h.mjs';
import { beats } from './beat.mjs';

const DURATION = 1.333;

const GUARD = {
  male: {
    P: [0, 0.54, -0.04],
    r: [-7, -26, 0],
    T: [39, -9, 12],
    H: [3, 0],
    hR: [-0.22, 0.64, 0.2],
    eR: [-0.26, 0.65, -0.01],
    hL: [-0.18, 0.58, 0.2],
    eL: [0, 0.69, 0.22],
    blade: { r: [-0.51, 0.77, 0.39] },
    clav: { l: [0, 0], r: [0, 0] },
    forearm: { l: 40 },
    wrist: { l: [0, 0] },
  },
  female: {
    P: [0, 0.54, -0.01],
    r: [-2, -42, 0],
    T: [1, -10, -1],
    H: [11, -1],
    hR: [-0.18, 0.56, 0.04],
    eR: [-0.12, 0.68, -0.12],
    hL: [-0.13, 0.55, 0.15],
    eL: [0.04, 0.69, 0.17],
    blade: { r: [-0.46, 0.84, 0.31] },
    clav: { l: [0, 0], r: [0, 0] },
    forearm: { l: 40 },
    wrist: { l: [0, 0] },
  },
};

const SWINGS = {
  male0: [
    {
      t: 0.13,
      P: [-0.02, 0.53, -0.04],
      r: [-8, -52, 1],
      T: [48, 8, 4],
      H: [6, -10],
      hR: [-0.27, 0.73, 0.19],
      eR: [-0.31, 0.72, -0.03],
      hL: [-0.25, 0.68, 0.2],
      eL: [-0.07, 0.73, 0.28],
      blade: { r: [-0.57, 0.82, 0.03] },
    },
    // Coiled right, haft upright by the right shoulder.
    {
      t: 0.33,
      P: [-0.07, 0.49, -0.02],
      r: [-8, -72, 1],
      T: [40, -18, 18],
      H: [1, -21],
      hR: [-0.39, 0.72, -0.07],
      eR: [-0.22, 0.69, -0.2],
      hL: [-0.42, 0.67, -0.03],
      eL: [-0.28, 0.66, 0.13],
      blade: { r: [-0.07, 0.95, -0.3] },
    },
    {
      t: 0.45,
      ease: 0.5,
      P: [-0.04, 0.46, 0],
      r: [-8, -63, 1],
      T: [20, -39, 26],
      H: [-1, -10],
      hR: [-0.32, 0.71, -0.18],
      eR: [-0.12, 0.65, -0.27],
      hL: [-0.34, 0.65, -0.15],
      eL: [-0.3, 0.63, 0.04],
      blade: { r: [-0.16, 0.97, -0.18] },
    },
    // The hips fire forward; the head trails behind the right side.
    {
      t: 0.6,
      P: [0.11, 0.43, 0.07],
      r: [-7, -10, 0],
      T: [5, -13, 18],
      H: [-7, -2],
      hR: [-0.35, 0.69, 0.2],
      eR: [-0.25, 0.61, 0.02],
      hL: [-0.32, 0.7, 0.28],
      eL: [-0.12, 0.72, 0.22],
      clav: { l: [2, 16] },
      blade: { r: [-0.69, 0.39, -0.61] },
    },
    {
      t: 0.67,
      ease: -1,
      P: [0.11, 0.44, 0.06],
      r: [-8, 0, -5],
      T: [20, 10, 0],
      H: [-10, 1],
      hR: [-0.07, 0.65, 0.38],
      eR: [-0.13, 0.65, 0.17],
      hL: [0.03, 0.62, 0.4],
      eL: [0.09, 0.69, 0.22],
      clav: { l: [0, 8] },
      blade: { r: [-0.73, 0.47, 0.49] },
    },
    // Through the target and out past the left, folded over it.
    {
      t: 0.73,
      ease: -1,
      P: [0.1, 0.44, 0.04],
      r: [-13, 1, -3],
      T: [37, 34, -22],
      H: [0, 18],
      hR: [0.17, 0.5, 0.27],
      eR: [-0.02, 0.58, 0.2],
      hL: [0.19, 0.5, 0.2],
      eL: [0.25, 0.56, 0.05],
      clav: { l: [0, 0] },
      blade: { r: [0.45, 0.05, 0.89] },
    },
    {
      t: 0.8,
      P: [0.09, 0.45, 0.01],
      r: [-16, 1, -1],
      T: [46, 43, -31],
      H: [14, 18],
      hR: [0.19, 0.45, 0.15],
      eR: [0, 0.54, 0.18],
      hL: [0.17, 0.49, 0.09],
      eL: [0.23, 0.56, -0.05],
      blade: { r: [0.83, -0.23, 0.51] },
    },
    {
      t: 0.93,
      ease: 0.6,
      P: [0.05, 0.49, -0.01],
      r: [-15, -5, 0],
      T: [51, 30, -22],
      H: [15, 5],
      hR: [0.14, 0.53, 0.17],
      eR: [-0.06, 0.59, 0.17],
      hL: [0.14, 0.56, 0.12],
      eL: [0.23, 0.61, -0.01],
      blade: { r: [0.73, -0.14, 0.66] },
    },
    // Recover: the head swings back up the front to guard.
    {
      t: 1.07,
      P: [0.01, 0.53, -0.03],
      r: [-12, -14, 0],
      T: [49, 12, -6],
      H: [11, -1],
      hR: [0.02, 0.6, 0.24],
      eR: [-0.17, 0.65, 0.13],
      hL: [0.04, 0.61, 0.19],
      eL: [0.18, 0.65, 0.11],
      blade: { r: [0.16, 0.13, 0.98] },
    },
    {
      t: 1.2,
      P: [0, 0.54, -0.04],
      r: [-9, -22, 0],
      T: [43, -3, 7],
      H: [6, -2],
      hR: [-0.14, 0.63, 0.24],
      eR: [-0.24, 0.65, 0.04],
      hL: [-0.09, 0.61, 0.21],
      eL: [0.08, 0.68, 0.2],
      blade: { r: [-0.48, 0.41, 0.77] },
    },
  ],
  male1: [
    {
      t: 0.13,
      P: [0.03, 0.59, -0.04],
      r: [-4, -19, -7],
      T: [40, 5, 5],
      H: [4, 1],
      hR: [-0.1, 0.77, 0.28],
      eR: [-0.24, 0.74, 0.12],
      hL: [-0.09, 0.73, 0.31],
      eL: [0.11, 0.78, 0.26],
      blade: { r: [-0.12, 0.98, 0.17] },
    },
    {
      t: 0.27,
      P: [0.07, 0.57, -0.03],
      r: [-1, -11, -12],
      T: [38, 32, -10],
      H: [9, 2],
      hR: [0.13, 0.9, 0.29],
      eR: [-0.07, 0.83, 0.29],
      hL: [0.17, 0.88, 0.36],
      eL: [0.29, 0.82, 0.19],
      blade: { r: [-0.12, 0.79, -0.6] },
    },
    // Cocked over the left shoulder.
    {
      t: 0.42,
      ease: 0.5,
      P: [0.11, 0.5, -0.01],
      r: [0, -5, -10],
      T: [31, 52, -21],
      H: [13, 2],
      hR: [0.3, 0.96, 0.24],
      eR: [0.12, 0.84, 0.27],
      hL: [0.36, 0.91, 0.27],
      eL: [0.33, 0.75, 0.12],
      blade: { r: [-0.2, 0.76, -0.62] },
    },
    // The cut: down across the body to the right hip.
    {
      t: 0.53,
      ease: -1,
      P: [0.03, 0.36, 0.01],
      r: [-1, -8, -2],
      T: [38, 31, -14],
      H: [12, 0],
      hR: [0.15, 0.73, 0.43],
      eR: [-0.01, 0.68, 0.31],
      hL: [0.12, 0.6, 0.47],
      eL: [0.16, 0.6, 0.27],
      blade: { r: [0.69, 0.72, -0.07] },
    },
    {
      t: 0.6,
      ease: -1,
      P: [-0.05, 0.35, -0.07],
      r: [-2, -15, 2],
      T: [43, -13, 6],
      H: [8, -3],
      hR: [-0.33, 0.51, 0.3],
      eR: [-0.26, 0.61, 0.17],
      hL: [-0.3, 0.5, 0.26],
      eL: [-0.11, 0.52, 0.22],
      blade: { r: [-0.15, -0.17, 0.97] },
    },
    {
      t: 0.67,
      P: [-0.05, 0.38, -0.12],
      r: [2, -22, -10],
      T: [37, -54, 24],
      H: [3, -9],
      hR: [-0.36, 0.51, -0.13],
      eR: [-0.25, 0.62, -0.1],
      hL: [-0.27, 0.5, -0.09],
      eL: [-0.16, 0.52, 0.06],
      blade: { r: [-0.92, -0.23, -0.32] },
    },
    {
      t: 0.77,
      ease: 0.6,
      P: [-0.04, 0.43, -0.13],
      r: [3, -26, -14],
      T: [31, -68, 33],
      H: [1, -12],
      hR: [-0.28, 0.55, -0.23],
      eR: [-0.18, 0.66, -0.2],
      hL: [-0.18, 0.52, -0.16],
      eL: [-0.14, 0.56, 0.02],
      blade: { r: [-0.8, -0.17, -0.57] },
    },
    // The head comes forward round the right side, back to guard.
    {
      t: 0.93,
      P: [-0.01, 0.51, -0.08],
      r: [-3, -25, -4],
      T: [35, -43, 28],
      H: [-5, 5],
      hR: [-0.34, 0.57, 0.03],
      eR: [-0.26, 0.68, -0.1],
      hL: [-0.26, 0.51, 0],
      eL: [-0.13, 0.64, 0.11],
      blade: { r: [-0.88, 0.04, 0.48] },
    },
    {
      t: 1.1,
      ease: 0.5,
      P: [0, 0.55, -0.05],
      r: [-5, -26, 0],
      T: [40, -21, 24],
      H: [-6, 7],
      hR: [-0.28, 0.59, 0.14],
      eR: [-0.25, 0.68, -0.05],
      hL: [-0.21, 0.52, 0.14],
      eL: [-0.08, 0.69, 0.15],
      blade: { r: [-0.74, 0.37, 0.56] },
    },
    {
      t: 1.24,
      P: [0, 0.54, -0.04],
      r: [-7, -26, 0],
      T: [43, -18, 24],
      H: [-2, 0],
      hR: [-0.25, 0.58, 0.12],
      eR: [-0.21, 0.65, -0.08],
      hL: [-0.18, 0.52, 0.14],
      eL: [-0.05, 0.68, 0.18],
      blade: { r: [-0.78, 0.48, 0.4] },
    },
  ],
  female0: [
    {
      t: 0.07,
      P: [0, 0.54, -0.01],
      r: [-3, -40, -1],
      T: [-1, -7, 3],
      H: [8, 0],
      hR: [-0.23, 0.7, 0.06],
      eR: [-0.14, 0.68, -0.13],
      hL: [-0.17, 0.71, 0.13],
      eL: [0.03, 0.74, 0.2],
      blade: { r: [-0.16, 0.94, -0.29] },
    },
    {
      t: 0.2,
      P: [0.02, 0.57, 0.06],
      r: [-7, -31, 4],
      T: [-10, 4, 15],
      H: [-4, 6],
      hR: [-0.29, 1.03, 0.05],
      eR: [-0.25, 0.83, 0.01],
      hL: [-0.18, 1.08, 0.14],
      eL: [0.03, 1.01, 0.13],
      blade: { r: [0.6, 0.26, -0.76] },
    },
    // Weapon up and back behind her head, risen onto the rear foot.
    {
      t: 0.4,
      P: [0.07, 0.59, 0.18],
      r: [-5, -21, -1],
      T: [-14, 22, -9],
      H: [3, -2],
      hR: [0.04, 1.22, 0],
      eR: [-0.1, 1.07, 0.08],
      hL: [0.17, 1.23, 0.05],
      eL: [0.26, 1.05, 0.1],
      blade: { r: [0.42, -0.47, -0.78] },
    },
    {
      t: 0.5,
      ease: 0.4,
      P: [0.08, 0.56, 0.18],
      r: [-1, -18, -9],
      T: [-9, 33, -15],
      H: [11, 3],
      hR: [0.14, 1.2, 0.02],
      eR: [0.02, 1.06, 0.12],
      hL: [0.28, 1.2, 0.03],
      eL: [0.3, 1.02, 0.1],
      blade: { r: [-0.15, 0.05, -0.99] },
    },
    // The chop: down in front, folding at the waist.
    {
      t: 0.6,
      ease: -1,
      P: [0.07, 0.42, 0.11],
      r: [-1, -17, -8],
      T: [35, 20, -23],
      H: [56, 7],
      hR: [0.19, 0.85, 0.36],
      eR: [0.02, 0.72, 0.34],
      hL: [0.3, 0.81, 0.39],
      eL: [0.24, 0.64, 0.32],
      blade: { r: [0.32, 0.59, -0.74] },
    },
    {
      t: 0.67,
      ease: -1,
      P: [0.06, 0.38, 0.05],
      r: [-3, -21, -3],
      T: [57, -9, -10],
      H: [68, 41],
      hR: [0.08, 0.62, 0.44],
      eR: [-0.09, 0.55, 0.33],
      hL: [0.14, 0.57, 0.48],
      eL: [0.08, 0.45, 0.33],
      blade: { r: [0.65, 0.68, -0.34] },
    },
    {
      t: 0.73,
      ease: -1,
      P: [0.05, 0.38, -0.01],
      r: [-3, -38, -1],
      T: [50, -26, 10],
      H: [40, 21],
      hR: [-0.41, 0.44, 0.24],
      eR: [-0.32, 0.54, 0.12],
      hL: [-0.37, 0.37, 0.26],
      eL: [-0.19, 0.45, 0.23],
      blade: { r: [-0.18, -0.44, 0.88] },
    },
    // Carried through low past her right side.
    {
      t: 0.83,
      P: [0.04, 0.4, -0.08],
      r: [-3, -64, 0],
      T: [39, -25, 21],
      H: [5, -2],
      hR: [-0.33, 0.44, -0.22],
      eR: [-0.19, 0.54, -0.18],
      hL: [-0.36, 0.38, -0.14],
      eL: [-0.28, 0.51, -0.01],
      blade: { r: [-0.9, -0.43, -0.12] },
    },
    {
      t: 1,
      ease: 0.5,
      P: [0.02, 0.45, -0.07],
      r: [-3, -66, 1],
      T: [29, -14, 17],
      H: [0, 0],
      hR: [-0.26, 0.44, -0.19],
      eR: [-0.08, 0.54, -0.17],
      hL: [-0.32, 0.41, -0.04],
      eL: [-0.23, 0.59, 0.03],
      blade: { r: [-0.93, 0.35, -0.13] },
    },
    {
      t: 1.2,
      P: [0, 0.52, -0.02],
      r: [-3, -48, 1],
      T: [7, -10, 5],
      H: [9, 1],
      hR: [-0.24, 0.54, -0.01],
      eR: [-0.11, 0.63, -0.14],
      hL: [-0.22, 0.54, 0.12],
      eL: [-0.09, 0.7, 0.12],
      blade: { r: [-0.58, 0.81, 0.07] },
    },
  ],
  female1: [
    {
      t: 0.13,
      P: [-0.01, 0.54, -0.01],
      r: [-1, -55, -3],
      T: [4, -27, 1],
      H: [15, -8],
      hR: [-0.34, 0.75, -0.08],
      eR: [-0.15, 0.72, -0.17],
      hL: [-0.34, 0.77, 0.04],
      eL: [-0.16, 0.79, 0.15],
      blade: { r: [0.12, 0.99, 0.11] },
    },
    // Coiled right with the weapon high.
    {
      t: 0.3,
      ease: 0.5,
      P: [0, 0.5, 0],
      r: [-1, -74, -4],
      T: [4, -52, 0],
      H: [22, -28],
      hR: [-0.16, 1, -0.22],
      eR: [-0.03, 0.85, -0.27],
      hL: [-0.23, 1.03, -0.11],
      eL: [-0.24, 0.87, 0.02],
      blade: { r: [0.42, 0.5, 0.75] },
    },
    {
      t: 0.4,
      P: [0.02, 0.41, 0.02],
      r: [-2, -68, -2],
      T: [7, -42, 4],
      H: [20, -28],
      hR: [-0.27, 0.89, -0.15],
      eR: [-0.17, 0.71, -0.23],
      hL: [-0.31, 0.94, -0.06],
      eL: [-0.25, 0.78, 0.07],
      blade: { r: [0.9, 0.3, 0.31] },
    },
    // Down past her right leg, deep in the knees.
    {
      t: 0.47,
      ease: -1,
      P: [0.04, 0.34, 0.03],
      r: [-4, -57, -1],
      T: [14, -27, 8],
      H: [21, -24],
      hR: [-0.41, 0.69, -0.01],
      eR: [-0.26, 0.57, -0.08],
      hL: [-0.4, 0.74, 0.1],
      eL: [-0.22, 0.66, 0.18],
      blade: { r: [0.31, 0.66, -0.68] },
    },
    {
      t: 0.53,
      ease: -1,
      P: [0.04, 0.32, 0.03],
      r: [-4, -43, 0],
      T: [24, -17, 3],
      H: [28, -21],
      hR: [-0.36, 0.54, 0.23],
      eR: [-0.25, 0.53, 0.04],
      hL: [-0.26, 0.54, 0.39],
      eL: [-0.09, 0.57, 0.29],
      blade: { r: [-0.39, 0.92, -0.11] },
    },
    // Up in front; the left hand lets go and flies out.
    {
      t: 0.62,
      P: [0.04, 0.35, 0.03],
      r: [-5, -18, 0],
      T: [41, -3, -4],
      H: [41, -1],
      hR: [-0.07, 0.42, 0.34],
      eR: [-0.16, 0.5, 0.16],
      hL: [0.31, 0.41, 0.25],
      eL: [0.21, 0.54, 0.2],
      blade: { r: [0.06, 0.76, 0.64] },
    },
    {
      t: 0.8,
      ease: 0.6,
      P: [0.03, 0.45, 0.02],
      r: [-4, -13, 1],
      T: [35, -3, -3],
      H: [33, 1],
      hR: [-0.03, 0.53, 0.29],
      eR: [-0.14, 0.6, 0.13],
      hL: [0.42, 0.51, 0.13],
      eL: [0.26, 0.63, 0.13],
      blade: { r: [0.42, 0.65, 0.63] },
    },
    {
      t: 0.97,
      P: [0.02, 0.53, 0.01],
      r: [-4, -23, 2],
      T: [22, -5, -4],
      H: [24, 1],
      hR: [-0.08, 0.66, 0.26],
      eR: [-0.16, 0.69, 0.06],
      hL: [0.2, 0.64, 0.39],
      eL: [0.19, 0.7, 0.2],
      blade: { r: [0.34, 0.65, 0.68] },
    },
    // Takes hold again and settles to guard.
    {
      t: 1.13,
      P: [0.01, 0.54, 0.01],
      r: [-3, -35, 2],
      T: [9, -8, -3],
      H: [17, 0],
      hR: [-0.19, 0.71, 0.15],
      eR: [-0.18, 0.69, -0.06],
      hL: [-0.14, 0.69, 0.24],
      eL: [0.07, 0.69, 0.19],
      blade: { r: [-0.17, 0.94, 0.28] },
    },
    {
      t: 1.24,
      P: [0, 0.54, -0.01],
      r: [-3, -40, 1],
      T: [3, -9, -1],
      H: [13, -1],
      hR: [-0.21, 0.64, 0.07],
      eR: [-0.14, 0.68, -0.13],
      hL: [-0.15, 0.61, 0.16],
      eL: [0.04, 0.69, 0.18],
      blade: { r: [-0.38, 0.92, 0.12] },
    },
  ],
};

// The left hand's hold on the haft (1 held, 0 free).
const GRIP = {
  female1: [
    [0.5, 1],
    [0.58, 0],
    [1.05, 0],
    [1.13, 1],
  ],
};

function maleFeet(variant) {
  const { lead, rear } = SWORD_FEET.male;
  const rest = {
    l: { pos: lead, pitch: 0, yaw: -16, knee: 6 },
    r: { pos: rear, pitch: 0, yaw: 24, knee: 8 },
  };
  if (variant === 0) {
    const wide = [0.31, 0, 0.165];
    const back = [-0.22, 0, -0.26];
    return [
      { t: 0, ease: 1, foot: rest },
      // The rear foot shuffles back and out as he turns.
      { t: 0.05, ease: 1, foot: { r: { pos: rear, pitch: 0 } } },
      { t: 0.11, foot: { r: { pos: [-0.2, 0.012, -0.25], pitch: -4 } } },
      { t: 0.18, ease: 1, foot: { r: { pos: back, pitch: 0, yaw: 55 } } },
      // The lead foot slides wide.
      { t: 0.22, ease: 1, foot: { l: { pos: lead, pitch: 0 } } },
      { t: 0.28, foot: { l: { pos: [0.195, 0.015, 0.11], pitch: -6 } } },
      { t: 0.38, foot: { l: { pos: [0.26, 0.035, 0.155], pitch: -4 } } },
      { t: 0.47, foot: { l: { pos: [0.303, 0.012, 0.168], pitch: 0 } } },
      { t: 0.52, ease: 1, foot: { l: { pos: wide, pitch: 0, yaw: -6 } } },
      // Rear heel up as the hips drive through.
      { t: 0.55, ease: 1, foot: { r: { pos: back, pitch: 0 } } },
      { t: 0.62, foot: { r: { pos: [-0.215, 0.008, -0.24], pitch: -26 } } },
      { t: 0.68, foot: { r: { pos: [-0.192, 0.008, -0.232], pitch: -22 } } },
      { t: 0.75, foot: { r: { pos: [-0.181, 0.002, -0.237], pitch: -8 } } },
      { t: 0.8, ease: 1, foot: { r: { pos: rear, pitch: 0, yaw: 24 } } },
      // The lead foot draws back in.
      { t: 0.97, ease: 1, foot: { l: { pos: wide, pitch: 0 } } },
      { t: 1.03, foot: { l: { pos: [0.3, 0.012, 0.162], pitch: -6 } } },
      { t: 1.13, foot: { l: { pos: [0.25, 0.018, 0.125], pitch: -4 } } },
      { t: 1.23, foot: { l: { pos: [0.205, 0.008, 0.09], pitch: 0 } } },
      { t: 1.3, ease: 1, foot: { l: { pos: lead, pitch: 0 } } },
      { t: DURATION, ease: 1, foot: rest },
    ];
  }
  const out = [0.295, 0, 0.115];
  return [
    { t: 0, ease: 1, foot: rest },
    // Lead foot steps out as the weapon rises; the rear heel comes up.
    {
      t: 0.04,
      foot: { l: { pos: [0.19, 0.012, 0.076], pitch: -6 }, r: { pos: rear, pitch: -10 } },
    },
    { t: 0.13, foot: { l: { pos: [0.24, 0.04, 0.098], pitch: -6 }, r: { pos: rear, pitch: -28 } } },
    { t: 0.22, foot: { l: { pos: [0.285, 0.025, 0.117], pitch: -2 } } },
    { t: 0.3, ease: 1, foot: { l: { pos: out, pitch: 0 } } },
    { t: 0.45, foot: { r: { pos: rear, pitch: -12 } } },
    { t: 0.55, ease: 1, foot: { r: { pos: rear, pitch: 0 } } },
    // And back in after the cut.
    { t: 0.62, ease: 1, foot: { l: { pos: out, pitch: 0 } } },
    { t: 0.67, foot: { l: { pos: [0.27, 0.014, 0.11], pitch: -6 } } },
    { t: 0.73, foot: { l: { pos: [0.22, 0.006, 0.083], pitch: -2 } } },
    { t: 0.8, ease: 1, foot: { l: { pos: lead, pitch: 0 } } },
    // Rear heel rises as the head comes forward.
    { t: 0.88, ease: 1, foot: { r: { pos: rear, pitch: 0 } } },
    { t: 0.97, foot: { r: { pos: rear, pitch: -22 } } },
    { t: 1.05, foot: { r: { pos: rear, pitch: -18 } } },
    { t: 1.18, ease: 1, foot: { r: { pos: rear, pitch: 0 } } },
    { t: DURATION, ease: 1, foot: rest },
  ];
}

function femaleFeet(variant) {
  const { lead, rear } = SWORD_FEET.female;
  const rest = {
    l: { pos: lead, pitch: 0, yaw: -25, knee: 4 },
    r: { pos: rear, pitch: 0, yaw: 40, knee: 6 },
  };
  if (variant === 0)
    // The rear foot comes up and forward under the lift, and stamps back for the chop.
    return [
      { t: 0, ease: 1, foot: rest },
      { t: 0.07, foot: { r: { pos: rear, pitch: -8 } } },
      { t: 0.17, foot: { r: { pos: [-0.12, 0.01, -0.2], pitch: -26 } } },
      { t: 0.3, foot: { r: { pos: [-0.095, 0.055, -0.14], pitch: -34 } } },
      { t: 0.42, foot: { r: { pos: [-0.065, 0.08, -0.095], pitch: -30 } } },
      { t: 0.52, foot: { r: { pos: [-0.065, 0.05, -0.125], pitch: -24 } } },
      { t: 0.6, foot: { r: { pos: [-0.105, 0.012, -0.19], pitch: -6 } } },
      { t: 0.66, ease: 1, foot: { r: { pos: [-0.13, 0, -0.232], pitch: 0 } } },
      { t: 0.9, ease: 1, foot: { r: { pos: [-0.118, 0, -0.238], pitch: 0 } } },
      { t: DURATION, ease: 1, foot: rest },
    ];
  // The rear heel rises slowly and the ball swivels out under the low swing.
  return [
    { t: 0, ease: 1, foot: rest },
    { t: 0.3, ease: 1, foot: { r: { pos: rear, pitch: 0 } } },
    { t: 0.5, foot: { r: { pos: [-0.145, 0, -0.222], pitch: -12 } } },
    { t: 0.7, ease: 0.6, foot: { r: { pos: [-0.165, 0, -0.21], pitch: -16 } } },
    { t: 0.9, foot: { r: { pos: [-0.148, 0, -0.218], pitch: -6 } } },
    { t: 1.02, ease: 1, foot: { r: { pos: [-0.14, 0, -0.222], pitch: 0 } } },
    { t: DURATION, ease: 1, foot: rest },
  ];
}

export function twoHand(variant) {
  return {
    clip(fit, model) {
      const key = beats(model);
      const guard = GUARD[fit];
      const name = `${fit}${variant}`;
      return {
        duration: DURATION,
        loop: false,
        family: 'attack',
        bladeTravel: 'arm',
        // Both hands on one haft bend the weapon wrist toward the little finger
        // (ulnar deviation) further than a one-handed grip does.
        bladeLimits: { flex: [-75, 85], dev: [-75, 30] },
        grip: { hand: 'l', weight: GRIP[name] },
        keys: [
          key(0, guard),
          ...SWINGS[name].map(({ t, ...b }) => key(t, b)),
          key(DURATION, guard),
          ...(fit === 'male' ? maleFeet(variant) : femaleFeet(variant)),
        ],
        lag: { head: 0.02, neck: 0.012 },
      };
    },
  };
}
