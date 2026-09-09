// The Three-side half of terrain-reactive vehicle suspension: finds a wheeled
// mount's per-corner travel nodes, MEASURES what the bodywork will allow, samples
// the ground under each wheel, and writes the result onto the scene graph. All
// the decision math is the pure `vehicle_suspension_core`; this file owns the
// scene graph, the measuring, and the sampling cadence.
//
// It lives here rather than inline in renderer.ts for the same reason
// `applyRocketSledAttitude` does: this is one mount family's behavior, not
// coordinator work, and renderer.ts is a named monolith under the line-count
// ratchet (root CLAUDE.md, Modularity).
//
// EVERYTHING here is derived from the rig and the mesh, never from constants
// that know the model: which way the vehicle faces, which side is its right,
// the wheelbase and track, and every travel limit. A re-exported or resized
// model keeps working with no edits here, and a vehicle authored facing a
// different axis does too.
//
// UNITS, the thing to get right. All the suspension math runs in the MODEL's
// own space (the space the `Susp_*` nodes' positions are in), NOT world space.
// Terrain heights arrive in world units and are divided by `unitScale` on the
// way in. The alternative, working in world units and converting on the way
// out, is what the first version did, and forgetting the conversion on the node
// write scaled every spring by the mount's normalization factor (6x here) and
// fired the wheels straight through the fenders.

import * as THREE from 'three';
import {
  buildBodyBands,
  createSteering,
  measureSteerLimits,
  pivotWheelRate,
  STEER_FULL_LOCK_YAW,
  type SteerLimits,
  type SteerState,
  stepSteering,
  wheelSilhouette,
  wrapAngle,
} from './vehicle_steering_core';
import {
  createSuspension,
  landSuspension,
  type SuspensionCorner,
  type SuspensionEnvelope,
  type SuspensionState,
  stepSuspension,
} from './vehicle_suspension_core';

/** Terrain resample period, seconds. Four `groundHeight` calls per tick, and
 *  the core damps between them, matching the character terrain-lean cadence. */
const SAMPLE_INTERVAL = 0.06;

/** Keep this much of each measured clearance. A spring that uses 100% of the
 *  gap puts rubber exactly on sheet metal at full travel, and the eye reads a
 *  touch as a clip. */
const CLEARANCE_KEEP = 0.85;
/** Same idea for the ground angles: stop short of actually dragging the bumper. */
const ANGLE_KEEP = 0.8;

/** Fallback envelope for a rig with no measurable bodywork, as a fraction of
 *  track. Only reachable for a vehicle whose GLB carries the suspension nodes
 *  but no meshes under them, which no shipped mount does. */
const FALLBACK_BUMP_PER_TRACK = 0.03;
const FALLBACK_DROOP_PER_TRACK = 0.04;
const FALLBACK_ANGLE = 0.25;

const CORNERS: readonly SuspensionCorner[] = ['fl', 'fr', 'rl', 'rr'];
const NODE_NAMES: Record<SuspensionCorner, string> = {
  fl: 'Susp_FL',
  fr: 'Susp_FR',
  rl: 'Susp_RL',
  rr: 'Susp_RR',
};
const WHEEL_NAMES: Record<SuspensionCorner, string> = {
  fl: 'Wheel_FL',
  fr: 'Wheel_FR',
  rl: 'Wheel_RL',
  rr: 'Wheel_RR',
};

/** Steering nodes, when the rig has them. They sit between the travel node and
 *  the wheel, and no exported clip animates them, so unlike the travel nodes
 *  this pass owns the channel outright and can write it plainly. */
const STEER_CORNERS: readonly SuspensionCorner[] = ['fl', 'fr'];
const STEER_NAMES: Record<string, string> = {
  fl: 'Steer_FL',
  fr: 'Steer_FR',
};

/** Same idea as CLEARANCE_KEEP: stop short of the measured contact, because a
 *  tire that grazes the fender at full lock reads as a clip. */
const STEER_KEEP = 0.85;

/** Nothing steers further than this however much room the bodywork leaves.
 *  Reachable only by a rig whose front wheels sit in open air. */
const STEER_CAP = 0.7;

/** Measurement resolution, as a fraction of the wheel's own reach from the
 *  steering axis. Finer costs measuring time at rig build and buys nothing:
 *  the tire is already smooth at this scale. */
const STEER_CELL_PER_REACH = 1 / 12;

/** Descent speed, WORLD units per second, at which a touchdown starts to be
 *  worth answering and where it counts as the hardest landing.
 *
 *  Deliberately the same sense of "fall speed" the renderer already uses to
 *  choose between a landing thud and a footfall, and to size the impact dust:
 *  peak descent while airborne. Sharing the notion is the point. A landing
 *  whose sound, dust and squat disagree about how hard it was reads as three
 *  unrelated events instead of one. */
const LANDING_SOFT_SPEED = 4.5;
const LANDING_FULL_SPEED = 16;

