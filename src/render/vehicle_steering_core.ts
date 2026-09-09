// Front-wheel steering for a rigid vehicle rig: how far the wheels are allowed
// to turn, and how they get there.
//
// Two jobs, both here because neither needs Three:
//
//   1. MEASURING the steering lock off the mesh. A lock picked by eye is a lock
//      that saws through the fender on the next model. The bodywork already
//      knows the answer, so ask it, the same way `vehicle_suspension_core` takes
//      its travel limits from measured clearances rather than constants.
//   2. Turning the driver's yaw rate into an angle, since a steering rack is
//      not instant and the wheels should return to center on their own.
//
// THE FRAME. All of the measuring happens in the STEER NODE's own space, where
// steering is a plain rotation about Y through the origin. That is what makes
// an exact answer cheap: under a Y rotation every point keeps its radius from
// the axis and its height and changes only its angle, so a wheel point at
// (r, y, theta) can only ever meet bodywork that also lies at (r, y). The whole
// measurement is therefore "for each point of the tire, how far around can it
// travel before the body occupies the same ring".
//
// SIGN. None of this needs to know which way the model was authored to face.
// The renderer sets the entity group's yaw straight from `facing`, the model's
// own correction (`def.yaw`) is a Y rotation as well, and Y rotations commute,
// so a positive yaw rate is a positive steer angle in the node's frame no
// matter how the mesh came out of Blender. The suspension has to derive
// `frontSign` and `rightSign` because it works with pitch and roll, which do
// not have that property. Steering does not.

