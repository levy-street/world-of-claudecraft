// Was a click AIMED at a body, or did its ray only cross the body's forgiving
// click capsule? Pure geometry for the direct pick (world_direct_pick.ts): no
// Three, no DOM, no world.
//
// A click capsule is deliberately wider than what it stands for, so a crowd
// stays clickable. That width is the wrong test for "the player meant THIS
// one" when something nearer is under the cursor too: the Remembrance Candle's
// capsule is 2.2 yd in radius, and an add standing a yard and a half beside the
// pillar is inside it. The aim core is the narrow answer: a vertical segment up
// the middle of what the player actually SEES, with a radius about as wide as
// that thing. A ray that comes within the radius of the segment was aimed at it.
//
// Two details matter for a camera that looks down:
//  - the segment is the visible HEIGHT, not an endless line: a ray that passes
//    over the top of the thing, or that crosses its axis far overhead, is
//    measured to the segment's end and is not "near the axis";
//  - the ray stops at the floor the segment stands on: a click on the ground (or
//    on a mob's feet) a few yards in FRONT of the thing would, carried on under
//    the floor, pass right under its foot. What is under the floor is not what
//    the player clicked.

/** A point or direction (THREE.Vector3 satisfies it). */
export interface PickVec {
  x: number;
  y: number;
  z: number;
}

/** A pick ray (THREE.Ray satisfies it, and passes a unit direction). The
 *  direction may be any practical length: only one shorter than a millionth of
 *  a yard is read as no direction at all, the ray then being its origin. */
export interface PickRay {
  origin: PickVec;
  direction: PickVec;
}

/** Where a click on a body is aimed, relative to the body (a visual's
 *  `aimCore`, characters/manifest.ts): a vertical core `back` yards behind the
 *  body's origin along its facing (0: the body's own axis), `radius` yards
 *  wide and `height` yards tall from the body's feet. */
export interface AimCoreDef {
  back: number;
  radius: number;
  height: number;
}

/** The body a core is placed from (an Entity satisfies it). */
export interface AimCoreBody {
  pos: PickVec;
  facing: number;
}

/**
 * The shortest distance from `ray` to the vertical segment that stands at
 * (x, z) from `y0` up to `y1`. The ray starts at its origin and, when it runs
 * downward, ends where it meets the floor plane y = y0.
 */
export function rayDistanceToVerticalSegment(
  ray: PickRay,
  x: number,
  z: number,
  y0: number,
  y1: number,
): number {
  const ox = ray.origin.x - x;
  const oy = ray.origin.y;
  const oz = ray.origin.z - z;
  const dx = ray.direction.x;
  const dy = ray.direction.y;
  const dz = ray.direction.z;
  // How far along the ray the floor is (never behind the origin).
  const tMax = dy < 0 ? Math.max(0, (y0 - oy) / dy) : Number.POSITIVE_INFINITY;
  const flat2 = dx * dx + dz * dz;
  const len2 = flat2 + dy * dy;
  let best = Number.POSITIVE_INFINITY;

  // Beside the segment: the ray's nearest pass to the axis in plan, counted
  // when the ray is within the segment's height there.
  const tFlat = Math.min(tMax, Math.max(0, flat2 > 1e-12 ? -(ox * dx + oz * dz) / flat2 : 0));
  const yFlat = oy + tFlat * dy;
  if (yFlat >= y0 && yFlat <= y1) best = Math.hypot(ox + tFlat * dx, oz + tFlat * dz);

  // Past an end: the ray's nearest pass to the foot and to the top. Together
  // with the pass above these cover every case (the distance to a segment is
  // the distance to an end wherever the ray is outside its height).
  const tFoot = Math.min(
    tMax,
    Math.max(0, len2 > 1e-12 ? -(ox * dx + (oy - y0) * dy + oz * dz) / len2 : 0),
  );
  best = Math.min(best, Math.hypot(ox + tFoot * dx, oy + tFoot * dy - y0, oz + tFoot * dz));
  const tTop = Math.min(
    tMax,
    Math.max(0, len2 > 1e-12 ? -(ox * dx + (oy - y1) * dy + oz * dz) / len2 : 0),
  );
  best = Math.min(best, Math.hypot(ox + tTop * dx, oy + tTop * dy - y1, oz + tTop * dz));
  return best;
}

/** Was `ray` aimed at `body`'s core: does it come within the core's radius of
 *  the core's segment? The radius itself still counts. */
export function rayAimsAtCore(ray: PickRay, body: AimCoreBody, core: AimCoreDef): boolean {
  const x = body.pos.x - Math.sin(body.facing) * core.back;
  const z = body.pos.z - Math.cos(body.facing) * core.back;
  const y0 = body.pos.y;
  return rayDistanceToVerticalSegment(ray, x, z, y0, y0 + core.height) <= core.radius;
}
