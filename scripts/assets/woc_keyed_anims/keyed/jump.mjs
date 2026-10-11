// Jump (Woc_Jump), hand-keyed per fit. The game plays it once at takeoff
// and holds the last frame through the fall, so it ends on an airborne hold.
//
// Same beats as the reference: a deep loaded crouch, an explosive extension
// that unfolds the trunk and lifts the heels, the feet leaving the floor, then
// the knees drawing up into a tuck under a high, open upper body.
//
// Male: crouches low with the chest folded over the knees and the arms out
// like wings, drives up hard, and hangs with the knees tucked and the arms
// spread wide at shoulder height.
// Female: crouches with the hands low in front, springs up with a pike in the
// trunk, and opens into a tuck with both arms flung up overhead.

const R = (at, elbow) => ({ at, elbow });

function male() {
  const keys = [
    // Loaded crouch.
    {
      t: 0,
      pelvis: { pos: [0, 0.29, -0.04], rot: [22, 0, 0] },
      spine: [22, 0, 0],
      chest: [18, 0, 0],
      neck: [-14, 0, 0],
      head: [-16, 4, 0],
      clav: { l: [4, 2], r: [4, 2] },
      reach: {
        r: R([-0.3, 0.58, 0.15], [-0.6, 0.6, -0.3]),
        l: R([0.33, 0.57, 0.16], [0.6, 0.6, -0.3]),
      },
      forearm: { l: 10, r: 10 },
      wrist: { l: [10, 0], r: [10, 0] },
    },
    // Driving up: the arms swing down past the knees.
    {
      t: 0.07,
      ease: -1,
      pelvis: { pos: [0, 0.42, -0.01], rot: [24, 0, 0] },
      spine: [24, 0, 0],
      chest: [20, 0, 0],
      neck: [-14, 0, 0],
      head: [-14, 5, 0],
      clav: { l: [0, 0], r: [0, 0] },
      reach: {
        r: R([-0.24, 0.36, 0.1], [-0.6, 0.3, -0.6]),
        l: R([0.26, 0.37, 0.13], [0.6, 0.3, -0.6]),
      },
    },
    // Extended: legs straight, trunk still forward, heels up.
    {
      t: 0.13,
      ease: -1,
      pelvis: { pos: [-0.005, 0.59, 0.005], rot: [10, 0, 0] },
      spine: [26, 2, -0.5],
      chest: [26, 3, -0.5],
      neck: [-14, 0, 0],
      head: [-12, 6, 0],
      reach: {
        r: R([-0.17, 0.45, 0.14], [-0.6, 0, -0.8]),
        l: R([0.19, 0.47, 0.1], [0.6, 0, -0.8]),
      },
    },
    // Unfolding in the air, arms swinging out.
    {
      t: 0.23,
      pelvis: { pos: [-0.008, 0.655, -0.01], rot: [5, -2, 0] },
      spine: [18, 5, -1],
      chest: [16, 6, -1],
      neck: [-10, -2, 0],
      head: [-6, -3, 0],
      clav: { l: [4, 0], r: [4, 0] },
      reach: {
        r: R([-0.28, 0.68, 0.19], [-0.8, 0.2, -0.5]),
        l: R([0.29, 0.72, 0.11], [0.8, 0.2, -0.5]),
      },
    },
    // The held tuck: knees up, chest open, arms spread wide.
    {
      t: 0.4,
      ease: 0.6,
      pelvis: { pos: [-0.008, 0.652, -0.017], rot: [2, -4, 1] },
      spine: [9, 10, 1],
      chest: [8, 11, 1],
      neck: [-6, -6, 0],
      head: [-4, -9, 0],
      clav: { l: [6, -2], r: [6, -2] },
      reach: {
        r: R([-0.33, 0.83, 0.24], [-0.8, 0.4, -0.4]),
        l: R([0.36, 0.87, 0.09], [0.8, 0.4, -0.4]),
      },
    },
    {
      t: 0.7,
      ease: 0.8,
      pelvis: { pos: [-0.008, 0.62, -0.017], rot: [-1, -7, 0] },
      spine: [13, 14, 0],
      chest: [13, 16, -1],
      neck: [-10, -8, 0],
      head: [-8, -11, 0],
      clav: { l: [4, -2], r: [4, -2] },
      reach: {
        r: R([-0.31, 0.86, 0.34], [-0.8, 0.4, -0.4]),
        l: R([0.39, 0.75, 0.06], [0.8, 0.4, -0.4]),
      },
    },
    // Feet: planted through the drive, heels rise, then off the floor and tucked.
    {
      t: 0,
      ease: 1,
      foot: {
        l: {
          pos: [0.13, 0, -0.03],
          ankle: [0.13, 0.085, -0.03],
          plant: 1,
          pitch: 0,
          yaw: 12,
          knee: 14,
          air: 0,
        },
        r: {
          pos: [-0.09, 0, -0.07],
          ankle: [-0.09, 0.085, -0.07],
          plant: 1,
          pitch: 0,
          yaw: 10,
          knee: 14,
          air: 0,
        },
      },
    },
    { t: 0.06, ease: 1, foot: { l: { pitch: 0, plant: 1 }, r: { pitch: 0, plant: 1 } } },
    {
      t: 0.12,
      foot: {
        l: { pitch: -34, plant: 1, ankle: [0.11, 0.15, 0], knee: 4 },
        r: { pitch: -34, plant: 1, ankle: [-0.09, 0.15, -0.04], knee: 4 },
      },
    },
    {
      t: 0.16,
      foot: {
        l: { plant: 0, ankle: [0.1, 0.13, 0.01], air: 1, flex: -40 },
        r: { plant: 0, ankle: [-0.095, 0.12, -0.03], air: 1, flex: -40 },
      },
    },
    {
      t: 0.27,
      foot: {
        l: { ankle: [0.08, 0.32, 0.04], flex: -20, knee: 10 },
        r: { ankle: [-0.11, 0.29, -0.05], flex: -20, knee: 10 },
      },
    },
    {
      t: 0.42,
      ease: 0.6,
      foot: {
        l: { ankle: [0.078, 0.43, 0.03], flex: -12 },
        r: { ankle: [-0.115, 0.41, -0.075], flex: -14 },
      },
    },
    {
      t: 0.7,
      ease: 0.8,
      foot: {
        l: { ankle: [0.09, 0.26, -0.02], flex: -18 },
        r: { ankle: [-0.08, 0.18, 0.005], flex: -24 },
      },
    },
  ];
  return { duration: 0.7, loop: false, family: 'jump', keys, lag: { head: 0.02, neck: 0.015 } };
}

