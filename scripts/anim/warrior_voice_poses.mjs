/** Seven physical vocal performances. Each keeps the actual weapon sockets,
 * loads the chest before its pressure front and recovers within one GCD. */
export function warriorVoicePerformances(idle, bladePose, openArms) {
  const designs = [
    // Retain each arm silhouette. Motion adds its own breath, weight transfer
    // and recovery: rally upward, threaten forward, or hold a low defiant brace.
    // timing is load / held-release end / settle / neutral, all in seconds.
    [
      'Warrior_Iron_Bellow',
      -14,
      -22,
      0.52,
      0.1,
      -0.02,
      {
        timing: [0.08, 0.27, 0.445, 0.7],
        load: [0, -0.06, -0.035],
        project: [0, -0.018, 0.012],
        settle: [0, -0.026, 0],
        loadLean: 9,
      },
    ],
    [
      'Warrior_Direhowl',
      -16,
      19,
      0.4,
      -0.16,
      -0.06,
      {
        timing: [0.06, 0.235, 0.385, 0.65],
        load: [0.008, -0.042, -0.036],
        project: [-0.012, -0.056, 0.05],
        settle: [0, -0.034, 0.018],
        loadLean: -4,
      },
    ],
    [
      'Warrior_Emboldening_Roar',
      -11,
      -25,
      0.56,
      0.23,
      0.15,
      {
        timing: [0.095, 0.285, 0.46, 0.72],
        load: [0, -0.065, -0.02],
        project: [0, -0.005, 0.008],
        settle: [0, -0.022, 0.004],
        loadLean: 12,
        // Keep a long held blade clear while the chest gathers its breath.
        loadRight: [-0.28, -0.04, 0.22],
      },
    ],
    [
      'Warrior_Defiant_Bellow',
      -13,
      12,
      0.56,
      -0.04,
      -0.09,
      {
        timing: [0.085, 0.305, 0.48, 0.71],
        load: [-0.014, -0.065, -0.026],
        project: [0, -0.088, 0.025],
        settle: [0.008, -0.059, 0],
        loadLean: 4,
      },
    ],
    [
      'Warrior_Valor_Roar',
      15,
      -20,
      0.53,
      0.2,
      0.02,
      {
        timing: [0.07, 0.245, 0.395, 0.67],
        load: [-0.012, -0.048, -0.028],
        project: [0.008, -0.012, 0.024],
        settle: [0, -0.024, 0.006],
        loadLean: 6,
      },
    ],
    [
      'Warrior_Intimidating_Shout',
      -20,
      22,
      0.46,
      -0.14,
      0.04,
      {
        timing: [0.09, 0.28, 0.435, 0.695],
        load: [0.015, -0.058, -0.042],
        project: [-0.015, -0.07, 0.056],
        settle: [-0.005, -0.04, 0.013],
        loadLean: -6,
        // The threat stays low in the body, with the weapon hand held higher.
        loadRight: [-0.28, 0.05, 0.22],
      },
    ],
    [
      'Warrior_Piercing_Howl',
      15,
      11,
      0.38,
      -0.08,
      -0.03,
      {
        timing: [0.055, 0.195, 0.315, 0.55],
        load: [0.012, -0.035, -0.025],
        project: [-0.008, -0.043, 0.035],
        settle: [0, -0.02, 0.005],
        loadLean: -2,
      },
    ],
  ];
  return designs.map(([name, turn, lean, spread, leftY, rightY, motion]) => {
    const [loadTime, holdEnd, settleTime, endTime] = motion.timing;
    const load = openArms(bladePose(6, 0.14, motion.load, turn, motion.loadLean), 1, [
      [0.32, -0.14, 0.19],
      motion.loadRight ?? [-0.28, -0.1, 0.22],
    ]);
    const project = openArms(bladePose(6, 0.14, motion.project, -turn * 0.28, lean), 1, [
      [spread, leftY, 0.18],
      [-spread, rightY, 0.2],
    ]);
    const settle = openArms(bladePose(6, 0.14, motion.settle, turn * 0.15, lean * 0.25), 1, [
      [spread * 0.82, leftY - 0.035, 0.16],
      [-spread * 0.82, rightY - 0.025, 0.19],
    ]);
    return [
      name,
      [
        [0, idle],
        [loadTime, load],
        [0.15, project],
        [holdEnd, project],
        [settleTime, settle],
        [endTime, idle],
      ],
    ];
  });
}