/** Rear wheels counter-rotate when the car turns on the spot. Rear only: the
 *  fronts steer, and a real car's fronts would scrub rather than roll. */
const PIVOT_CORNERS: readonly SuspensionCorner[] = ['rl', 'rr'];

/** Wheel speed off the ground, as a multiple of the speed the tire was turning
 *  at when it left it. Above 1 because an unloaded wheel breaks traction and
 *  runs away from the ground speed. Reverse gets the same multiple of a smaller
 *  number, so it spins up less, which is what reversing off a lip looks like. */
const AIRBORNE_SPIN_GAIN = 1.5;

/** How quickly the measured ground spin rate follows the clip (1/s). Smoothed
 *  because it is read off one frame's quaternion delta, and the value that
 *  matters is the one latched at takeoff. */
const SPIN_RATE_TRACK = 12;

/** Yaw rate (rad/s) above which a stationary car counts as turning on the spot.
 *  Well under the keyboard turn rate, so a held turn key is comfortably over
 *  it, but above the jitter a network-interpolated facing carries. */
const PIVOT_MIN_YAW = 0.15;

export interface VehicleSuspensionRig {
  nodes: Record<SuspensionCorner, THREE.Object3D>;
  /** Each corner's rest position in the ENTITY GROUP's space, used only to find
   *  where on the terrain to sample. Group space carries yaw, position and
   *  scale but NOT the body tilt this module writes, so sampling from here
   *  cannot feed its own output back into itself. */
  offsets: Record<SuspensionCorner, THREE.Vector3>;
  /** World units per model unit: the divisor that brings sampled terrain
   *  heights into the space everything else here works in. */
  unitScale: number;
  /** Travel added to each node last frame, and the exact value that produced.
   *
   *  Together these let the pass ADD to the animation mixer without depending
   *  on the mixer having run. The mixer overwrites the node every frame it
   *  runs, so a node still holding `lastWritten` bit for bit is one the mixer
   *  did NOT touch, and its base is `lastWritten - applied`; anything else is
   *  a fresh clip value to add to. Without that check the choice is between
   *  drifting without bound on a far-LOD frame and throwing the clip's own
   *  authored road texture away. */
  applied: Record<SuspensionCorner, number>;
  lastWritten: Record<SuspensionCorner, number>;
  /** The same trick for body pitch, which composes onto the jump-attitude
   *  pass's write rather than owning the channel outright. */
  appliedRotX: number;
  lastRotX: number;
  /** Model units. */
  wheelbase: number;
  track: number;
  /** +1 if the vehicle's front is toward +z in model space, -1 if toward -z. */
  frontSign: number;
  /** +1 if the vehicle's right is toward +x in model space, -1 if toward -x. */
  rightSign: number;
  /** The body the corner nodes hang off, and the frame every measurement in
   *  here is expressed in. Kept so later passes (exhaust ports) can place
   *  things in model space and get the body's live attitude for free. */
  chassis: THREE.Object3D;
  /** The spinning wheel nodes, when the model has them. */
  wheels: Record<SuspensionCorner, THREE.Object3D | null>;
  /** Each wheel's angle on the last frame it was actually turning.
   *
   *  Three's AnimationMixer RESTORES a property to its original value once the
   *  last action animating it reaches zero weight, so when the locomotion clip
   *  fades out the wheels snap back to their authored home angle. Nothing in
   *  the Idle clip does that (it has no wheel channels at all); the mixer does
   *  it on its own. Holding the last angle here and writing it back after the
   *  mixer is what leaves a parked wheel where it actually stopped. */
  wheelHold: Record<SuspensionCorner, THREE.Quaternion>;
  /** The front steering nodes, null on a rig that has none. */
  steer: Record<string, THREE.Object3D | null>;
  /** How far those nodes may turn each way before the tire meets bodywork,
   *  measured off this model's own mesh at build time. */
  steerLock: SteerLimits;
  steerState: SteerState;
  /** Last frame's facing, for the yaw rate that drives the wheels. NaN until
   *  the first frame, which is what keeps a freshly summoned mount from
   *  reading its whole initial facing as one frame of turn. */
  prevFacing: number;
  /** Airborne tracking for the landing squat: the hardest descent seen since
   *  leaving the ground, and whether we were on it last frame. Peak rather
   *  than the speed at the touchdown frame itself, which has usually already
   *  been zeroed by the time the ground flag flips. */
  fallPeak: number;
  wasGrounded: boolean;
  /** Turning on the spot: stationary, on the ground, and yawing. Read by the
   *  mount pass, which passes it to the engine audio so the idle loop lifts
   *  the way reverse does. */
  pivoting: boolean;
  /** Each wheel's own rolling geometry, measured off its mesh: the axle it
   *  turns about, its radius, and how far it sits along that axle from the
   *  axle's midpoint. Null for a corner with no wheel mesh. */
  spin: Record<SuspensionCorner, WheelSpin | null>;
  /** The clip's value for each wheel last frame, for reading off how fast the
   *  animation is actually turning it. NaN w until the first frame. */
  spinPrev: Record<SuspensionCorner, THREE.Quaternion>;
  /** That measured rate, smoothed, in radians per second about the axle. */
  spinRate: Record<SuspensionCorner, number>;
  /** Target rate while off the ground, latched on the takeoff edge. */
  airRate: Record<SuspensionCorner, number>;
  /** Angle this pass has added on top of the clip, accumulated. Kept rather
   *  than unwound on landing: a wheel's phase is arbitrary, so carrying the
   *  offset costs nothing and leaves the spin continuous through touchdown
   *  instead of snapping back to whatever phase the clip happens to be at. */
  overspin: Record<SuspensionCorner, number>;
  envelope: SuspensionEnvelope;
  heights: Record<SuspensionCorner, number>;
  sampleT: number;
  state: SuspensionState;
}

