/** Equipment-led preparation, with the caller's offline foot lock. No spell
 * casting pose or invented self-injury; each state finishes inside one GCD. */
export function warriorReadinessPerformances(idle, bladePose, openArms) {
  const chargeLoad = openArms(bladePose(6, 0.12, [0, -0.02, -0.01], -5, 0), 1, [
    [0.35, -0.12, 0.16],
    [-0.25, -0.06, 0.23],
  ]);
  const chargeLock = openArms(bladePose(6, 0.14, [0, -0.035, 0.01], 2, -3), 1, [
    [0.4, -0.08, 0.17],
    [-0.22, 0.07, 0.25],
  ]);
  const chargeOpen = openArms(bladePose(6, 0.12, [0, -0.015, 0], 6, -4), 1, [
    [0.42, -0.08, 0.16],
    [-0.4, 0.07, 0.22],
  ]);
  const wideLoad = bladePose(5, 0.13, [0, -0.015, -0.02], -26, -4);
  const wideEdge = bladePose(5, 0.32, [0, -0.025, 0.035], 20, 2);
  const wideFollow = bladePose(5, 0.5, [0, -0.02, 0.015], 29, 1);
  const battleLoad = bladePose(6, 0.1, [0, -0.012, 0], -8, -2);
  const battleLock = bladePose(6, 0.17, [0, -0.015, 0.01], -3, 0);
  const guardLoad = bladePose(6, 0.14, [0, -0.018, 0], 9, 2);
  const guardLock = bladePose(6, 0.32, [0, -0.035, 0.015], 5, 5);
  const furyLoad = openArms(bladePose(4, 0.16, [0, -0.02, 0], -5, 2), 1, [
    [0.36, -0.1, 0.2],
    [-0.36, -0.1, 0.2],
  ]);
  const furyLock = openArms(bladePose(4, 0.16, [0, -0.045, 0.02], 0, 6), 1, [
    [0.46, -0.07, 0.23],
    [-0.46, -0.07, 0.23],
  ]);
  return [
    [
      'Warrior_Sanguine_Aura',
      [
        [0, idle],
        [0.075, chargeLoad],
        [0.15, chargeLock],
        [0.23, chargeLock],
        [0.4, chargeOpen],
        [0.68, idle],
      ],
    ],
    [
      'Warrior_Widening_Arc',
      [
        [0, idle],
        [0.07, wideLoad],
        [0.15, wideEdge],
        [0.19, wideEdge],
        [0.36, wideFollow],
        [0.66, idle],
      ],
    ],
    [
      'Warrior_Battle_Stance',
      [
        [0, idle],
        [0.07, battleLoad],
        [0.15, battleLock],
        [0.25, battleLock],
        [0.55, idle],
      ],
    ],
    [
      'Warrior_Guarded_Stance',
      [
        [0, idle],
        [0.07, guardLoad],
        [0.15, guardLock],
        [0.27, guardLock],
        [0.58, idle],
      ],
    ],
    [
      'Warrior_Berserker_Stance',
      [
        [0, idle],
        [0.07, furyLoad],
        [0.15, furyLock],
        [0.28, furyLock],
        [0.62, idle],
      ],
    ],
  ];
}
