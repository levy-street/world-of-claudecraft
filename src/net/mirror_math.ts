// Pure math the world mirror (online.ts) runs per wire update: the shortest-arc
// angle wrap for facing interpolation and the allocation-free position copy.
// A leaf with no imports so it stays trivially testable and keeps the mirror
// coordinator under its monolith ceiling (tests/monolith_budget.test.ts).

export function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function copyPos(
  dst: { x: number; y: number; z: number },
  src: { x: number; y: number; z: number },
): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}