/** A wheel's rolling geometry, in its own local space. */
interface WheelSpin {
  /** Unit axle direction. Read off the mesh, since a wheel is thin along it. */
  axis: THREE.Vector3;
  radius: number;
  /** Signed distance along the axle from the axle pair's midpoint. Equal and
   *  opposite for the two wheels of an axle by construction, which is what
   *  makes a pivot turn them at matching speed in opposite directions. */
  offset: number;
}

const tmpVec = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpQuatB = new THREE.Quaternion();
const tmpSeat = new THREE.Vector3();
const tmpEuler = new THREE.Euler();
const tmpMat = new THREE.Matrix4();

/** Every Mesh under `root` that is not inside one of `exclude`. */
function meshesUnder(root: THREE.Object3D, exclude: readonly THREE.Object3D[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      if (exclude.includes(p)) return;
      if (p === root) break;
    }
    out.push(o as THREE.Mesh);
  });
  return out;
}

/** Runs `fn` over every vertex of `meshes`, expressed in `frame`'s local space. */
function forEachVertex(
  meshes: readonly THREE.Mesh[],
  frame: THREE.Object3D,
  fn: (x: number, y: number, z: number) => void,
): number {
  let count = 0;
  const inv = tmpMat.copy(frame.matrixWorld).invert();
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry?.getAttribute('position');
    if (!pos) continue;
    const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      fn(v.x, v.y, v.z);
      count++;
    }
  }
  return count;
}

/** Every vertex of `meshes` as a flat x,y,z list in `frame`'s local space. */
function vertexList(meshes: readonly THREE.Mesh[], frame: THREE.Object3D): number[] {
  const out: number[] = [];
  forEachVertex(meshes, frame, (x, y, z) => {
    out.push(x, y, z);
  });
  return out;
}

/** Every triangle of `meshes` as a flat 9-float list in `frame`'s local space.
 *
 *  Triangles rather than vertices because the steering measurement tests real
 *  surfaces: a wheel arch is often a handful of large quads, and a vertex-only
 *  test would let the tire swing clean through the middle of one and report no
 *  contact. */
function triangleList(meshes: readonly THREE.Mesh[], frame: THREE.Object3D): number[] {
  const out: number[] = [];
  const inv = tmpMat.copy(frame.matrixWorld).invert();
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry?.getAttribute('position');
    if (!pos) continue;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : pos.count;
    if (count < 3) continue;
    const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i + 2 < count; i += 3) {
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, index ? index.getX(i + k) : i + k).applyMatrix4(m);
        out.push(v.x, v.y, v.z);
      }
    }
  }
  return out;
}

/**
 * Measure each wheel's rolling geometry off its own mesh.
 *
 * The axle is found the same way the steering measurement finds it, by which
 * horizontal axis the wheel is THIN along, so a model authored facing a
 * different way still rolls about the right axis. The offset is taken from the
 * midpoint of each axle's pair rather than from the model origin, which makes
 * the two sides exactly equal and opposite however the mesh was centred.
 */
function measureWheelSpin(
  nodes: Record<SuspensionCorner, THREE.Object3D>,
  wheels: Record<SuspensionCorner, THREE.Object3D | null>,
): Record<SuspensionCorner, WheelSpin | null> {
  const out = {} as Record<SuspensionCorner, WheelSpin | null>;
  for (const c of CORNERS) out[c] = null;

  for (const [left, right] of [
    ['fl', 'fr'],
    ['rl', 'rr'],
  ] as const) {
    for (const c of [left, right] as const) {
      const wheel = wheels[c];
      if (!wheel) continue;
      const meshes = meshesUnder(wheel, []);
      if (!meshes.length) continue;
      const verts = vertexList(meshes, wheel);
      let halfX = 0;
      let halfZ = 0;
      for (let i = 0; i + 2 < verts.length; i += 3) {
        halfX = Math.max(halfX, Math.abs(verts[i]));
        halfZ = Math.max(halfZ, Math.abs(verts[i + 2]));
      }
      const axleIsX = halfX < halfZ;
      let radius = 0;
      for (let i = 0; i + 2 < verts.length; i += 3) {
        const across = axleIsX ? verts[i + 2] : verts[i];
        radius = Math.max(radius, Math.hypot(verts[i + 1], across));
      }
      if (radius <= 1e-9) continue;
      out[c] = {
        axis: axleIsX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1),
        radius,
        offset: 0,
      };
    }
    // Equal and opposite about this axle's own midpoint.
    const a = out[left];
    const b = out[right];
    if (!a || !b) continue;
    const along = (c: SuspensionCorner) =>
      a.axis.x !== 0 ? nodes[c].position.x : nodes[c].position.z;
    const half = Math.abs(along(left) - along(right)) / 2;
    const leftIsLower = along(left) < along(right);
    a.offset = leftIsLower ? -half : half;
    b.offset = leftIsLower ? half : -half;
  }
  return out;
}

