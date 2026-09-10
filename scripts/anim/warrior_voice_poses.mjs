/** Seven physical vocal performances. Each keeps the actual weapon sockets,
 * loads the chest before its pressure front and recovers within one GCD. */
export function warriorVoicePerformances(idle, bladePose, openArms) {
  const designs = [
    // name, loading turn, projection lean, chest opening, left/right hand height
    ['Warrior_Iron_Bellow', -14, -22, 0.52, 0.1, -0.02],
    ['Warrior_Direhowl', -16, 19, 0.4, -0.16, -0.06],
    ['Warrior_Emboldening_Roar', -11, -25, 0.56, 0.23, 0.15],
    ['Warrior_Defiant_Bellow', -13, 12, 0.56, -0.04, -0.09],
    ['Warrior_Valor_Roar', 15, -20, 0.53, 0.2, 0.02],
    ['Warrior_Intimidating_Shout', -20, 22, 0.46, -0.14, -0.12],
    ['Warrior_Piercing_Howl', 15, 11, 0.38, -0.08, -0.03],
  ];
  return designs.map(([name, turn, lean, spread, leftY, rightY]) => {
    const quick = name === 'Warrior_Piercing_Howl';
    const load = openArms(bladePose(6, 0.14, [0, -0.032, -0.025], turn, 8), 1, [
      [0.32, -0.14, 0.19],
      [-0.28, -0.1, 0.22],
    ]);
    const project = openArms(bladePose(6, 0.14, [0, -0.047, 0.026], -turn * 0.28, lean), 1, [
      [spread, leftY, 0.18],
      [-spread, rightY, 0.2],
    ]);
    const settle = openArms(bladePose(6, 0.14, [0, -0.018, 0.005], turn * 0.15, lean * 0.25), 1, [
      [spread * 0.82, leftY - 0.035, 0.16],
      [-spread * 0.82, rightY - 0.025, 0.19],
    ]);
    return [
      name,
      [
        [0, idle],
        [0.075, load],
        [0.15, project],
        [quick ? 0.205 : 0.255, project],
        [quick ? 0.34 : 0.43, settle],
        [quick ? 0.57 : 0.72, idle],
      ],
    ];
  });
}
