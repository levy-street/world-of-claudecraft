/** The apparatus points along local +Z, so negative local X pitch raises its nose. */
export function gliderApparatusPitch(vy: number, speed: number): number {
  if (!Number.isFinite(vy) || !Number.isFinite(speed)) return 0;
  return -Math.atan2(vy, Math.max(0.1, speed));
}

/** Cosmetic pitch from displayed movement, including remote bodies with no wire velocities. */
export function gliderDisplayedMotionPitch(dx: number, dy: number, dz: number, dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  // Slow fall can descend straight down; keep the sail overhead instead of
  // rotating it vertically just because horizontal speed reaches zero.
  const pitch = gliderApparatusPitch(dy / dt, Math.hypot(dx, dz) / dt);
  return Math.max(-Math.PI / 8, Math.min(Math.PI / 8, pitch));
}
