// One-handed melee swing (Woc_Attack_1H_0 slot), hand-keyed per fit.
//
// Key poses are authored at the same story beats as the imported reference
// (guard, coil, cock, strike, follow-through, return), posed by hand in this
// rig's own controls: hands placed with `reach` (IK posing, keyed as joint
// angles), the sword aimed with `blade` at anchor poses only.
//
// Male, "forehand cleave": from a crouched guard with the sword low at his
// right, he coils right and slides the lead foot in, cocks the blade high over
// his right shoulder as he rises, then unwinds hard: the right foot leaves the
// floor, the hips drive in and the blade sweeps around the right side and down
// across the front to finish low by his left knee in a deep lunge. A flat
// return sweep at hip height brings it back to guard as the lead foot steps back.
// Female, "wrapping backhand": from a bladed guard (hips turned right, off hand
// across the chest) the sword lifts in front of her face and settles across the
// back of her left shoulder while she coils left and sits back. She snaps it
// around her head and across at shoulder height, hips dropping forward, and
// lets it wrap behind her right side as she turns away, then unwinds to guard.
// Planted feet only roll about the heel or ball; a stepping or lifted foot
// leaves the floor before it moves and lands where its eased key holds it.

const R = (at, elbow) => ({ at, elbow });

/** The one-handed ready guard each fit swings from and returns to (all sword swings). */
export const SWORD_GUARD = {
  male: {
    pelvis: { pos: [-0.03, 0.53, -0.05], rot: [8, -26, 0] },
    spine: [10, 6, -3],
    chest: [12, 7, -4],
    neck: [-12, 6, 2],
    head: [-16, 7, 2],
    clav: { l: [0, 0], r: [0, 0] },
    reach: {
      r: R([-0.32, 0.53, -0.08], [-0.4, -0.2, -1]),
      l: R([0.31, 0.52, 0.1], [0.6, -0.2, -1]),
    },
    forearm: { l: 25 },
    wrist: { l: [10, 0] },
    blade: { r: [-0.5, -0.2, 0.84] },
  },
  female: {
    pelvis: { pos: [-0.005, 0.54, -0.015], rot: [2, -40, 0] },
    spine: [0, -6, 0],
    chest: [0, -6, 0],
    neck: [5, 22, 0],
    head: [5, 26, 0],
    clav: { l: [0, 0], r: [0, 0] },
    reach: {
      r: R([-0.16, 0.52, -0.24], [-0.3, 0, -1]),
      l: R([-0.07, 0.73, 0.22], [0.8, -0.6, 0]),
    },
    forearm: { l: 40 },
    wrist: { l: [20, 0] },
    blade: { r: [-0.64, 0.23, 0.73] },
  },
};
/** Guard foot anchors: the lead (left) and rear (right) feet. */
export const SWORD_FEET = {
  male: { lead: [0.185, 0, 0.08], rear: [-0.175, 0, -0.235] },
  female: { lead: [0.165, 0, 0.16], rear: [-0.133, 0, -0.227] },
};