/** Signed rotation about `axis` that takes `from` to `to`, in radians.
 *  A wheel only ever turns about its axle, so the relative rotation is about
 *  that axis and this reads its angle straight off. */
function spinDelta(from: THREE.Quaternion, to: THREE.Quaternion, axis: THREE.Vector3): number {
  if (Number.isNaN(from.w)) return 0;
  tmpQuat.copy(from).invert().multiply(to);
  const along = tmpQuat.x * axis.x + tmpQuat.y * axis.y + tmpQuat.z * axis.z;
  return 2 * Math.atan2(along, tmpQuat.w);
}

/**
 * Measure how far a front wheel can turn before the tire meets the bodywork.
 *
 * Runs in the STEER NODE's own space, because steering is a rotation about that
 * node's Y and in its frame every point of the wheel keeps its radius and its
 * height and only changes angle. `vehicle_steering_core` owns the geometry; all
 * this does is hand it the two sets of surfaces and the travel range.
 *
 * The travel range is the point of the exercise. A wheel at full bump sits deep
 * in the arch with much less room to turn than one at rest, so the sweep runs
 * from full droop to full bump and keeps the tightest answer. Measuring the
 * rest pose alone ships a car that steers cleanly on flat ground and saws
 * through its own fender on the first rise.
 */
function measureSteerLock(
  chassis: THREE.Object3D,
  nodes: Record<SuspensionCorner, THREE.Object3D>,
  steer: Record<string, THREE.Object3D | null>,
  envelope: SuspensionEnvelope,
): SteerLimits {
  const body = meshesUnder(
    chassis,
    CORNERS.map((c) => nodes[c]),
  );
  let lock: SteerLimits = { pos: STEER_CAP, neg: STEER_CAP };
  if (!body.length) return lock;

  for (const c of STEER_CORNERS) {
    const node = steer[c];
    if (!node) continue;
    const wheelMeshes = meshesUnder(node, []);
    if (!wheelMeshes.length) continue;

    const verts = vertexList(wheelMeshes, node);
    let reach = 0;
    let halfX = 0;
    let halfZ = 0;
    for (let i = 0; i + 2 < verts.length; i += 3) {
      const r = Math.hypot(verts[i], verts[i + 2]);
      if (r > reach) reach = r;
      halfX = Math.max(halfX, Math.abs(verts[i]));
      halfZ = Math.max(halfZ, Math.abs(verts[i + 2]));
    }
    if (reach <= 1e-9) continue;

    // Which way the axle runs, read off the mesh: a wheel is thin along it.
    // Assuming X would work on this model and break on the next one authored
    // facing a different axis, which is the mistake the rest of this file
    // exists to avoid.
    const axleIsX = halfX < halfZ;
    let radius = 0;
    for (let i = 0; i + 2 < verts.length; i += 3) {
      const across = axleIsX ? verts[i + 2] : verts[i];
      radius = Math.max(radius, Math.hypot(verts[i + 1], across));
    }

    const cell = reach * STEER_CELL_PER_REACH;
    const limits = measureSteerLimits(
      wheelSilhouette(verts, cell),
      buildBodyBands(triangleList(body, node), cell),
      -envelope.corner[c].droop,
      envelope.corner[c].bump,
      STEER_CAP,
      { radius, halfWidth: axleIsX ? halfX : halfZ, axleIsX },
    );
    // Both front wheels turn together, so the pair is limited by whichever one
    // runs out of room first.
    lock = { pos: Math.min(lock.pos, limits.pos), neg: Math.min(lock.neg, limits.neg) };
  }
  return { pos: lock.pos * STEER_KEEP, neg: lock.neg * STEER_KEEP };
}

/**
 * Measure what the bodywork allows, in model units.
 *
 * Every number here is a real part of the car meeting either another part of
 * the car or the ground:
 *   - BUMP is the true vertical gap from the tire's surface up to the arch
 *     above it. Measured against the tire's actual curved crown, not its
 *     bounding box, or the fender lip hanging down beside the tire reads as a
 *     near-zero ceiling.
 *   - DROOP is how far the hub can fall before it sits level with the
 *     underbody, which is where a hanging wheel stops looking like a car.
 *   - PITCH is the approach and departure angles: the front and rear overhangs
 *     against the ground. They differ, so the two limits differ.
 *   - ROLL is the underbody sill against the ground on the low side.
 */
