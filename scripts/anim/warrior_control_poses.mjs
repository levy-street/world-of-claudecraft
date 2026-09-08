/** Native rig donors with planted feet supplied by the caller's offline IK.
 * Fast loading, a readable contact hold, then recovery inside one GCD. */
export function warriorControlPerformances(idle, bladePose, openArms) {
  const lowLoad = bladePose(2, 0.27, [0, -0.035, -0.02], -24, 8, -8);
  const lowCut = bladePose(2, 0.48, [0, -0.09, 0.045], 24, 28, -8);
  const lowFollow = bladePose(2, 0.62, [0, -0.07, 0.025], 32, 20, -4);
  const pryLoad = bladePose(5, 0.13, [0, -0.025, -0.025], -16, -3);
  const pryBite = bladePose(5, 0.24, [0, -0.04, 0.055], 12, 8);
  const pryPull = bladePose(5, 0.16, [0, -0.03, -0.025], -22, -5);
  // The native overhead windup becomes a compact throw, then follows through
  // across the body. The projectile event remains the only release authority.
  const throwLoad = openArms(bladePose(2, 0.27, [0, -0.018, -0.025], -23, -8), 1, [
    [0.4, -0.12, 0.18],
    [-0.4, 0.23, -0.13],
  ]);
  const throwRelease = openArms(bladePose(2, 0.39, [0, -0.025, 0.055], 26, 10, 8), 1, [
    [0.4, -0.12, 0.18],
    [-0.13, 0.02, 0.5],
  ]);
  const throwFollow = openArms(bladePose(2, 0.68, [0, -0.015, 0.03], 32, 8, 4), 1, [
    [0.4, -0.12, 0.18],
    [-0.05, -0.12, 0.32],
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
        [0.018, throwLoad],
        [0.04, throwRelease],
        [0.075, throwRelease],
        [0.2, throwFollow],
        [0.62, idle],
      ],
    ],
  ];
}
