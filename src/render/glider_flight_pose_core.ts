/** The apparatus points along local +Z, so negative local X pitch raises its nose. */
export function gliderApparatusPitch(vy: number, speed: number): number {
  if (!Number.isFinite(vy) || !Number.isFinite(speed)) return 0;
  return -Math.atan2(vy, Math.max(0.1, speed));
}
