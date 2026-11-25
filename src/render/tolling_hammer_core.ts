// Presentation only. The simulation owns projectile arrival and its one damage event.
export const TOLLING_CAPACITY = 12;
export const TOLLING_SPEED = 26;
export const TOLLING_FLIGHT_LIMIT = 3.2;
/** The heavenly hammer falls this long before it strikes. */
export const TOLLING_DROP = 0.42;
/** After the strike: the toll rings run out and the planted hammer burns away. */
export const TOLLING_FADE = 0.8;
/** The planted hammer holds this long, then dissolves into light. */
export const TOLLING_HOLD = 0.22;
export const TOLLING_SPARKS = 16;
/** Three tolls of the bell ring out from the strike, this far apart. */
export const TOLLING_TOLL_GAP = 0.14;

/** Height of the falling hammer's striking face above the floor: it drops
 * from the sky, accelerating, and meets the ground at TOLLING_DROP. */
export function tollingHeight(age: number, reduced: boolean): number {
  const p = Math.max(0, Math.min(1, age / TOLLING_DROP));
  return (reduced ? 1.2 : 9) * (1 - p * p);
}

/**
 * The turn, in the view plane, that flies a thrown hammer of light head first
 * along its flight (dx, dz). `cam` holds the camera's right (0..2) and up
 * (3..5) axes; the hammer's length axis runs up*cos + right*sin with its head
 * at the far end, so the head leads. Head down when flying straight at or away
 * from the camera.
 */
export function headFirstTurn(cam: ArrayLike<number>, dx: number, dz: number): number {
  const sx = dx * cam[0] + dz * cam[2],
    sy = dx * cam[3] + dz * cam[5];
  if (Math.hypot(sx, sy) < 1e-3) return 0;
  return Math.atan2(-sx, -sy);
}

export function isTollingHammer(id?: string | null, name?: string | null): boolean {
  return id ? id === 'hammer_of_wrath' : name === 'Hammer of Wrath' || name === 'Tolling Hammer';
}