function measureEnvelope(
  chassis: THREE.Object3D,
  nodes: Record<SuspensionCorner, THREE.Object3D>,
): SuspensionEnvelope | null {
  const suspNodes = CORNERS.map((c) => nodes[c]);
  const body = meshesUnder(chassis, suspNodes);
  if (!body.length) return null;

  // Wheel extents, per corner, in the chassis frame.
  const wheel: Record<
    SuspensionCorner,
    { hub: number; r: number; x: number; z: number; xlo: number; xhi: number }
  > = {} as never;
  for (const c of CORNERS) {
    const meshes = meshesUnder(nodes[c], []);
    if (!meshes.length) return null;
    let ylo = Infinity;
    let yhi = -Infinity;
    let xlo = Infinity;
    let xhi = -Infinity;
    forEachVertex(meshes, chassis, (x, y) => {
      if (y < ylo) ylo = y;
      if (y > yhi) yhi = y;
      if (x < xlo) xlo = x;
      if (x > xhi) xhi = x;
    });
    if (!Number.isFinite(ylo)) return null;
    wheel[c] = {
      hub: (ylo + yhi) / 2,
      r: (yhi - ylo) / 2,
      x: nodes[c].position.x,
      z: nodes[c].position.z,
      xlo,
      xhi,
    };
  }

  // The ground the wheels rest on, in this same frame.
  const groundY = Math.min(...CORNERS.map((c) => wheel[c].hub - wheel[c].r));
  const frontZ = (wheel.fl.z + wheel.fr.z) / 2;
  const rearZ = (wheel.rl.z + wheel.rr.z) / 2;
  const noseIsPlusZ = frontZ > rearZ;

  const gap: Record<SuspensionCorner, number> = {
    fl: Infinity,
    fr: Infinity,
    rl: Infinity,
    rr: Infinity,
  };
  let underbody = Infinity;
  // The tightest ANGLE any bodywork allows, per axis. Taken per vertex rather
  // than from the single lowest point, because the part that grounds first is
  // not always the lowest one: a slightly higher vertex much further past the
  // axle binds sooner. Rotating by `a` about a contact patch drops a point
  // `reach` away by `reach * sin(a)`, so the vertex's own limit is
  // atan2(clearance, reach) and the car's limit is the smallest of them.
  const centerX = (wheel.fl.x + wheel.fr.x + wheel.rl.x + wheel.rr.x) / 4;
  let approach = Infinity;
  let departure = Infinity;
  let rollLimit = Infinity;
  const tighten = (clearance: number, reach: number, current: number) => {
    if (reach <= 1e-6) return current;
    const a = Math.atan2(Math.max(clearance, 0), reach);
    return a < current ? a : current;
  };

  const seen = forEachVertex(body, chassis, (x, y, z) => {
    if (y < underbody) underbody = y;
    for (const c of CORNERS) {
      const w = wheel[c];
      if (x < w.xlo || x > w.xhi || y < w.hub) continue;
      const dz = z - w.z;
      if (Math.abs(dz) >= w.r) continue;
      // Height of the tire's crown directly below this vertex.
      const g = y - (w.hub + Math.sqrt(w.r * w.r - dz * dz));
      if (g < gap[c]) gap[c] = g;
    }
    const clear = y - groundY;
    approach = tighten(clear, noseIsPlusZ ? z - frontZ : frontZ - z, approach);
    departure = tighten(clear, noseIsPlusZ ? rearZ - z : z - rearZ, departure);
    rollLimit = tighten(clear, Math.abs(x - centerX), rollLimit);
  });
  if (!seen) return null;

  const corner = {} as Record<SuspensionCorner, { bump: number; droop: number }>;
  for (const c of CORNERS) {
    const bump = Number.isFinite(gap[c]) ? Math.max(gap[c], 0) * CLEARANCE_KEEP : 0;
    const droop = Math.max(wheel[c].hub - underbody, 0) * CLEARANCE_KEEP;
    corner[c] = { bump, droop };
  }
  const keep = (a: number) => (Number.isFinite(a) ? a * ANGLE_KEEP : FALLBACK_ANGLE);
  return {
    corner,
    // Nose UP swings the TAIL down, so the departure angle is the nose-up limit.
    pitchUp: keep(departure),
    pitchDown: keep(approach),
    roll: keep(rollLimit),
  };
}

function fallbackEnvelope(track: number): SuspensionEnvelope {
  const bump = track * FALLBACK_BUMP_PER_TRACK;
  const droop = track * FALLBACK_DROOP_PER_TRACK;
  const corner = {} as Record<SuspensionCorner, { bump: number; droop: number }>;
  for (const c of CORNERS) corner[c] = { bump, droop };
  return { corner, pitchUp: FALLBACK_ANGLE, pitchDown: FALLBACK_ANGLE, roll: FALLBACK_ANGLE };
}

