/** Offline ankle target in native rig units. The support leg never moves;
 * the striking foot returns to its exact original plant at the 150ms hit. */
export function warriorStompLift(name, side, time) {
  if (name !== 'Warrior_Quaking_Blow' || side !== 'r' || time <= 0.02 || time >= 0.15) return 0;
  if (time < 0.085) {
    const t = (time - 0.02) / 0.065;
    return 0.16 * t * t * (3 - 2 * t);
  }
  const t = (time - 0.085) / 0.065;
  return 0.16 * (1 - t * t);
}