function male() {
  const { lead, rear } = SWORD_FEET.male;
  const lunge = [0.162, 0, 0.278];
  const guard = SWORD_GUARD.male;
  const keys = [
    { t: 0, ...guard },
    // Coil: dip, turn right, sword lifted beside the right shoulder.
    {
      t: 0.17,
      ease: 0.5,
      pelvis: { pos: [-0.06, 0.485, 0.03], rot: [3, -27, -2] },
      spine: [2, -12, -8],
      chest: [0, -14, -9],
      neck: [-2, 12, 4],
      head: [-3, 14, 4],
      clav: { r: [6, -4], l: [0, 4] },
      reach: {
        r: R([-0.4, 0.82, -0.25], [-0.6, -0.8, 0]),
        l: R([0.2, 0.55, 0.3], [0.7, -0.5, -0.3]),
      },
      blade: { r: [-0.35, 0.93, 0.05] },
    },
    // Cocked: risen onto the lead leg, blade back over the shoulder.
    {
      t: 0.3,
      ease: 0.4,
      pelvis: { pos: [0.08, 0.572, 0.2], rot: [6, -25, 0] },
      spine: [3, 0, 0],
      chest: [3, 2, 0],
      neck: [-4, 10, 0],
      head: [-5, 12, 0],
      clav: { r: [10, -6], l: [2, 2] },
      reach: {
        r: R([-0.43, 0.97, -0.12], [-1, 0.1, -0.2]),
        l: R([0.36, 0.6, 0.16], [0.8, -0.4, -0.3]),
      },
      blade: { r: [0, 0.62, -0.78] },
    },
    // Release: hips and chest fire; the blade swings out around the right side.
    {
      t: 0.39,
      pelvis: { pos: [0.105, 0.555, 0.255], rot: [7, -22, 1] },
      spine: [4, 14, 4],
      chest: [5, 18, 5],
      neck: [-4, -10, -2],
      head: [-5, -12, -2],
      clav: { r: [8, 4] },
      reach: {
        r: R([-0.32, 0.92, 0.3], [-1, -0.4, 0]),
        l: R([0.4, 0.59, -0.08], [0.8, -0.2, -0.5]),
      },
      blade: { r: [-0.8, 0.45, -0.1] },
      bladeRange: { r: { sup: [-100, 60] } },
    },
    // Mid-swing: the blade stays level as it comes around the right side.
    {
      t: 0.413,
      ease: -1,
      reach: { r: R([-0.1, 0.8, 0.5], [-0.6, -0.8, 0.2]) },
      blade: { r: [-0.62, 0.28, 0.73] },
      bladeRange: { r: { sup: [-100, 50] } },
    },
    // Strike: arm long across the front, blade through the target.
    {
      t: 0.435,
      ease: -1,
      pelvis: { pos: [0.105, 0.47, 0.29], rot: [10, -18, 3] },
      spine: [6, 34, 10],
      chest: [8, 46, 12],
      neck: [-6, -30, -6],
      head: [-8, -34, -6],
      clav: { r: [0, 10], l: [-2, -6] },
      reach: {
        r: R([0.2, 0.66, 0.46], [-0.3, -1, 0.2]),
        l: R([0.31, 0.57, -0.3], [0.4, -0.3, -1]),
      },
      blade: { r: [-0.2, 0.18, 0.96] },
      bladeRange: { r: { sup: [-100, 0] } },
    },
    // Follow-through: deepest lunge, torso folded left, blade low by the knee.
    {
      t: 0.48,
      ease: 0.5,
      pelvis: { pos: [0.088, 0.42, 0.265], rot: [12, -15, 4] },
      spine: [12, 40, 12],
      chest: [16, 50, 14],
      neck: [-10, -34, -8],
      head: [-12, -38, -8],
      clav: { r: [-4, 8], l: [-2, -4] },
      reach: {
        r: R([0.31, 0.42, 0.16], [0.2, -0.3, -1]),
        l: R([0.2, 0.59, -0.4], [0.3, 0, -1]),
      },
      blade: { r: [0.87, -0.22, -0.44] },
    },
    // Hold at the bottom: the blade drifts up a touch as the weight settles.
    {
      t: 0.6,
      ease: 0.7,
      pelvis: { pos: [0.065, 0.418, 0.21], rot: [12, -16, 4] },
      spine: [13, 37, 11],
      chest: [17, 46, 13],
      neck: [-11, -31, -7],
      head: [-13, -35, -7],
      reach: {
        r: R([0.25, 0.41, 0.22], [0.2, -0.3, -1]),
        l: R([0.19, 0.58, -0.41], [0.3, 0, -1]),
      },
      blade: { r: [0.85, -0.2, -0.48] },
    },
    // Return sweep: blade comes back flat at hip height as he unwinds.
    {
      t: 0.74,
      ease: 0.3,
      pelvis: { pos: [0.03, 0.44, 0.1], rot: [12, -20, 2] },
      spine: [14, 26, 8],
      chest: [16, 30, 8],
      neck: [-14, -20, -4],
      head: [-16, -24, -4],
      clav: { r: [0, 4], l: [0, 0] },
      reach: {
        r: R([0.1, 0.45, 0.29], [0, -0.6, -1]),
        l: R([0.28, 0.55, -0.33], [0.5, 0, -1]),
      },
      blade: { r: [0.97, 0.18, 0.1] },
    },
    // Settle toward guard.
    {
      t: 0.88,
      ease: 0.5,
      pelvis: { pos: [-0.02, 0.53, -0.01], rot: [9, -25, 0] },
      spine: [10, 12, 0],
      chest: [12, 14, 0],
      neck: [-12, -6, 0],
      head: [-14, -8, 0],
      clav: { r: [0, 0], l: [0, 0] },
      reach: {
        r: R([-0.24, 0.53, 0.13], [-0.3, -0.4, -1]),
        l: R([0.37, 0.56, -0.05], [0.6, -0.2, -1]),
      },
      blade: { r: [0.25, 0.05, 0.97] },
    },
    { t: 1, ...guard },
    // Lead foot slides in (lifted clear) as he coils, plants for the strike.
    { t: 0, ease: 1, foot: { l: { pos: lead, pitch: 0, yaw: 18, knee: 6 } } },
    { t: 0.08, ease: 1, foot: { l: { pos: lead, pitch: -6 } } },
    { t: 0.097, foot: { l: { pos: [0.185, 0.008, 0.082], pitch: -6 } } },
    { t: 0.12, foot: { l: { pos: [0.183, 0.016, 0.1], pitch: -6 } } },
    { t: 0.16, foot: { l: { pos: [0.176, 0.02, 0.18], pitch: -4 } } },
    { t: 0.215, foot: { l: { pos: [0.163, 0.012, 0.272], pitch: 2 } } },
    { t: 0.245, ease: 1, foot: { l: { pos: lunge, pitch: 0, yaw: 14 } } },
    { t: 0.8, ease: 1, foot: { l: { pos: lunge, pitch: 0, yaw: 14 } } },
    { t: 0.83, foot: { l: { pos: [0.164, 0.014, 0.268], pitch: -5 } } },
    { t: 0.87, foot: { l: { pos: [0.174, 0.02, 0.18], pitch: -3 } } },
    { t: 0.905, foot: { l: { pos: [0.183, 0.012, 0.094], pitch: 2 } } },
    { t: 0.935, ease: 1, foot: { l: { pos: lead, pitch: 0, yaw: 18 } } },
    { t: 1, ease: 1, foot: { l: { pos: lead, pitch: 0, yaw: 18, knee: 6 } } },
    // Rear foot: heel rises, the foot leaves the floor through the strike, lands back.
    { t: 0, ease: 1, foot: { r: { pos: rear, pitch: 0, yaw: 32, knee: 8 } } },
    { t: 0.2, ease: 1, foot: { r: { pos: rear, pitch: -14 } } },
    { t: 0.23, foot: { r: { pos: [-0.176, 0.014, -0.226], pitch: -24 } } },
    { t: 0.27, foot: { r: { pos: [-0.178, 0.04, -0.16], pitch: -30 } } },
    { t: 0.42, foot: { r: { pos: [-0.2, 0.12, -0.02], pitch: -38 } } },
    { t: 0.56, foot: { r: { pos: [-0.192, 0.07, -0.14], pitch: -30 } } },
    { t: 0.67, foot: { r: { pos: [-0.178, 0.022, -0.212], pitch: -10 } } },
    { t: 0.705, foot: { r: { pos: [-0.176, 0.008, -0.232], pitch: -4 } } },
    { t: 0.735, ease: 1, foot: { r: { pos: rear, pitch: 0, yaw: 32 } } },
    { t: 1, ease: 1, foot: { r: { pos: rear, pitch: 0, yaw: 32, knee: 8 } } },
  ];
  return {
    duration: 1,
    loop: false,
    family: 'attack',
    keys,
    lag: { 'arm.l': 0.03, 'elbow.l': 0.04, head: 0.025, neck: 0.015, 'blade.r': 0.012 },
  };
}

