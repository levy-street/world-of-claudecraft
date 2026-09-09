// Small vector helpers the online mirror's interpolation uses (extracted from
// src/net/online.ts; tests/interp_math.test.ts pins them). Pure: no DOM, no
// sim state.

/** Wrap an angle delta into (-pi, pi] so a facing lerp takes the short way round. */
export function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Copy a position into a live vector in place (the mirror's entity records
 *  are reused across frames, never reallocated per update). */
export function copyPos(
  dst: { x: number; y: number; z: number },
  src: { x: number; y: number; z: number },
): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}
