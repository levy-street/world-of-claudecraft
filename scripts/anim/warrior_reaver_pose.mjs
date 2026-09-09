/** A queued starter strike commits only when the real auto-swing resolves.
 * Compact diagonal shoulder cut with the offhand held in its native guard. */
export function warriorReaverPerformance(idle, bladePose) {
  const guard = bladePose(6, 0.2, [0, 0, 0], 0, 0);
  const guarded = (pose) => {
    for (const [key, value] of guard) {
      const bone = key.split('|')[0];
      if (bone.endsWith('.l') && /arm|wrist|hand/.test(bone)) pose.set(key, [...value]);
    }
    return pose;
  };
  const load = guarded(bladePose(2, 0.23, [0, -0.02, -0.03], -23, -4));
  const cut = guarded(bladePose(2, 0.39, [0, -0.04, 0.05], 19, 0));
  const follow = guarded(bladePose(2, 0.61, [0, -0.025, 0.02], 27, 7));
  return [
    'Warrior_Reaver_Strike',
    [
      [0, idle],
      [0.07, load],
      [0.15, cut],
      [0.185, cut],
      [0.32, follow],
      [0.62, idle],
    ],
  ];
}