/**
 * Build the rig for a mount, or return null if it has no suspension nodes
 * (every mount that is not a wheeled vehicle, which is most of them).
 *
 * Call once per view and cache: it forces a world-matrix update and walks the
 * body mesh once to measure the envelope.
 */
/** Measured-once-per-MODEL results, shared by every instance of it.
 *
 *  The measuring passes below sweep every vertex of the vehicle and build a
 *  flat triangle list of its whole body, twice (once per steered corner). On
 *  the Rallycart that is 24,815 vertices and an 18,506-triangle body, so each
 *  steering measurement alone allocates a 166,554-float array. All of it is a
 *  pure function of the MODEL: clones share their geometry (the asset caches in
 *  characters/assets.ts are immutable and never disposed) and the `Susp_*`
 *  nodes sit at the same local positions in every copy, so two riders on the
 *  same vehicle measure the identical envelope and steering lock.
 *
 *  Doing it per instance made every summon pay the whole sweep on the frame the
 *  mount appears, which is a visible hitch on EVERY summon, not just the first
 *  (the shader-program side was already gated, and the mount prewarm only
 *  covers the first sighting, so neither of those covered this).
 *
 *  Keyed on the geometry identity of the meshes under the chassis, not on a
 *  mount key: this module deliberately knows nothing about which vehicle it is
 *  measuring, and a re-exported model gets fresh geometry and so a fresh entry.
 *  Both cached values are read-only downstream (the mutable per-frame state is
 *  `rig.state` and `rig.steerState`, minted per instance), so sharing them
 *  cannot couple two riders together.
 *
 *  Bounded by the number of distinct vehicle models the session draws, and each
 *  entry is a handful of numbers, so it is never worth evicting. */
const MEASURED_BY_GEOMETRY = new Map<string, VehicleMeasurement>();

interface VehicleMeasurement {
  envelope: SuspensionEnvelope;
  steerLock: SteerLimits;
}

/** A stable identity for the chassis' geometry set. Cheap: it walks the node
 *  tree (tens of nodes) and reads uuids, never any vertex data. */
function geometryKey(chassis: THREE.Object3D): string {
  const ids: string[] = [];
  chassis.traverse((o) => {
    const geometry = (o as THREE.Mesh).geometry;
    if (geometry?.uuid) ids.push(geometry.uuid);
  });
  return ids.sort().join('|');
}

export function createVehicleSuspensionRig(
  mountRoot: THREE.Object3D,
  group: THREE.Object3D,
): VehicleSuspensionRig | null {
  const nodes = {} as Record<SuspensionCorner, THREE.Object3D>;
  for (const c of CORNERS) {
    const node = mountRoot.getObjectByName(NODE_NAMES[c]);
    if (!node) return null;
    nodes[c] = node;
  }
  // The corner nodes are siblings, so their shared parent IS the model space
  // every measurement below is expressed in.
  const chassis = nodes.fl.parent;
  if (!chassis) return null;

  // Read the rest pose before anything has perturbed it. The mount was just
  // built, so its matrices have not necessarily been flushed yet.
  mountRoot.updateWorldMatrix(true, true);

  const offsets = {} as Record<SuspensionCorner, THREE.Vector3>;
  for (const c of CORNERS) {
    nodes[c].getWorldPosition(tmpVec);
    offsets[c] = group.worldToLocal(tmpVec.clone());
  }

  // Distances in MODEL units, straight off the node positions.
  const p = (c: SuspensionCorner) => nodes[c].position;
  const wheelbase = (Math.abs(p('fl').z - p('rl').z) + Math.abs(p('fr').z - p('rr').z)) * 0.5;
  const track = (Math.abs(p('fl').x - p('fr').x) + Math.abs(p('rl').x - p('rr').x)) * 0.5;

  // Sign conventions read off the geometry rather than assumed. A vehicle
  // exported facing the other way flips these and everything downstream is
  // still correct.
  const frontSign = p('fl').z + p('fr').z >= 0 ? 1 : -1;
  const rightSign = p('fr').x + p('rr').x >= 0 ? 1 : -1;

  const wheels = {} as Record<SuspensionCorner, THREE.Object3D | null>;
  const wheelHold = {} as Record<SuspensionCorner, THREE.Quaternion>;
  for (const c of CORNERS) {
    wheels[c] = mountRoot.getObjectByName(WHEEL_NAMES[c]) ?? null;
    wheelHold[c] = new THREE.Quaternion().copy(wheels[c]?.quaternion ?? new THREE.Quaternion());
  }

  const steer: Record<string, THREE.Object3D | null> = {};
  for (const c of STEER_CORNERS) steer[c] = mountRoot.getObjectByName(STEER_NAMES[c]) ?? null;

  const key = geometryKey(chassis);
  let measured = MEASURED_BY_GEOMETRY.get(key);
  if (!measured) {
    const measuredEnvelope = measureEnvelope(chassis, nodes) ?? fallbackEnvelope(track);
    measured = {
      envelope: measuredEnvelope,
      steerLock: measureSteerLock(chassis, nodes, steer, measuredEnvelope),
    };
    MEASURED_BY_GEOMETRY.set(key, measured);
  }
  const envelope = measured.envelope;

  return {
    nodes,
    offsets,
    chassis,
    wheels,
    wheelHold,
    steer,
    steerLock: measured.steerLock,
    steerState: createSteering(),
    prevFacing: Number.NaN,
    fallPeak: 0,
    wasGrounded: true,
    pivoting: false,
    spin: measureWheelSpin(nodes, wheels),
    spinPrev: {
      fl: new THREE.Quaternion(0, 0, 0, Number.NaN),
      fr: new THREE.Quaternion(0, 0, 0, Number.NaN),
      rl: new THREE.Quaternion(0, 0, 0, Number.NaN),
      rr: new THREE.Quaternion(0, 0, 0, Number.NaN),
    },
    spinRate: { fl: 0, fr: 0, rl: 0, rr: 0 },
    airRate: { fl: 0, fr: 0, rl: 0, rr: 0 },
    overspin: { fl: 0, fr: 0, rl: 0, rr: 0 },
    unitScale: chassis.getWorldScale(tmpVec).x || 1,
    applied: { fl: 0, fr: 0, rl: 0, rr: 0 },
    lastWritten: { fl: Number.NaN, fr: Number.NaN, rl: Number.NaN, rr: Number.NaN },
    appliedRotX: 0,
    lastRotX: Number.NaN,
    wheelbase,
    track,
    frontSign,
    rightSign,
    envelope,
    heights: { fl: 0, fr: 0, rl: 0, rr: 0 },
    sampleT: 0,
    state: createSuspension(),
  };
}