/** Wrap to (-PI, PI]. */
export function wrapAngle(a: number): number {
  const t = (((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return t - Math.PI;
}

/** How far the wheels may turn each way, in radians, in node rotation terms.
 *  The two differ in practice: fenders are not symmetric, and a re-ripped mesh
 *  is less symmetric still. */
export interface SteerLimits {
  /** Limit on positive rotation about the node's Y. */
  pos: number;
  /** Limit on negative rotation, as a POSITIVE magnitude. */
  neg: number;
}

/** Yaw rate that commands full lock. Mirrors `TURN_SPEED` from `sim/types`,
 *  the keyboard turn rate, so holding a turn key puts the wheels exactly at the
 *  measured lock and never past it. Kept as a literal rather than an import so
 *  this core stays free of the sim layer; `vehicle_steering_core.test.ts`
 *  asserts the two stay equal. */
export const STEER_FULL_LOCK_YAW = Math.PI;

/** Seconds from center to full lock, whatever full lock measures out to.
 *  Scaling the rate by the measured lock rather than fixing the rate in rad/s
 *  keeps the feel identical on a car with tight fenders and one with none. */
const STEER_TIME = 0.18;

/** Angular sectors the wheel is divided into before its extremes are taken.
 *  See `wheelSilhouette` for why per-ring extremes alone are not enough. */
const SILHOUETTE_SECTORS = 8;

export interface SteerState {
  angle: number;
}

export function createSteering(): SteerState {
  return { angle: 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * One frame of steering.
 *
 * `fraction` is the driver's yaw rate over `STEER_FULL_LOCK_YAW`, so 1 is a
 * held turn key. The target is that fraction of the measured lock on the side
 * being turned toward, which is what makes it impossible to command an angle
 * the bodywork does not have room for: the clamp is the measurement, not a
 * separate guess laid over it.
 */
export function stepSteering(
  state: SteerState,
  fraction: number,
  limits: SteerLimits,
  dt: number,
): number {
  const f = clamp(fraction, -1, 1);
  const target = f >= 0 ? f * limits.pos : f * limits.neg;
  if (!(dt > 0)) return state.angle;
  const span = Math.max(limits.pos, limits.neg);
  const maxStep = (span / STEER_TIME) * dt;
  state.angle += clamp(target - state.angle, -maxStep, maxStep);
  return state.angle;
}

/**
 * How fast a wheel turns about its axle while the vehicle pivots on the spot.
 *
 * A real car cannot do this, which is the point: turning in place with the
 * wheels dead still reads as the whole vehicle sliding. Spinning them like a
 * tracked vehicle, one side forward and the other back, sells the rotation.
 *
 * The number is not a feel constant, it is the ground the tire covers. Under a
 * yaw rate `w` the contact point at position p moves at w * (p.z, -p.x), and
 * the part of that the wheel can actually ROLL is the component along its own
 * forward axis, which works out to w times the wheel's offset ALONG ITS AXLE.
 * Divided by the radius, that is the turn rate. The rest of the contact point's
 * motion is sideways scrub, which is exactly the part a real tire refuses to
 * do.
 *
 * Result is about the +axle axis. The two rear wheels sit on opposite sides of
 * the axle midpoint, so their offsets are equal and opposite and the pair
 * counter-rotates by construction: turn right and the right wheel runs
 * backwards while the left runs forward, at matching speed. The sign needs no
 * knowledge of which way the model faces; `frontSign` cancels out of the
 * derivation.
 */
export function pivotWheelRate(yawRate: number, axleOffset: number, radius: number): number {
  if (!(radius > 1e-9)) return 0;
  return (-yawRate * axleOffset) / radius;
}

/**
 * Reduce a wheel to a bounded set of probe points: within each (radius, height,
 * sector) cell, the two angular extremes.
 *
 * The reduction exists for cost. Testing all three thousand vertices of a tire
 * against the bodywork, at every height its suspension can reach, is tens of
 * millions of triangle tests per rig, and this runs when a mount is summoned.
 *
 * Extremes are the right points to keep because a rotation moves every point of
 * a ring by the same angle, so within one span of material only the leading end
 * can reach an obstacle first. Taking them per SECTOR rather than per ring is
 * what keeps that true on a real tire: at hub height a tire has material fore
 * and aft and none at the sides, and a single min/max across the whole ring
 * would span the empty sides and throw away two of the four ends that actually
 * bind.
 *
 * Cell boundaries also cut material that is really continuous, so some points
 * kept here are not true edges. That costs nothing but time: they are still
 * points on the tire, and finding contact at one can only tighten the lock, in
 * the direction of not clipping.
 *
 * `verts` is a flat x,y,z list in the steer node's space. Returns flat
 * r,y,theta triples.
 */
export function wheelSilhouette(verts: ArrayLike<number>, cell: number): number[] {
  if (!(cell > 0)) return [];
  const sector = (2 * Math.PI) / SILHOUETTE_SECTORS;
  // Per cell: the lowest and highest angle seen, and the r/y that came with
  // each, so the point handed back is a real vertex rather than a cell center.
  const lo = new Map<string, [number, number, number]>();
  const hi = new Map<string, [number, number, number]>();
  for (let i = 0; i + 2 < verts.length; i += 3) {
    const x = verts[i];
    const y = verts[i + 1];
    const z = verts[i + 2];
    const r = Math.hypot(x, z);
    // atan2(x, z), not (z, x): this is the angle that a positive rotation about
    // Y increases by exactly the rotation amount.
    const th = Math.atan2(x, z);
    const key = `${Math.floor(r / cell)},${Math.floor(y / cell)},${Math.floor((th + Math.PI) / sector)}`;
    const a = lo.get(key);
    if (!a || th < a[2]) lo.set(key, [r, y, th]);
    const b = hi.get(key);
    if (!b || th > b[2]) hi.set(key, [r, y, th]);
  }
  const out: number[] = [];
  for (const p of lo.values()) out.push(p[0], p[1], p[2]);
  for (const p of hi.values()) out.push(p[0], p[1], p[2]);
  return out;
}

/**
 * The tire as a solid: a cylinder of `radius` about the axle, `halfWidth` to
 * each side of the wheel's center plane, in the steer node's space.
 *
 * Used to throw away bodywork that is BURIED INSIDE the wheel. That sounds like
 * a special case and is not: an art pipeline that separates a vehicle into
 * parts automatically will leave hub, brake and axle geometry assigned to the
 * chassis and sitting inside the tire, and on this model it is what a first
 * measurement binds on. Such material is invisible, it is inside a solid tire,
 * and no amount of steering reveals it, so letting it set the steering lock
 * reports a car that cannot turn its wheels at all. Bodywork OUTSIDE the tire
 * is the only thing a viewer can ever see the tire meet.
 */
export interface Tire {
  radius: number;
  halfWidth: number;
  /** True when the axle runs along local X, false when it runs along Z. Read
   *  off the mesh rather than assumed: a wheel is thin along its axle. */
  axleIsX: boolean;
}

/** How far past the tire's surface still counts as buried in it.
 *
 *  Not a fudge factor, a tolerance for a mesh whose parts were separated
 *  automatically. On this model the right front wheel has chassis geometry
 *  hugging the tread within one percent of the tire radius: measured exactly,
 *  it reports five degrees of lock, and at 1.01 radius it reports twenty nine.
 *  The left front measures the same twenty five degrees anywhere from 1.00 to
 *  1.05, because what limits IT is real bodywork standing well clear. Skin at
 *  a percent and a half therefore drops grazing junk and leaves every genuine
 *  fender untouched. Anything that close to the tread is visually touching the
 *  tire already, and steering cannot make that worse. */
const TIRE_SKIN = 1.015;

/** Bodywork triangles indexed by height band, so a query at one height does not
 *  walk the whole body. */
export interface BodyBands {
  /** Flat triangles, 9 floats each, in the steer node's space. */
  tris: readonly number[];
  band: number;
  yMin: number;
  /** Triangle base indices per band. */
  cells: readonly (readonly number[])[];
}

const MAX_BANDS = 4096;

export function buildBodyBands(tris: readonly number[], band: number): BodyBands {
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 1; i < tris.length; i += 3) {
    if (tris[i] < yMin) yMin = tris[i];
    if (tris[i] > yMax) yMax = tris[i];
  }
  if (!Number.isFinite(yMin) || !(band > 0)) {
    return { tris, band: 1, yMin: 0, cells: [] };
  }
  const count = Math.min(Math.floor((yMax - yMin) / band) + 1, MAX_BANDS);
  const step = (yMax - yMin) / count || 1;
  const cells: number[][] = Array.from({ length: count }, () => []);
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const lo = Math.min(tris[t + 1], tris[t + 4], tris[t + 7]);
    const hi = Math.max(tris[t + 1], tris[t + 4], tris[t + 7]);
    const a = clamp(Math.floor((lo - yMin) / step), 0, count - 1);
    const b = clamp(Math.floor((hi - yMin) / step), 0, count - 1);
    for (let k = a; k <= b; k++) cells[k].push(t);
  }
  return { tris, band: step, yMin, cells };
}

/** Where a triangle crosses the horizontal plane at `y`, as a segment in xz.
 *  Returns false when it does not cross. */
function sliceTriangle(tris: readonly number[], t: number, y: number, out: number[]): boolean {
  let n = 0;
  for (let e = 0; e < 3; e++) {
    const i = t + e * 3;
    const j = t + ((e + 1) % 3) * 3;
    const y0 = tris[i + 1];
    const y1 = tris[j + 1];
    if (y0 <= y === y1 <= y) continue;
    const f = (y - y0) / (y1 - y0);
    out[n * 2] = tris[i] + (tris[j] - tris[i]) * f;
    out[n * 2 + 1] = tris[i + 2] + (tris[j + 2] - tris[i + 2]) * f;
    if (++n === 2) return true;
  }
  return false;
}

/**
 * The steering lock, measured.
 *
 * For every point of the wheel silhouette, find the smallest rotation each way
 * that puts it on bodywork, and keep the smallest over the whole wheel. The
 * test is exact against triangles rather than against body VERTICES, which
 * matters: a fender is often four big quads, and a vertex test would let the
 * tire sail straight through the middle of one.
 *
 * The wheel is swept through its suspension travel as well, because a wheel at
 * full bump is deep inside the arch and has less room to turn than one at rest.
 * Measuring only the rest pose is how you ship a car that steers cleanly on
 * flat ground and cuts through its own fender on the first bump.
 */
export function measureSteerLimits(
  silhouette: readonly number[],
  body: BodyBands,
  travelLo: number,
  travelHi: number,
  cap: number,
  tire?: Tire,
): SteerLimits {
  let pos = cap;
  let neg = cap;
  if (!body.cells.length) return { pos, neg };
  const seg: number[] = [0, 0, 0, 0];
  const steps = Math.max(1, Math.ceil((travelHi - travelLo) / body.band));
  for (let s = 0; s < silhouette.length; s += 3) {
    const r = silhouette[s];
    const y0 = silhouette[s + 1];
    const th = silhouette[s + 2];
    if (r <= 1e-9) continue;
    for (let k = 0; k <= steps; k++) {
      const y = y0 + travelLo + ((travelHi - travelLo) * k) / steps;
      const bi = Math.floor((y - body.yMin) / body.band);
      if (bi < 0 || bi >= body.cells.length) continue;
      for (const t of body.cells[bi]) {
        if (!sliceTriangle(body.tris, t, y, seg)) continue;
        // Where the sliced segment crosses the circle of radius r.
        const px = seg[0];
        const pz = seg[1];
        const dx = seg[2] - px;
        const dz = seg[3] - pz;
        const a = dx * dx + dz * dz;
        if (a <= 1e-18) continue;
        const b = px * dx + pz * dz;
        const c = px * px + pz * pz - r * r;
        const disc = b * b - a * c;
        if (disc < 0) continue;
        const root = Math.sqrt(disc);
        // Both roots, unrolled: this is the innermost loop of the whole
        // measurement and it runs a few million times per rig.
        for (let q = 0; q < 2; q++) {
          const f = (-b + (q === 0 ? -root : root)) / a;
          if (f < 0 || f > 1) continue;
          const cx = px + dx * f;
          const cz = pz + dz * f;
          if (tire) {
            // The tire's own height, not the query height: the sweep works by
            // asking the body about a height the wheel has travelled to, so the
            // contact belongs back at the wheel point's own y.
            const along = tire.axleIsX ? cx : cz;
            const across = tire.axleIsX ? cz : cx;
            if (
              Math.abs(along) < tire.halfWidth * TIRE_SKIN &&
              Math.hypot(y0, across) < tire.radius * TIRE_SKIN
            ) {
              continue;
            }
          }
          const d = wrapAngle(Math.atan2(cx, cz) - th);
          if (d >= 0) {
            if (d < pos) pos = d;
          } else if (-d < neg) {
            neg = -d;
          }
        }
      }
    }
  }
  return { pos, neg };
}
