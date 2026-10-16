// Death (Woc_Death), hand-keyed per fit. The game plays it once and holds
// the last frame, so it ends lying still on the floor.
//
// Same story beats as the reference, keyed at those beats only.
// Male: struck in the gut from his ready stance, he doubles over and staggers
// two steps back, straightens and arches with the head thrown back, drops to
// his knees, slumps with the head hanging, sways up once, then pitches forward
// onto his face with the head turned aside, one arm reaching out ahead.
// Female: struck from her bladed guard, she wrenches round to her right and
// bends hard to one side, steps back, sinks to her knees with the head thrown
// back, twists to look back over her right shoulder as her left hand reaches
// for the floor, and topples over to her left onto her front.
// Feet use ground anchors while planted and ankle targets (with `plant`) while
// stepping or kneeling, so planted feet hold still.

const R = (at, elbow) => ({ at, elbow });

function male() {
  const keys = [
    // Ready stance.
    {
      t: 0,
      pelvis: { pos: [-0.03, 0.53, -0.05], rot: [-2, -25, 0] },
      spine: [8, 6, 3],
      chest: [10, 6, 3],
      neck: [-8, 5, 0],
      head: [-6, 6, 0],
      clav: { l: [0, 0], r: [0, 0] },
      reach: {
        r: R([-0.3, 0.58, -0.12], [-0.5, -0.3, -1]),
        l: R([0.3, 0.56, 0.07], [0.6, -0.3, -1]),
      },
      forearm: { l: 10, r: 10 },
      wrist: { l: [10, 0], r: [10, 0] },
    },
    // Struck: doubled over, stepping back with the left foot.
    {
      t: 0.12,
      pelvis: { pos: [-0.05, 0.53, -0.22], rot: [-2, -12, 0] },
      spine: [20, 2, 6],
      chest: [24, 4, 8],
      neck: [12, 0, 0],
      head: [14, 3, 0],
      clav: { l: [-2, 6], r: [-2, 6] },
      reach: {
        r: R([-0.26, 0.55, 0.08], [-0.7, -0.3, -0.6]),
        l: R([0.18, 0.55, 0.25], [0.7, -0.3, -0.6]),
      },
    },
    {
      t: 0.21,
      pelvis: { pos: [-0.05, 0.48, -0.35], rot: [0, 0, 0] },
      spine: [18, 1, 2],
      chest: [18, 1, 0],
      neck: [14, 6, 0],
      head: [16, 8, 0],
    },
    // Second step back, straightening.
    {
      t: 0.32,
      pelvis: { pos: [-0.03, 0.47, -0.43], rot: [0, 0, 0] },
      spine: [6, 0, 0],
      chest: [6, 0, 0],
      neck: [10, 8, 0],
      head: [12, 10, 0],
      clav: { l: [0, 0], r: [0, 0] },
      reach: {
        r: R([-0.29, 0.55, 0.11], [-0.7, -0.3, -0.6]),
        l: R([0.21, 0.66, 0.18], [0.7, -0.3, -0.6]),
      },
    },
    // Arched back, head thrown back, arms out.
    {
      t: 0.5,
      ease: 0.5,
      pelvis: { pos: [-0.023, 0.555, -0.42], rot: [0, 0, 0] },
      spine: [-10, 0, 0],
      chest: [-12, 0, 0],
      neck: [-10, 2, 0],
      head: [-14, 2, 0],
      clav: { l: [4, -4], r: [4, -4] },
      reach: {
        r: R([-0.35, 0.61, -0.02], [-0.6, 0, -1]),
        l: R([0.32, 0.63, 0.01], [0.6, 0, -1]),
      },
    },
    {
      t: 0.6,
      pelvis: { pos: [-0.02, 0.48, -0.35], rot: [0, 0, 0] },
      spine: [-12, 0, 0],
      chest: [-12, 0, 0],
      neck: [-8, -2, 0],
      head: [-12, -3, 0],
    },
    // On the knees.
    {
      t: 0.72,
      pelvis: { pos: [-0.01, 0.29, -0.27], rot: [0, 0, 0] },
      spine: [-6, 0, 0],
      chest: [-6, 0, 0],
      neck: [-6, -2, 0],
      head: [-10, -3, 0],
      clav: { l: [0, 0], r: [0, 0] },
      reach: {
        r: R([-0.35, 0.43, 0.1], [-0.7, 0, -0.8]),
        l: R([0.36, 0.5, 0.06], [0.7, 0, -0.8]),
      },
    },
    // Slumped, head hanging, hands on the thighs.
    {
      t: 0.92,
      ease: 0.5,
      pelvis: { pos: [-0.008, 0.28, -0.2], rot: [2, -6, 0] },
      spine: [16, 0, 1],
      chest: [18, 0, 2],
      neck: [16, 0, 0],
      head: [24, -2, 0],
      reach: {
        r: R([-0.22, 0.25, 0.13], [-0.7, 0, -0.6]),
        l: R([0.23, 0.25, 0.12], [0.7, 0, -0.6]),
      },
    },
    // Sways up as he tips forward from the knees.
    {
      t: 1.1,
      pelvis: { pos: [-0.008, 0.245, -0.04], rot: [13, -13, 3] },
      spine: [-12, 0, -1],
      chest: [-10, 0, -2],
      neck: [6, 2, 0],
      head: [10, 4, 0],
      reach: {
        r: R([-0.28, 0.28, -0.06], [-0.7, 0, -0.7]),
        l: R([0.33, 0.39, 0.13], [0.7, 0, -0.7]),
      },
    },
    // Toppling stiffly from the knees, back still arched.
    {
      t: 1.2,
      pelvis: { pos: [-0.005, 0.18, 0.035], rot: [28, -14, 7] },
      spine: [-14, 2, -1],
      chest: [-12, 2, -1],
      neck: [0, 10, 0],
      head: [-2, 16, 0],
    },
    // Pitching onto his face.
    {
      t: 1.29,
      pelvis: { pos: [0, 0.095, 0.07], rot: [62, -14, 13] },
      spine: [-6, 4, 0],
      chest: [-4, 6, 0],
      neck: [4, 20, 0],
      head: [6, 30, 0],
      reach: {
        r: R([-0.39, 0.13, 0.01], [-0.6, 0.6, -0.4]),
        l: R([0.31, 0.2, 0.46], [0.6, 0.6, -0.4]),
      },
    },
    // Landed, face turned aside.
    {
      t: 1.42,
      ease: 0.5,
      pelvis: { pos: [0, 0.075, 0.08], rot: [74, -14, 14] },
      spine: [3, 5, 0],
      chest: [5, 7, 0],
      neck: [-6, 28, 0],
      head: [-8, 38, 0],
      reach: {
        r: R([-0.4, 0.05, 0.03], [-0.5, 0.8, -0.2]),
        l: R([0.32, 0.03, 0.5], [0.5, 0.8, -0.2]),
      },
    },
    {
      t: 1.6,
      ease: 0.8,
      pelvis: { pos: [0, 0.055, 0.08], rot: [72, -14, 14] },
      spine: [4, 5, 0],
      chest: [5, 7, 0],
      neck: [-8, 28, 0],
      head: [-10, 40, 0],
      reach: {
        r: R([-0.395, 0.045, 0.02], [-0.5, 0.8, -0.2]),
        l: R([0.34, 0.03, 0.49], [0.5, 0.8, -0.2]),
      },
    },
    {
      t: 1.833,
      pelvis: { pos: [0, 0.05, 0.078], rot: [72, -14, 14] },
      spine: [4, 5, 0],
      chest: [5, 7, 0],
      neck: [-8, 28, 0],
      head: [-10, 40, 0],
      reach: {
        r: R([-0.395, 0.04, 0.015], [-0.5, 0.8, -0.2]),
        l: R([0.34, 0.025, 0.49], [0.5, 0.8, -0.2]),
      },
    },
    // Feet. Left: planted, steps back, planted, then to the knees and flat behind.
    {
      t: 0,
      ease: 1,
      foot: {
        l: {
          pos: [0.2, 0, 0.09],
          ankle: [0.2, 0.085, 0.09],
          plant: 1,
          pitch: 0,
          yaw: 18,
          knee: 6,
          air: 0,
          airYaw: 0,
        },
        r: {
          pos: [-0.21, 0, -0.24],
          ankle: [-0.21, 0.085, -0.24],
          plant: 1,
          pitch: 0,
          yaw: 30,
          knee: 8,
          air: 0,
          airYaw: 0,
        },
      },
    },
    { t: 0.04, ease: 1, foot: { l: { plant: 1, pitch: -8 } } },
    {
      t: 0.11,
      foot: { l: { plant: 0, ankle: [0.12, 0.15, -0.18], air: 0.5, flex: -10, pitch: 0 } },
    },
    {
      t: 0.2,
      ease: 1,
      foot: { l: { plant: 1, pos: [0.1, 0, -0.43], ankle: [0.1, 0.085, -0.43], air: 0, yaw: 10 } },
    },
    { t: 0.6, ease: 1, foot: { l: { plant: 1, pitch: 0 } } },
    { t: 0.66, foot: { l: { plant: 0.3, pitch: -30, ankle: [0.11, 0.13, -0.41], air: 0.3 } } },
    {
      t: 0.74,
      ease: 0.6,
      foot: { l: { plant: 0, ankle: [0.1, 0.15, -0.4], air: 1, flex: -42, knee: 2 } },
    },
    { t: 1.1, ease: 0.6, foot: { l: { ankle: [0.08, 0.13, -0.39], flex: -45 } } },
    { t: 1.29, foot: { l: { ankle: [0.08, 0.075, -0.41], flex: -55 } } },
    { t: 1.42, ease: 1, foot: { l: { ankle: [0.09, 0.06, -0.42], flex: -60 } } },
    { t: 1.833, foot: { l: { ankle: [0.09, 0.06, -0.42], flex: -60 } } },
    // Right: planted, heel rises, steps back, planted, then knees and flat.
    { t: 0.17, ease: 1, foot: { r: { plant: 1, pitch: 0 } } },
    { t: 0.22, ease: 1, foot: { r: { plant: 1, pitch: -14 } } },
    {
      t: 0.27,
      foot: { r: { plant: 0, ankle: [-0.21, 0.13, -0.37], air: 0.5, flex: -10, pitch: 0 } },
    },
    {
      t: 0.33,
      ease: 1,
      foot: { r: { plant: 1, pos: [-0.2, 0, -0.5], ankle: [-0.2, 0.085, -0.5], air: 0, yaw: 24 } },
    },
    { t: 0.6, ease: 1, foot: { r: { plant: 1, pitch: 0 } } },
    { t: 0.66, foot: { r: { plant: 0.3, pitch: -30, ankle: [-0.17, 0.12, -0.45], air: 0.3 } } },
    {
      t: 0.74,
      ease: 0.6,
      foot: { r: { plant: 0, ankle: [-0.15, 0.15, -0.4], air: 1, flex: -42, knee: 2 } },
    },
    { t: 1.1, ease: 0.6, foot: { r: { ankle: [-0.15, 0.13, -0.41], flex: -45 } } },
    { t: 1.29, foot: { r: { ankle: [-0.155, 0.08, -0.44], flex: -55 } } },
    { t: 1.42, ease: 1, foot: { r: { ankle: [-0.16, 0.05, -0.45], flex: -60 } } },
    { t: 1.833, foot: { r: { ankle: [-0.16, 0.05, -0.45], flex: -60 } } },
  ];
  return {
    duration: 1.833,
    loop: false,
    family: 'death',
    keys,
    lag: { head: 0.03, neck: 0.02, arm: 0.02, elbow: 0.03 },
  };
}

