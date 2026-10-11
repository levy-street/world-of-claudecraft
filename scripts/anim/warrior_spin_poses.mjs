/** Paired blades exchange levels through one loaded revolution. The native
 * exporter solves the local stance and owns the turn; recovery visibly brakes
 * the fighter without translating the gameplay position. */
export function warriorSpinPerformance(idle, bladePose, openArms) {
  const sweep = (hip, turn, lean, hands) =>
    openArms(bladePose(5, 0.24, [0, hip, 0.01], turn, lean, 0, true), 1, hands);
  return [
    'Warrior_Bladed_Gyre',
    [
      [0, idle],
      [0.085, bladePose(5, 0.1, [0, -0.062, -0.025], -32, -7, 0, true)],
      [
        0.15,
        sweep(-0.044, 5, 7, [
          [0.55, 0.11, 0.21],
          [-0.52, -0.13, 0.18],
        ]),
      ],
      [
        0.29,
        sweep(-0.052, -6, 9, [
          [0.53, -0.09, 0.21],
          [-0.55, 0.09, 0.18],
        ]),
      ],
      [
        0.46,
        sweep(-0.046, 9, 4, [
          [0.51, 0.06, 0.23],
          [-0.5, -0.1, 0.22],
        ]),
      ],
      [0.56, bladePose(5, 0.5, [0, -0.067, 0.025], 24, 10, 0, true)],
      [0.72, idle],
    ],
  ];
}
