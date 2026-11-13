// Where a zone's sun stands: the pure half. Every zone shares one day and night clock, but
// its sun's ARC may be turned about the vertical and stand higher or lower at noon, the way
// each zone already has its own sky, haze and light colour. A town built round a square
// shows the camera its shaded side from most approaches under one fixed arc; turned for the
// zone, the fronts a traveller walks up to stand in the light.
//
// This file is the arithmetic only: no Three, no clock, no state.

export interface ZoneSun {
  /** Turn of the sun's arc about the vertical, in degrees: the noon sun swings from +z
   *  toward +x. 0 is the shared arc. */
  readonly turn: number;
  /** How high the sun stands at noon, in degrees above the horizon. */
  readonly elev: number;
}

/** An angle in degrees folded into (-180, 180]. */
export function foldDegrees(angle: number): number {
  const folded = ((((angle + 180) % 360) + 360) % 360) - 180;
  return folded === -180 ? 180 : folded;
}

/** `current` moved the fraction `k` of the SHORT way round toward `target`, in degrees. */
export function easeAngleDeg(current: number, target: number, k: number): number {
  return current + foldDegrees(target - current) * Math.min(1, Math.max(0, k));
}

/** `current` moved the fraction `k` of the way to `target`. */
export function easeToward(current: number, target: number, k: number): number {
  return current + (target - current) * Math.min(1, Math.max(0, k));
}

/** A direction turned about the vertical by `turnDeg` (from +z toward +x). */
export function turnAboutVertical(
  dir: readonly [number, number, number],
  turnDeg: number,
): [number, number, number] {
  if (turnDeg === 0) return [dir[0], dir[1], dir[2]];
  const t = (turnDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [dir[0] * c + dir[2] * s, dir[1], dir[2] * c - dir[0] * s];
}