function female() {
  const front = [0.165, 0, 0.16],
    back = [-0.133, 0, -0.227];
  const keys = [
    // Her bladed guard.
    {
      t: 0,
      pelvis: { pos: [-0.005, 0.54, -0.015], rot: [2, -40, 0] },
      spine: [0, -6, 0],
      chest: [0, -6, 0],
      neck: [5, 22, 0],
      head: [5, 26, 0],
      clav: { l: [0, 0], r: [0, 0] },
      reach: {
        r: R([-0.16, 0.53, -0.24], [-0.3, 0, -1]),
        l: R([-0.07, 0.74, 0.23], [0.8, -0.6, 0]),
      },
      forearm: { l: 40, r: 10 },
      wrist: { l: [20, 0], r: [10, 0] },
    },
    // Wrenched round to the right, hands dropping.
    {
      t: 0.2,
      pelvis: { pos: [-0.02, 0.55, -0.045], rot: [-4, -60, 6] },
      spine: [8, -14, 4],
      chest: [10, -16, 6],
      neck: [0, 12, 0],
      head: [-4, 16, 0],
      clav: { l: [-2, 4], r: [-2, 4] },
      reach: {
        r: R([-0.09, 0.57, -0.24], [-0.6, -0.2, -0.8]),
        l: R([-0.13, 0.59, 0.26], [0.6, -0.2, -0.8]),
      },
    },
    // Bent hard to the side.
    {
      t: 0.45,
      ease: 0.5,
      pelvis: { pos: [-0.03, 0.51, -0.14], rot: [-2, -90, -2] },
      spine: [-4, -2, 20],
      chest: [-6, 0, 24],
      neck: [-6, 14, -4],
      head: [-10, 18, -6],
      clav: { l: [-4, 0], r: [4, 0] },
      reach: {
        r: R([-0.06, 0.46, -0.18], [-0.6, -0.4, -0.6]),
        l: R([-0.02, 0.5, 0.22], [0.6, -0.4, -0.6]),
      },
    },
    // Straightening as the right foot steps back.
    {
      t: 0.64,
      pelvis: { pos: [-0.03, 0.55, -0.19], rot: [10, -86, -2] },
      spine: [4, 14, 6],
      chest: [4, 16, 6],
      neck: [0, -6, 0],
      head: [0, -10, 0],
      clav: { l: [0, 0], r: [0, 0] },
      reach: {
        r: R([-0.09, 0.53, -0.2], [-0.6, -0.3, -0.7]),
        l: R([0.05, 0.52, 0.32], [0.6, -0.3, -0.7]),
      },
    },
    // Sinking, head dropping.
    {
      t: 0.75,
      pelvis: { pos: [-0.02, 0.5, -0.2], rot: [14, -85, -2] },
      spine: [6, 18, -6],
      chest: [6, 20, -8],
      neck: [4, -8, 0],
      head: [2, -12, 0],
      reach: {
        r: R([-0.06, 0.55, -0.15], [-0.6, -0.3, -0.7]),
        l: R([0.04, 0.43, 0.24], [0.6, -0.3, -0.7]),
      },
    },
    // On her knees, head thrown back.
    {
      t: 0.86,
      pelvis: { pos: [-0.02, 0.265, -0.18], rot: [8, -85, -2] },
      spine: [-4, 16, -10],
      chest: [-6, 18, -12],
      neck: [-10, -14, 0],
      head: [-14, -18, 0],
      reach: {
        r: R([-0.06, 0.33, -0.2], [-0.6, -0.2, -0.7]),
        l: R([0.04, 0.25, 0.22], [0.6, -0.2, -0.7]),
      },
    },
    // Looking back over the right shoulder, left hand reaching for the floor.
    {
      t: 1.05,
      ease: 0.4,
      pelvis: { pos: [-0.015, 0.29, -0.12], rot: [4, -86, 0] },
      spine: [4, -14, 0],
      chest: [4, -18, 2],
      neck: [10, -24, 0],
      head: [14, -30, 0],
      reach: {
        r: R([-0.05, 0.35, -0.34], [-0.6, -0.2, -0.7]),
        l: R([-0.22, 0.29, 0.17], [0.6, 0.2, -0.7]),
      },
    },
    // Toppling over to her left.
    {
      t: 1.25,
      pelvis: { pos: [-0.012, 0.24, -0.04], rot: [6, -100, 40] },
      spine: [-6, -18, 6],
      chest: [-6, -20, 8],
      neck: [-6, -16, 0],
      head: [-10, -20, 0],
      reach: {
        r: R([-0.17, 0.27, -0.36], [-0.6, 0.2, -0.7]),
        l: R([-0.44, 0.19, 0.06], [0.6, 0.4, -0.5]),
      },
    },
    // Down on her front, rolled toward her left.
    {
      t: 1.42,
      ease: 0.5,
      pelvis: { pos: [-0.01, 0.075, 0.06], rot: [42, -100, 70] },
      spine: [8, -10, 6],
      chest: [10, -12, 8],
      neck: [-4, -24, 0],
      head: [-6, -30, 0],
      reach: {
        r: R([-0.31, 0.1, -0.17], [-0.6, 0.5, -0.4]),
        l: R([-0.49, 0.02, 0.0], [0.6, 0.6, -0.3]),
      },
    },
    {
      t: 1.667,
      ease: 0.8,
      pelvis: { pos: [-0.01, 0.07, 0.065], rot: [46, -98, 76] },
      spine: [10, -10, 6],
      chest: [12, -12, 8],
      neck: [-4, -26, 0],
      head: [-6, -32, 0],
      reach: {
        r: R([-0.38, 0.11, -0.02], [-0.6, 0.5, -0.4]),
        l: R([-0.5, 0.02, 0.2], [0.6, 0.6, -0.3]),
      },
    },
    // Feet: right steps back, left follows, both to the knees, then flat behind.
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
          airYaw: 0,
        },
        r: {
          pos: back,
          ankle: [-0.133, 0.085, -0.227],
          plant: 1,
          pitch: 0,
          yaw: 55,
          knee: 6,
          air: 0,
          airYaw: 0,
        },
      },
    },
    { t: 0.1, ease: 1, foot: { l: { plant: 1, pitch: 0 } } },
    { t: 0.17, foot: { l: { plant: 0, ankle: [0.12, 0.12, 0.12], air: 0.4, flex: -10 } } },
    {
      t: 0.3,
      ease: 1,
      foot: { l: { plant: 1, pos: [0.07, 0, 0.09], ankle: [0.07, 0.085, 0.09], air: 0, yaw: -45 } },
    },
    { t: 0.55, ease: 1, foot: { r: { plant: 1, pitch: 0 } } },
    {
      t: 0.63,
      foot: { r: { plant: 0, ankle: [-0.01, 0.13, -0.33], air: 0.4, flex: -10, yaw: 80 } },
    },
    {
      t: 0.71,
      ease: 1,
      foot: { r: { plant: 1, pos: [0.06, 0, -0.355], ankle: [0.06, 0.085, -0.355], air: 0 } },
    },
    { t: 0.68, ease: 1, foot: { l: { plant: 1, pitch: 0 } } },
    {
      t: 0.75,
      foot: { l: { plant: 0, ankle: [0.11, 0.12, 0.03], air: 0.5, flex: -20, yaw: -80 } },
    },
    {
      t: 0.85,
      ease: 0.6,
      foot: {
        l: { plant: 0, ankle: [0.15, 0.07, 0.0], air: 1, flex: -45 },
        r: { plant: 0, ankle: [0.14, 0.07, -0.33], air: 1, flex: -45 },
      },
    },
    {
      t: 1.25,
      ease: 0.6,
      foot: {
        l: { ankle: [0.14, 0.06, 0.0], flex: -50 },
        r: { ankle: [0.19, 0.08, -0.27], flex: -45 },
      },
    },
    {
      t: 1.42,
      ease: 0.8,
      foot: {
        l: { ankle: [0.14, 0.05, 0.0], flex: -55 },
        r: { ankle: [0.19, 0.06, -0.23], flex: -50 },
      },
    },
    {
      t: 1.667,
      foot: {
        l: { ankle: [0.14, 0.05, 0.0], flex: -55 },
        r: { ankle: [0.19, 0.06, -0.24], flex: -50 },
      },
    },
  ];
  return {
    duration: 1.667,
    loop: false,
    family: 'death',
    keys,
    lag: { head: 0.03, neck: 0.02, arm: 0.02, elbow: 0.03 },
  };
}

export function clip(fit) {
  return fit === 'female' ? female() : male();
}