function female() {
  const keys = [
    {
      t: 0,
      pelvis: { pos: [0, 0.285, -0.1], rot: [14, -4, -4] },
      spine: [34, -10, 0],
      chest: [32, -12, 0],
      neck: [-18, 6, 0],
      head: [-14, 6, 0],
      clav: { l: [-2, 6], r: [-2, 6] },
      reach: {
        r: R([-0.19, 0.32, 0.24], [-0.6, -0.2, -0.6]),
        l: R([0.16, 0.25, 0.25], [0.6, -0.2, -0.6]),
      },
      forearm: { l: 20, r: 20 },
      wrist: { l: [10, 0], r: [10, 0] },
    },
    {
      t: 0.07,
      pelvis: { pos: [0, 0.305, -0.095], rot: [12, -5, -4] },
      spine: [32, -8, 0],
      chest: [30, -10, 0],
      neck: [-14, 5, 0],
      head: [-10, 5, 0],
    },
    // Springing up through a pike, head down.
    {
      t: 0.15,
      ease: -1,
      pelvis: { pos: [-0.005, 0.44, -0.055], rot: [2, -10, -3] },
      spine: [14, -8, 0],
      chest: [12, -8, 0],
      neck: [10, 2, 0],
      head: [14, 2, 0],
      clav: { l: [0, 2], r: [0, 2] },
      reach: {
        r: R([-0.26, 0.42, -0.01], [-0.8, 0, -0.5]),
        l: R([0.19, 0.31, 0.15], [0.7, -0.2, -0.6]),
      },
    },
    {
      t: 0.27,
      pelvis: { pos: [-0.01, 0.635, -0.02], rot: [0, -10, -2] },
      spine: [8, -5, 1],
      chest: [6, -5, 1],
      neck: [10, 2, 0],
      head: [12, 2, 0],
      clav: { l: [6, 0], r: [6, 0] },
      reach: {
        r: R([-0.33, 0.76, -0.06], [-0.9, 0.2, -0.3]),
        l: R([0.3, 0.69, 0.13], [0.9, 0.2, -0.3]),
      },
    },
    // Arms flung up overhead, legs tucked.
    {
      t: 0.47,
      ease: 0.6,
      pelvis: { pos: [-0.005, 0.73, -0.04], rot: [-2, -1, 0] },
      spine: [5, -3, -2],
      chest: [4, -3, -3],
      neck: [6, 2, 0],
      head: [8, 2, 0],
      clav: { l: [14, -4], r: [14, -4] },
      reach: {
        r: R([-0.4, 1.21, 0.01], [-0.9, 0.3, -0.2]),
        l: R([0.47, 1.14, 0.11], [0.9, 0.3, -0.2]),
      },
    },
    {
      t: 0.7,
      ease: 0.8,
      pelvis: { pos: [0, 0.61, -0.062], rot: [3, 0, 0] },
      spine: [6, -2, -2],
      chest: [5, -3, -3],
      neck: [0, 1, 0],
      head: [0, 1, 0],
      clav: { l: [16, -4], r: [16, -4] },
      reach: {
        r: R([-0.3, 1.26, 0.16], [-0.9, 0.3, -0.2]),
        l: R([0.3, 1.12, 0.18], [0.9, 0.3, -0.2]),
      },
    },
    {
      t: 0,
      ease: 1,
      foot: {
        l: {
          pos: [0.15, 0, -0.12],
          ankle: [0.15, 0.085, -0.12],
          plant: 1,
          pitch: 0,
          yaw: 14,
          knee: 12,
          air: 0,
        },
        r: {
          pos: [-0.13, 0, -0.13],
          ankle: [-0.13, 0.085, -0.13],
          plant: 1,
          pitch: 0,
          yaw: 12,
          knee: 12,
          air: 0,
        },
      },
    },
    { t: 0.1, ease: 1, foot: { l: { pitch: 0, plant: 1 }, r: { pitch: 0, plant: 1 } } },
    {
      t: 0.17,
      foot: {
        l: { pitch: -36, plant: 1, ankle: [0.08, 0.14, -0.06], knee: 4 },
        r: { pitch: -36, plant: 1, ankle: [-0.07, 0.14, -0.07], knee: 4 },
      },
    },
    {
      t: 0.21,
      foot: {
        l: { plant: 0, ankle: [0.07, 0.11, -0.04], air: 1, flex: -45 },
        r: { plant: 0, ankle: [-0.07, 0.12, -0.05], air: 1, flex: -45 },
      },
    },
    {
      t: 0.33,
      foot: {
        l: { ankle: [0.06, 0.22, -0.03], flex: -30, knee: 6 },
        r: { ankle: [-0.08, 0.28, -0.07], flex: -30, knee: 6 },
      },
    },
    {
      t: 0.5,
      ease: 0.6,
      foot: {
        l: { ankle: [0.065, 0.33, -0.03], flex: -20 },
        r: { ankle: [-0.08, 0.41, -0.12], flex: -16 },
      },
    },
    {
      t: 0.7,
      ease: 0.8,
      foot: {
        l: { ankle: [0.08, 0.27, -0.03], flex: -24 },
        r: { ankle: [-0.075, 0.13, -0.14], flex: -36 },
      },
    },
  ];
  return { duration: 0.7, loop: false, family: 'jump', keys, lag: { head: 0.02, neck: 0.015 } };
}

export function clip(fit) {
  return fit === 'female' ? female() : male();
}
