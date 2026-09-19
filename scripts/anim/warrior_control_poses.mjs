/** Native rig donors with planted feet supplied by the caller's offline IK.
 * Fast loading, a readable contact hold, then recovery inside one GCD. */
export function warriorControlPerformances(idle, bladePose, openArms) {
  const lowLoad = bladePose(2, 0.27, [0, -0.035, -0.02], -24, 8, -8);
  const lowCut = bladePose(2, 0.48, [0, -0.09, 0.045], 24, 28, -8);
  const lowFollow = bladePose(2, 0.62, [0, -0.07, 0.025], 32, 20, -4);
  const pryLoad = bladePose(5, 0.13, [0, -0.025, -0.025], -16, -3);
  const pryBite = bladePose(5, 0.24, [0, -0.04, 0.055], 12, 8);
  const pryPull = bladePose(5, 0.16, [0, -0.03, -0.025], -22, -5);
  // A throw is led by a raised elbow and an upright, target-facing head.
  // Use idle shoulders as the base: the diagonal sword donor folds the torso.
  const throwLoad = openArms(bladePose(0, 0.3, [0.025, -0.045, -0.035], -24, -3, -4), 1, [
    [0.43, -0.12, 0.12],
    [-0.36, 0.41, -0.13],
  ]);
  const throwGather = openArms(bladePose(0, 0.3, [0.018, -0.052, -0.025], -18, -2, -3), 1, [
    [0.45, -0.08, 0.17],
    [-0.35, 0.42, -0.09],
  ]);
  const throwRelease = openArms(bladePose(0, 0.3, [-0.01, -0.035, 0.045], 15, 3, 3), 1, [
    [0.46, -0.14, 0.06],
    [-0.2, 0.23, 0.47],
  ]);
  const throwFollow = openArms(bladePose(0, 0.3, [-0.025, -0.045, 0.035], 27, 4, 5), 1, [
    [0.43, -0.1, 0.03],
    [-0.06, 0.01, 0.43],
  ]);
  const throwBrake = openArms(bladePose(0, 0.3, [-0.015, -0.035, 0.012], 10, 1, -2), 1, [
    [0.41, -0.1, 0.11],
    [-0.2, -0.15, 0.28],
  ]);
  const jabLoad = bladePose(9, 0.14, [0, -0.025, -0.02], -3, -2);
  const jabContact = bladePose(9, 0.32, [0, -0.035, 0.04], 4, 3);
  const jabRecover = bladePose(9, 0.5, [0, -0.02, 0.015], 2, 1);
  return [
    [
      'Warrior_Jawcrack',
      [
        [0, idle],
        [0.065, jabLoad],
        [0.15, jabContact],
        [0.185, jabContact],
        [0.32, jabRecover],
        [0.62, idle],
      ],
    ],
    [
      'Warrior_Hobbling_Cut',
      [
        [0, idle],
        [0.075, lowLoad],
        [0.15, lowCut],
        [0.185, lowCut],
        [0.3, lowFollow],
        [0.62, idle],
      ],
    ],
    [
      'Warrior_Armor_Shear',
      [
        [0, idle],
        [0.065, pryLoad],
        [0.15, pryBite],
        [0.19, pryBite],
        [0.32, pryPull],
        [0.64, idle],
      ],
    ],
    [
      'Warrior_Storm_Bolt',
      [
        [0, idle],
        [0.065, throwLoad],
        [0.095, throwGather],
        [0.14, throwRelease],
        [0.22, throwFollow],
        [0.285, throwFollow],
        [0.43, throwBrake],
        [0.82, idle],
      ],
    ],
  ];
}
