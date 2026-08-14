// Rolling-mount motion math: the junk mounts that are CYLINDERS (the log, the
// barrel) do not glide, they roll. Pure and Node-tested
// (tests/mount_roll_core.test.ts); src/render/renderer.ts is a thin consumer,
// and the per-mount radius + opt-in live on MountVisualSpec
// (src/render/mount_visuals.ts).
//
// The whole point is that the roll is DERIVED from ground travel rather than
// authored as a clip playing at some chosen speed. A cylinder rolling without
// slipping turns through arc = distance, so the angular rate is
//
//   omega = v / r
//
// which means the contact patch is momentarily still and the mount never
// skates, at any mounted speed, on any mount size. An authored spin rate
// cannot hold that: it is right at exactly one speed and wrong everywhere
// else, and the error reads as the mount sliding over the ground.

/** Sense of rotation. A mount travelling FORWARD turns so that its TOP surface
 *  also travels forward (and, being at 2r from the contact patch, does so at
 *  twice the body speed). That is what puts a rider standing on top into a
 *  backwards walk to hold station, which is the joke. */
export const ROLL_FORWARD = 1;

/** Radians of roll for a given signed ground distance and mount radius.
 *  Positive distance (forward travel) returns a positive angle, which the
 *  renderer applies about the mount's local X axis (its long axis, which lies
 *  ACROSS the direction of travel).
 *
 *  Guards a zero or negative radius by returning 0 rather than dividing: a
 *  spec with no radius is a mount that does not roll, not a crash. */
export function rollDelta(distance: number, radius: number): number {
  if (!(radius > 0) || !Number.isFinite(distance)) return 0;
  return ROLL_FORWARD * (distance / radius);
}

/** Accumulate a roll angle across a frame, wrapped to [0, 2pi) so a long ride
 *  can never drift into the float range where a rotation loses precision (at
 *  60fps a 20 minute ride otherwise reaches ~1e5 radians). Wrapping is exact
 *  for rendering: the mount is rotationally periodic. */
export function advanceRoll(current: number, distance: number, radius: number): number {
  const TAU = Math.PI * 2;
  const next = (current + rollDelta(distance, radius)) % TAU;
  return next < 0 ? next + TAU : next;
}

/** Surface speed at the top of a rolling cylinder, in world units per second:
 *  twice the body speed. The rider's backwards walk is played against THIS,
 *  not against body speed, or their feet visibly slip on the log. */
export function topSurfaceSpeed(bodySpeed: number): number {
  return 2 * bodySpeed;
}