function female() {
  const { lead: front, rear: back } = SWORD_FEET.female;
  const guard = SWORD_GUARD.female;
  const keys = [
    { t: 0, ...guard },
    // Lift: the sword comes up in front of her face.
    {
      t: 0.08,
      pelvis: { pos: [-0.01, 0.53, -0.04], rot: [1, -28, 0] },
      spine: [0, 4, 0],
      chest: [-2, 8, 0],
      neck: [4, 8, 0],
      head: [5, 10, 0],
      reach: {
        r: R([-0.06, 0.82, 0.22], [-0.8, -0.6, 0]),
        l: R([0.1, 0.65, 0.2], [0.8, -0.5, 0]),
      },
      blade: { r: [0.55, 0.83, 0] },
    },
    // Chamber: sword across the back of the left shoulder, coiled left, sitting back.
    {
      t: 0.2,
      ease: 0.5,
      pelvis: { pos: [-0.017, 0.512, -0.085], rot: [-2, -8, 0] },
      spine: [-2, 20, 0],
      chest: [-3, 26, 0],
      neck: [6, -18, 0],
      head: [7, -22, 0],
      clav: { r: [6, 10], l: [0, -4] },
      reach: {
        r: R([0.2, 0.93, 0.05], [-0.3, -0.3, 1]),
        l: R([0.3, 0.52, -0.2], [0.5, 0, -1]),
      },
      blade: { r: [-0.55, 0.22, -0.8] },
    },
    // Loaded: still coiled, the hips start to turn back.
    {
      t: 0.3,
      ease: 0.6,
      pelvis: { pos: [-0.018, 0.53, -0.08], rot: [-1, -11, 0] },
      spine: [-2, 16, 0],
      chest: [-2, 22, 0],
      neck: [6, -14, 0],
      head: [7, -17, 0],
      reach: {
        r: R([0.15, 0.9, 0.15], [-0.3, -0.4, 1]),
        l: R([0.31, 0.55, -0.18], [0.5, 0, -1]),
      },
      blade: { r: [-0.15, 0.3, -0.94] },
    },
    // Around the head: the blade swings past the left side.
    {
      t: 0.355,
      pelvis: { pos: [-0.012, 0.53, -0.025], rot: [1, -17, 0] },
      spine: [0, 10, 0],
      chest: [1, 14, 0],
      neck: [6, -6, 0],
      head: [7, -8, 0],
      clav: { r: [6, 6] },
      reach: {
        r: R([0, 0.85, 0.29], [-0.5, -0.8, 0.3]),
        l: R([0.34, 0.57, -0.05], [0.6, -0.2, -0.6]),
      },
      blade: { r: [0.65, 0.42, -0.62] },
    },
    // Strike: arm long to the right front, blade through the target.
    {
      t: 0.405,
      ease: -1,
      pelvis: { pos: [-0.002, 0.495, 0.09], rot: [5, -25, 1] },
      spine: [3, -4, 0],
      chest: [4, -6, 2],
      neck: [6, 14, 0],
      head: [7, 17, 0],
      clav: { r: [2, 6], l: [0, 0] },
      reach: {
        r: R([-0.3, 0.72, 0.15], [-0.3, -1, 0]),
        l: R([0.25, 0.5, 0.22], [0.6, -0.4, 0.2]),
      },
      blade: { r: [0, 0.1, 1] },
    },
    // Wrap: turned away to the right, blade behind her, lowest point.
    {
      t: 0.49,
      ease: 0.6,
      pelvis: { pos: [0.015, 0.44, 0.11], rot: [8, -38, 2] },
      spine: [4, -20, 2],
      chest: [4, -26, 2],
      neck: [8, 30, 0],
      head: [8, 32, 0],
      clav: { r: [0, 0], l: [0, 6] },
      reach: {
        r: R([0.05, 0.66, -0.4], [0, -1, 0]),
        l: R([-0.1, 0.45, 0.28], [0.3, -0.6, 0.6]),
      },
      blade: { r: [-0.45, -0.42, -0.79] },
    },
    // Hold, fully turned, before unwinding.
    {
      t: 0.62,
      ease: 0.7,
      pelvis: { pos: [0.016, 0.45, 0.08], rot: [8, -40, 2] },
      spine: [4, -21, 2],
      chest: [4, -27, 2],
      neck: [8, 31, 0],
      head: [8, 33, 0],
      reach: {
        r: R([0.08, 0.65, -0.4], [0, -1, 0]),
        l: R([-0.14, 0.5, 0.25], [0.3, -0.6, 0.6]),
      },
      blade: { r: [-0.5, -0.45, -0.74] },
    },
    // Unwrap: blade comes around her right side, low.
    {
      t: 0.78,
      ease: 0.4,
      pelvis: { pos: [0.011, 0.49, 0.025], rot: [6, -42, 1] },
      spine: [3, -16, 1],
      chest: [3, -16, 1],
      neck: [8, 26, 0],
      head: [8, 30, 0],
      clav: { r: [0, 0], l: [0, 0] },
      reach: {
        r: R([-0.01, 0.58, -0.39], [0, -1, 0]),
        l: R([-0.15, 0.66, 0.2], [0.6, -0.6, 0]),
      },
      blade: { r: [-0.85, -0.42, -0.3] },
    },
    { t: 1, ...guard },
    // Feet stay planted; the rear heel rises as the hips drive through.
    {
      t: 0,
      ease: 1,
      foot: {
        l: { pos: front, pitch: 0, yaw: -10, knee: 4 },
        r: { pos: back, pitch: 0, yaw: 55, knee: 6 },
      },
    },
    { t: 0.36, ease: 1, foot: { r: { pitch: -2 } } },
    { t: 0.5, foot: { r: { pitch: -14 } } },
    { t: 0.62, foot: { r: { pitch: -12 } } },
    {
      t: 1,
      ease: 1,
      foot: {
        l: { pos: front, pitch: 0, yaw: -10, knee: 4 },
        r: { pos: back, pitch: 0, yaw: 55, knee: 6 },
      },
    },
  ];
  return {
    duration: 1,
    loop: false,
    family: 'attack',
    keys,
    lag: { 'arm.l': 0.03, 'elbow.l': 0.04, head: 0.02, neck: 0.012, 'blade.r': 0.01 },
  };
}

export function clip(fit) {
  return fit === 'female' ? female() : male();
}
