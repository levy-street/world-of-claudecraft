// Standing idle, hand-keyed per fit, in the same register as the imported
// reference: a calm, upright stance with the arms hanging at the sides and
// only breathing and small settles moving.
//
// Male: tall and square, legs nearly straight, feet under the hips with the
// right foot a little back, chest lifted, arms hanging loose just behind the
// seams. One breath per loop: the chest and shoulders rise, the arms swing a
// touch out and forward with it, the head drifts down on the exhale.
// Female: weight on the left leg, the right foot drawn in under the body and
// slightly back, knees soft, arms hanging, head inclined. Slow breaths; the
// gaze wanders a little to either side and the hip resettles once.
// Feet never change between keys, so planted contact is exact.

const R = (at, elbow) => ({ at, elbow });

function male() {
  const duration = 2.2;
  const exhale = {
    pelvis: { pos: [0, 0.593, -0.012], rot: [-1, -5, 0] },
    spine: [-3, 2, 0],
    chest: [-5, 3, 0],
    clav: { l: [-1, 0], r: [-1, 0] },
    reach: {
      r: R([-0.2, 0.575, -0.06], [-0.2, 0, -1]),
      l: R([0.195, 0.575, -0.045], [0.2, 0, -1]),
    },
  };
  const inhale = {
    pelvis: { pos: [0.001, 0.594, -0.012], rot: [-1, -5.4, 0] },
    spine: [-3.6, 2, 0],
    chest: [-6.8, 3, 0],
    clav: { l: [1.4, -0.8], r: [1.4, -0.8] },
    reach: {
      r: R([-0.222, 0.58, -0.035], [-0.2, 0, -1]),
      l: R([0.217, 0.58, -0.02], [0.2, 0, -1]),
    },
  };
  const keys = [
    {
      t: 0,
      foot: {
        l: { pos: [0.098, 0, 0.005], yaw: 9, knee: 2 },
        r: { pos: [-0.098, 0, -0.07], yaw: 13, knee: 3 },
      },
      forearm: { l: -15, r: -15 },
      wrist: { l: [8, 0], r: [8, 0] },
      neck: [3, -2, 0],
    },
    { t: 0, ...exhale },
    { t: 0.95, ease: 0.6, ...inhale },
    { t: 2.2, ...exhale },
    // The head dips on the exhale and lifts with the breath, a beat behind it.
    { t: 0, head: [3.5, -3, 0] },
    { t: 0.6, ease: 0.6, head: [0, -3.6, 0] },
    { t: 1.7, ease: 0.6, head: [6.5, -2.4, 0] },
    { t: 2.2, head: [3.5, -3, 0] },
  ];
  return {
    duration,
    loop: true,
    family: 'idle',
    keys,
    lag: { arm: 0.15, elbow: 0.2, head: 0.2, clav: 0.08 },
  };
}

function female() {
  const duration = 5.6;
  const breath = (t, peak, ease = 0.6) => ({
    t,
    ease,
    spine: peak ? [-1.6, -1, 0] : [0, -1, 0],
    chest: peak ? [-3.2, 0, 0] : [-0.6, 0, 0],
    clav: peak ? { l: [1.4, -0.6], r: [1.4, -0.6] } : { l: [-0.8, 0], r: [-0.8, 0] },
  });
  const keys = [
    {
      t: 0,
      foot: {
        l: { pos: [0.098, 0, -0.005], yaw: 6, knee: 1 },
        r: { pos: [-0.06, 0, -0.062], yaw: 22, knee: 8 },
      },
      forearm: { l: -10, r: -10 },
      wrist: { l: [10, 0], r: [10, 0] },
      neck: [5, 0, 0],
    },
    { ...breath(0, false), ease: 0 },
    breath(1.3, true),
    breath(2.8, false),
    breath(4.2, true),
    { ...breath(5.6, false), ease: 0 },
    // Weight over the left foot; a resettle midway.
    {
      t: 0,
      pelvis: { pos: [-0.004, 0.585, 0.002], rot: [0, 1, -1.5] },
      reach: {
        r: R([-0.205, 0.565, 0.01], [-0.2, 0, -1]),
        l: R([0.212, 0.562, 0.02], [0.2, 0, -1]),
      },
    },
    {
      t: 2.3,
      ease: 0.5,
      pelvis: { pos: [0.001, 0.5855, 0.001], rot: [0, 0.4, -0.8] },
      reach: {
        r: R([-0.208, 0.567, -0.002], [-0.2, 0, -1]),
        l: R([0.206, 0.565, 0.006], [0.2, 0, -1]),
      },
    },
    {
      t: 3.5,
      ease: 0.5,
      pelvis: { pos: [0.002, 0.586, 0], rot: [0, 0.2, -0.6] },
      reach: {
        r: R([-0.215, 0.567, 0.02], [-0.2, 0, -1]),
        l: R([0.204, 0.566, 0.028], [0.2, 0, -1]),
      },
    },
    {
      t: 5.6,
      pelvis: { pos: [-0.004, 0.585, 0.002], rot: [0, 1, -1.5] },
      reach: {
        r: R([-0.205, 0.565, 0.01], [-0.2, 0, -1]),
        l: R([0.212, 0.562, 0.02], [0.2, 0, -1]),
      },
    },
    // The gaze wanders to her left, back, a little right, and home.
    { t: 0, ease: 0.8, head: [6, -1, 0] },
    { t: 1.1, ease: 0.9, head: [6, -1.5, 0] },
    { t: 1.5, ease: 0.8, head: [4.5, 6, 0.8] },
    { t: 2.5, ease: 0.9, head: [5, 5.5, 0.6] },
    { t: 2.9, ease: 0.8, head: [7, 1, 0] },
    { t: 3.9, ease: 0.9, head: [6.5, 0, 0] },
    { t: 4.3, ease: 0.8, head: [5.5, -5.5, -0.8] },
    { t: 5.1, ease: 0.9, head: [5.8, -5, -0.6] },
    { t: 5.6, head: [6, -1, 0] },
  ];
  return {
    duration,
    loop: true,
    family: 'idle',
    keys,
    lag: { arm: 0.15, elbow: 0.2, head: 0.05, neck: 0.12, clav: 0.06 },
  };
}

export function clip(fit) {
  return fit === 'female' ? female() : male();
}
