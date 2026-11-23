// Held poses (Woc_Sit, Woc_Talk), hand-keyed per fit at the reference's
// beats. Both loop on a nearly still pose.
//
// Sit: seated low with the hips at floor level and leaning back, the legs
// reaching forward and down over the edge, hands resting together in the lap;
// the male's chest rises and settles once a loop. The female sits turned a
// little to her left with the chest turned back to the front.
// Chat: the whole body turned to face its right, standing easy, one hand
// raised by the ear and the other held out at the waist.
import { beats } from './beat.mjs';

const air = (ankle, flex) => ({
  pos: [ankle[0], 0, ankle[2]],
  ankle,
  plant: 0,
  air: 1,
  flex,
  knee: 0,
  airYaw: 0,
});

const SIT = {
  male: {
    duration: 2.233,
    keys: [
      {
        t: 0,
        P: [0, 0.02, 0.07],
        r: [-31, 0, 0],
        T: [13, 0, 0],
        H: [9, 0, 0],
        hR: [-0.06, 0.15, 0.16],
        eR: [-0.19, 0.2, -0.01],
        hL: [0.05, 0.15, 0.12],
        eL: [0.2, 0.2, -0.03],
        blade: { r: [0.92, 0.38, 0.04], l: [-0.83, 0.31, -0.47] },
        bladeFace: { r: [-0.38, 0.89, 0.27], l: [0.18, 0.94, 0.3] },
        foot: { l: air([0.119, -0.191, 0.283], -20), r: air([-0.15, -0.185, 0.33], -20) },
      },
      {
        t: 1.05,
        ease: 0.6,
        P: [0, 0.02, 0.07],
        r: [-31, 0, 0],
        T: [10, 0, 0],
        H: [9, 0, 1],
        hR: [-0.06, 0.15, 0.15],
        eR: [-0.19, 0.21, -0.01],
        hL: [0.05, 0.14, 0.12],
        eL: [0.2, 0.21, -0.03],
        blade: { r: [0.95, 0.31, 0.02], l: [-0.84, 0.26, -0.48] },
        bladeFace: { r: [-0.31, 0.91, 0.28], l: [0.11, 0.94, 0.32] },
      },
    ],
  },
  female: {
    duration: 1.667,
    keys: [
      {
        t: 0,
        P: [0, 0.03, 0.05],
        r: [-31, 12, -1],
        T: [8, -13, 2],
        H: [9, 0, 0],
        hR: [-0.05, 0.14, 0.17],
        eR: [-0.16, 0.19, -0.01],
        hL: [0.09, 0.16, 0.16],
        eL: [0.17, 0.19, -0.04],
        blade: { r: [0.93, 0.36, 0.1], l: [-0.86, 0.5, 0.08] },
        bladeFace: { r: [-0.38, 0.89, 0.24], l: [0.47, 0.85, -0.23] },
        foot: { l: air([0.022, -0.233, 0.263], -25), r: air([-0.12, -0.233, 0.277], -25) },
      },
      {
        t: 0.83,
        ease: 0.6,
        P: [0, 0.03, 0.05],
        r: [-31, 12, -1],
        T: [8, -13, 2],
        H: [10, 0, 0],
        hR: [-0.05, 0.14, 0.17],
        eR: [-0.16, 0.19, 0],
        hL: [0.09, 0.16, 0.16],
        eL: [0.17, 0.19, -0.03],
      },
    ],
  },
};

const CHAT = {
  male: {
    duration: 2.233,
    keys: [
      {
        t: 0,
        P: [-0.03, 0.59, -0.03],
        r: [0, -90, 0],
        T: [-8, 0, 0],
        H: [0, -90, 4],
        hR: [-0.12, 0.94, -0.17],
        eR: [0.02, 0.77, -0.18],
        hL: [0.08, 0.56, 0.27],
        eL: [0.1, 0.77, 0.19],
        blade: { r: [0.57, 0.77, 0.29], l: [-0.87, -0.41, 0.28] },
        bladeFace: { r: [0.29, 0.15, -0.94], l: [-0.08, 0.67, 0.74] },
        foot: {
          l: { pos: [0.03, 0, 0.1], pitch: 0, yaw: -107.5, knee: 4 },
          r: { pos: [0.03, 0, -0.16], pitch: 0, yaw: 72.5, knee: 4 },
        },
      },
    ],
  },
  female: {
    duration: 5.567,
    keys: [
      {
        t: 0,
        P: [-0.01, 0.59, -0.01],
        r: [0, -90, -2],
        T: [-2, 0, 0],
        H: [0, -90, 5],
        hR: [-0.14, 0.94, -0.12],
        eR: [-0.02, 0.79, -0.22],
        hL: [0, 0.65, 0.39],
        eL: [0.02, 0.81, 0.25],
        blade: { r: [0.68, 0.67, 0.3], l: [-0.86, -0.35, 0.37] },
        bladeFace: { r: [0.01, 0.4, -0.92], l: [-0.09, 0.82, 0.57] },
        foot: {
          l: { pos: [0.03, 0, 0.06], pitch: 0, yaw: -104.5, knee: 4 },
          r: { pos: [0.03, 0, -0.09], pitch: 0, yaw: 75.5, knee: 4 },
        },
      },
    ],
  },
};

function held(table, family) {
  return {
    clip(fit, model) {
      const { duration, keys } = table[fit];
      const key = beats(model);
      const authored = keys.map(({ t, ...b }) => key(t, { clav: { l: [0, 0], r: [0, 0] }, ...b }));
      return {
        duration,
        loop: true,
        family,
        bladeTravel: 'arm',
        bladeSteady: 6,
        bladeLimits: { flex: [-75, 85], dev: [-50, 30] },
        keys: [...authored, { ...authored[0], t: duration }],
        lag: { head: 0.04, neck: 0.03 },
      };
    },
  };
}

export const sit = held(SIT, 'sit');
export const chat = held(CHAT, 'chat');
