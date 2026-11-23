// Pure lane geometry (a straight strip on the floor): the Fogbound Arbalest's
// Piercing Bolt, and the charge and hook lines of the Sunken Bastion bosses.
// The renderer paints the same strip it tests, so the edge a player steps
// over is the edge the sim reads. Zero rng, Three-free.

/** Is (px, pz) inside the strip that runs `length` yards from (ox, oz) along
 *  `yaw` (sim convention: 0 = +z, sin for x), `halfWidth` to either side? */
export function inLane(
  ox: number,
  oz: number,
  yaw: number,
  length: number,
  halfWidth: number,
  px: number,
  pz: number,
): boolean {
  const dx = px - ox;
  const dz = pz - oz;
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  const along = dx * ax + dz * az;
  if (along < 0 || along > length) return false;
  const side = Math.abs(dx * az - dz * ax);
  return side <= halfWidth;
}

/** The signed side offset of (px, pz) from the lane's centre line (right of
 *  travel positive): which way a lane's knockback throws someone. */
export function laneSide(ox: number, oz: number, yaw: number, px: number, pz: number): number {
  const dx = px - ox;
  const dz = pz - oz;
  return dx * Math.cos(yaw) - dz * Math.sin(yaw);
}
