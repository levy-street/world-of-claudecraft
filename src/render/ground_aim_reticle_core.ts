export interface GroundAimGeometryState {
  x: number;
  z: number;
  radius: number;
}

/** Exact equality is required because these values directly generate uploaded vertices. */
export function sameGroundAimGeometry(
  previous: GroundAimGeometryState,
  x: number,
  z: number,
  radius: number,
): boolean {
  return previous.x === x && previous.z === z && previous.radius === radius;
}