/**
 * One frame of suspension.
 *
 * Call AFTER the mount's animation mixer and after `applyRocketSledAttitude`:
 * the body rotation composes with the pitch that pass already wrote, and the
 * per-corner travel adds to whatever the mixer left on the node, so the clip's
 * own road bumps and the terrain response coexist.
 *
 * `sample` is the world's ground-height function; pass a bound one, this runs
 * every frame.
 */
export function applyVehicleSuspension(
  rig: VehicleSuspensionRig,
  group: THREE.Object3D,
  mountRoot: THREE.Object3D,
  riderRoot: THREE.Object3D,
  seatLift: number,
  seatFwd: number,
  grounded: boolean,
  spinning: boolean,
  facing: number,
  dyRaw: number,
  sample: (x: number, z: number) => number,
  dt: number,
): void {
  // Landing squat. Watch the descent while the car is off the ground and spend
  // the worst of it on the frame it arrives, so the springs take the impact and
  // push back out rather than the body simply appearing at rest.
  if (!grounded) {
    const descent = dt > 1e-6 ? -dyRaw / dt : 0;
    if (descent > rig.fallPeak) rig.fallPeak = descent;
  } else if (!rig.wasGrounded) {
    const span = LANDING_FULL_SPEED - LANDING_SOFT_SPEED;
    landSuspension(rig.state, (rig.fallPeak - LANDING_SOFT_SPEED) / span, rig.envelope);
    rig.fallPeak = 0;
  }
  // Takeoff: latch the speed the tires were turning at as they left the ground.
  // Latched rather than tracked live because the airborne clip turns the wheels
  // at its own authored rate, so once the tire is off the ground the animation
  // is no longer a reading of how fast the car was going.
  if (rig.wasGrounded && !grounded) {
    for (const c of CORNERS) rig.airRate[c] = rig.spinRate[c] * AIRBORNE_SPIN_GAIN;
  }
  rig.wasGrounded = grounded;

  // The yaw rate the wheels answer to, both for steering and for a pivot turn.
  const yawRate =
    Number.isNaN(rig.prevFacing) || dt <= 1e-6 ? 0 : wrapAngle(facing - rig.prevFacing) / dt;
  rig.prevFacing = facing;
  rig.pivoting = !spinning && grounded && Math.abs(yawRate) > PIVOT_MIN_YAW;
  rig.sampleT -= dt;
  if (rig.sampleT <= 0) {
    rig.sampleT = SAMPLE_INTERVAL;
    for (const c of CORNERS) {
      group.localToWorld(tmpVec.copy(rig.offsets[c]));
      // World height into model units: everything downstream is model space.
      rig.heights[c] = sample(tmpVec.x, tmpVec.z) / rig.unitScale;
    }
  }

  stepSuspension(rig.state, rig.heights, rig.wheelbase, rig.track, rig.envelope, grounded, dt);

  // Body attitude. Pitch composes onto whatever the jump-attitude pass wrote,
  // backing out our own last contribution first so this is stable even if that
  // pass did not run this frame. Roll is ours alone, so it is a plain write.
  const basePitch =
    mountRoot.rotation.x === rig.lastRotX ? rig.lastRotX - rig.appliedRotX : mountRoot.rotation.x;
  const ourPitch = -rig.state.pitch * rig.frontSign;
  const rotX = basePitch + ourPitch;
  const rotZ = rig.state.roll * rig.rightSign;
  mountRoot.rotation.x = rotX;
  mountRoot.rotation.z = rotZ;
  rig.appliedRotX = ourPitch;
  rig.lastRotX = rotX;

  // Carry the separately-owned rider root rigidly with the body: same rotation,
  // and the seat point swung around the vehicle origin. Building one Euler and
  // reusing it for both keeps the two exactly in step whatever Three's rotation
  // order is. The seat offsets are WORLD units on a root outside the model
  // scale, so they need no conversion.
  tmpEuler.set(rotX, 0, rotZ, mountRoot.rotation.order);
  riderRoot.rotation.x = rotX;
  riderRoot.rotation.z = rotZ;
  tmpSeat.set(0, seatLift, seatFwd).applyEuler(tmpEuler);
  riderRoot.position.x = tmpSeat.x;
  riderRoot.position.y = tmpSeat.y;
  riderRoot.position.z = tmpSeat.z;

  // Wheel angle. Three jobs share this slot, all of them writing the wheel
  // AFTER the mixer has had its say:
  //
  //   1. Remember the angle while it turns and put it back when it does not, so
  //      a parked wheel stays where it stopped instead of the mixer restoring
  //      it to the authored home angle the moment the locomotion clip lets go.
  //   2. Off the ground, run the tire at AIRBORNE_SPIN_GAIN times the rate it
  //      left at, by adding exactly the difference between that and whatever
  //      the airborne clip is doing. Adding the difference rather than taking
  //      the channel over keeps the spin continuous through touchdown.
  //   3. Parked and turning on the spot, roll the rear wheels against each
  //      other so the car reads as pivoting rather than sliding.
  for (const c of CORNERS) {
    const wheel = rig.wheels[c];
    if (!wheel) continue;
    const spin = rig.spin[c];
    if (spinning) {
      if (spin) {
        // What the clip turned this wheel by, this frame.
        const delta = spinDelta(rig.spinPrev[c], wheel.quaternion, spin.axis);
        rig.spinPrev[c].copy(wheel.quaternion);
        const clipRate = dt > 1e-6 ? delta / dt : 0;
        if (grounded) {
          rig.spinRate[c] += (clipRate - rig.spinRate[c]) * (1 - Math.exp(-SPIN_RATE_TRACK * dt));
        } else {
          rig.overspin[c] += (rig.airRate[c] - clipRate) * dt;
        }
        if (rig.overspin[c] !== 0) {
          wheel.quaternion.multiply(tmpQuatB.setFromAxisAngle(spin.axis, rig.overspin[c]));
        }
      }
      rig.wheelHold[c].copy(wheel.quaternion);
      continue;
    }
    // Standing still. A car turning on the spot cannot roll its wheels at all
    // in real life, which is exactly why it looks like the whole vehicle is
    // skidding if they sit dead. Rolling them like a tracked vehicle, at the
    // rate the ground under each one is actually passing, sells the rotation.
    if (spin && grounded && PIVOT_CORNERS.includes(c) && yawRate !== 0) {
      const rate = pivotWheelRate(yawRate, spin.offset, spin.radius);
      rig.wheelHold[c].multiply(tmpQuatB.setFromAxisAngle(spin.axis, rate * dt));
    }
    wheel.quaternion.copy(rig.wheelHold[c]);
    if (spin) rig.spinPrev[c].copy(wheel.quaternion);
  }

  // Front wheels. The steering signal is the entity's own YAW RATE, not the
  // keyboard: turning is exactly what the turn keys do to `facing`, and reading
  // the result rather than the input means remote riders steer too, mouse-look
  // turning steers, and nothing about player input reaches this layer.
  //
  // The sign needs no correction for how the model was authored. The group's
  // yaw is set straight from `facing` and the model's own `def.yaw` offset is a
  // Y rotation as well, and Y rotations commute, so a positive yaw rate is a
  // positive angle on this node whichever way the mesh faces. Pitch and roll
  // above have no such luxury, which is why they carry `frontSign`/`rightSign`.
  const steerAngle = stepSteering(rig.steerState, yawRate / STEER_FULL_LOCK_YAW, rig.steerLock, dt);
  for (const c of STEER_CORNERS) {
    const node = rig.steer[c];
    if (node) node.rotation.y = steerAngle;
  }

  // Per-corner springs, in the node's own units, ADDED to the mixer's value.
  for (const c of CORNERS) {
    const node = rig.nodes[c];
    const base =
      node.position.y === rig.lastWritten[c]
        ? rig.lastWritten[c] - rig.applied[c]
        : node.position.y;
    const y = base + rig.state.travel[c];
    node.position.y = y;
    rig.applied[c] = rig.state.travel[c];
    rig.lastWritten[c] = y;
  }
}
