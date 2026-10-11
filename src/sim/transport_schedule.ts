// The scheduled transport ship timetable: a fixed, endlessly repeating cycle
// derived from a schedule clock ONLY (the sim's own seconds plus a dev-only
// offset, never a wall clock), so every host that knows the clock agrees on
// the phase and the ship's pose without any extra state. The online client
// reads the clock off the snapshot head and derives the same answers.
//
// One cycle, for a route with berths A (index 0) and B (index 1):
//   docked at A (boarding open) -> sailing the A -> B sea lane (the whole
//   voyage in sight, bow first from berth to berth) -> docked at B -> the
//   mirror voyage back along the B -> A lane.
//
// A sea lane is authored waypoints (x, z, optional rot) in world yards, from
// the departure berth's pose to the arrival berth's pose. Positions follow a
// uniform Catmull-Rom spline through the waypoints, walked by arc length. The
// heading is a Catmull-Rom curve through the waypoint headings, a waypoint
// without `rot` taking its lane's local direction, so the bow follows the
// lane and an authored rot can pivot the ship where the lane turns tighter
// than its hull. The ship's speed along a lane is a seamanlike profile, not a
// constant: it gathers way from rest at a fixed acceleration, cruises, slows
// wherever the lane turns so its heading never swings faster than
// `turnRate`, and comes to rest at the far berth (a forward and a backward
// pass over a one-yard table; the voyage's length in seconds falls out of it).
//
// Pure leaf: no SimContext, no rng, no clock of its own. Every function takes
// the clock in and returns plain numbers; the `out` parameters let per-frame
// callers (the renderer) and per-tick callers (the deck) stay allocation free.

/** One authored point of a sea lane: a world position and, optionally, a
 *  heading (three.js rotation.y convention: the bow points along (sin rot,
 *  cos rot)). Without `rot` the ship points along the lane there. */
export interface TransportWaypoint {
  x: number;
  z: number;
  rot?: number;
}

/** Where a set-down player lands: on the pier beside the berth. */
export interface TransportLanding {
  x: number;
  z: number;
  facing: number;
}

export interface TransportBerthDef {
  /** Stable id (the timetable view names berths by it). */
  id: string;
  /** The zone point of interest the berth serves, as a Book of Deeds POI mark
   *  (`poi:<zoneId>:<poiId>`): the HUD shows that POI's localized label as the
   *  destination name, so a town name is never re-authored here. */
  poi: string;
  /** The moored pose: the first point of the lane leaving it, the last of the
   *  lane arriving at it. */
  x: number;
  z: number;
  rot: number;
  /** The pier spot a player is set down on (left on the gangplank at a
   *  departure, or a save taken aboard: nobody ever loads into the sea). */
  landing: TransportLanding;
}

/** How long the ship lies at each berth, and how it handles under way. The
 *  cycle is both waits plus both voyages (transportVoyageSeconds). */
export interface TransportTimings {
  /** Seconds moored at a berth, boarding open. */
  docked: number;
  /** Top speed, yards per second. */
  cruise: number;
  /** Gathering and losing way, yards per second squared. */
  accel: number;
  /** Fastest the heading ever swings, radians per second. */
  turnRate: number;
}

export interface TransportRouteDef {
  id: string;
  /** Hull layout key (content/transport_ships.ts TRANSPORT_SHIP_HULLS) and
   *  ship model key (render/transport_ship.ts). */
  ship: string;
  /** Exactly two berths: the route runs A -> B -> A. */
  berths: readonly [TransportBerthDef, TransportBerthDef];
  /** The sea lanes: [A -> B, B -> A], each from its departure berth's pose to
   *  the far berth's pose. */
  lanes: readonly [readonly TransportWaypoint[], readonly TransportWaypoint[]];
  timings: TransportTimings;
}

export type TransportPhase = 'docked' | 'sailing';

/** The route's state at one clock reading. */
export interface TransportPhaseState {
  phase: TransportPhase;
  /** docked: where the ship lies. sailing: the berth it is bound for. */
  berth: number;
  /** The voyage in progress or, while docked, the next one. */
  from: number;
  to: number;
  /** Seconds into and left in this phase. */
  elapsed: number;
  remaining: number;
  /** Seconds until the next departure (0 while sailing). */
  departsIn: number;
}

/** A ship pose in the world: the hull frame's origin and heading. */
export interface TransportPose {
  x: number;
  z: number;
  rot: number;
}

export function newTransportPhaseState(): TransportPhaseState {
  return { phase: 'docked', berth: 0, from: 0, to: 1, elapsed: 0, remaining: 0, departsIn: 0 };
}

/** Seconds one voyage along `route`'s lane `lane` (0: A -> B) takes. */
export function transportVoyageSeconds(route: TransportRouteDef, lane: number): number {
  const t = profileFor(route.lanes[lane], route.timings);
  return t.times[t.times.length - 1];
}

export function transportCycleSeconds(route: TransportRouteDef): number {
  return (
    2 * route.timings.docked + transportVoyageSeconds(route, 0) + transportVoyageSeconds(route, 1)
  );
}

/** The phase of `route` at schedule `clock` seconds (any real number). */
export function transportPhaseAt(
  route: TransportRouteDef,
  clock: number,
  out: TransportPhaseState = newTransportPhaseState(),
): TransportPhaseState {
  const cycle = transportCycleSeconds(route);
  const docked = route.timings.docked;
  const firstTrip = docked + transportVoyageSeconds(route, 0);
  let t = clock % cycle;
  if (t < 0) t += cycle;
  // the first trip is A -> B (docked at A first), the second B -> A
  const trip = t < firstTrip ? 0 : 1;
  const local = t - trip * firstTrip;
  const sailing = transportVoyageSeconds(route, trip);
  out.from = trip;
  out.to = 1 - trip;
  if (local < docked) {
    out.phase = 'docked';
    out.berth = trip;
    out.elapsed = local;
    out.remaining = docked - local;
    out.departsIn = out.remaining;
  } else {
    out.phase = 'sailing';
    out.berth = 1 - trip;
    out.elapsed = Math.min(sailing, local - docked);
    out.remaining = Math.max(0, sailing - out.elapsed);
    out.departsIn = 0;
  }
  return out;
}

const scratchPhase = newTransportPhaseState();

/** Whether `berth`'s moored hull (its deck colliders) exists at `clock`:
 *  only while the ship lies docked there. */
export function transportBerthOpenAt(
  route: TransportRouteDef,
  berth: number,
  clock: number,
): boolean {
  const s = transportPhaseAt(route, clock, scratchPhase);
  return s.phase === 'docked' && s.berth === berth;
}

// ---------------------------------------------------------------------------
// Lane geometry
// ---------------------------------------------------------------------------

/** Arc-length samples per lane segment (the constant-speed table). */
const ARC_SAMPLES_PER_SEGMENT = 64;

interface LaneTable {
  /** cumulative arc length at each sample, sample 0 = 0 */
  lengths: Float64Array;
  /** spline parameter u (0 .. n-1) at each sample */
  us: Float64Array;
  /** the waypoint headings, filled where unauthored and unwrapped so that
   *  each lies within PI of the one before (a smooth curve through them
   *  never takes the long way round) */
  rots: Float64Array;
}

// Memo of the tables per authored lane array. A pure function of the (frozen,
// module-level) content, so the memo is a cache, never state.
const tables = new WeakMap<readonly TransportWaypoint[], LaneTable>();

function catmull(p0: number, p1: number, p2: number, p3: number, s: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * s +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * s3)
  );
}

/** The segment index and fraction of spline parameter u (0 .. n-1). */
function segmentOf(n: number, u: number): { i: number; s: number } {
  const i = Math.min(n - 2, Math.max(0, Math.floor(u)));
  return { i, s: u - i };
}

/** Spline position at parameter u (0 .. n-1), into out.x / out.z. */
function splineAt(
  lane: readonly TransportWaypoint[],
  u: number,
  out: { x: number; z: number },
): void {
  const n = lane.length;
  if (n === 1) {
    out.x = lane[0].x;
    out.z = lane[0].z;
    return;
  }
  const { i, s } = segmentOf(n, u);
  const p0 = lane[Math.max(0, i - 1)];
  const p1 = lane[i];
  const p2 = lane[i + 1];
  const p3 = lane[Math.min(n - 1, i + 2)];
  out.x = catmull(p0.x, p1.x, p2.x, p3.x, s);
  out.z = catmull(p0.z, p1.z, p2.z, p3.z, s);
}

/** Shortest signed angle from a to b (radians, in [-PI, PI)). */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d < -Math.PI) d += Math.PI * 2;
  else if (d >= Math.PI) d -= Math.PI * 2;
  return d;
}

/** The lane's headings at its waypoints: authored, else the direction from
 *  the previous waypoint to the next (one-sided at the ends), unwrapped. */
function laneHeadings(lane: readonly TransportWaypoint[]): Float64Array {
  const n = lane.length;
  const rots = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const w = lane[k];
    let rot = w.rot;
    if (rot === undefined) {
      const a = lane[Math.max(0, k - 1)];
      const b = lane[Math.min(n - 1, k + 1)];
      rot = Math.atan2(b.x - a.x, b.z - a.z);
    }
    rots[k] = k === 0 ? rot : rots[k - 1] + angleDelta(rots[k - 1], rot);
  }
  return rots;
}

const sampleScratch = { x: 0, z: 0 };

function tableFor(lane: readonly TransportWaypoint[]): LaneTable {
  const cached = tables.get(lane);
  if (cached) return cached;
  const segs = Math.max(1, lane.length - 1);
  const count = segs * ARC_SAMPLES_PER_SEGMENT + 1;
  const lengths = new Float64Array(count);
  const us = new Float64Array(count);
  splineAt(lane, 0, sampleScratch);
  let px = sampleScratch.x;
  let pz = sampleScratch.z;
  for (let k = 1; k < count; k++) {
    const u = (k / (count - 1)) * segs;
    splineAt(lane, u, sampleScratch);
    lengths[k] = lengths[k - 1] + Math.hypot(sampleScratch.x - px, sampleScratch.z - pz);
    us[k] = u;
    px = sampleScratch.x;
    pz = sampleScratch.z;
  }
  const table = { lengths, us, rots: laneHeadings(lane) };
  tables.set(lane, table);
  return table;
}

/** Total length of a lane (yards), for authoring checks and the timetable. */
export function transportLaneLength(lane: readonly TransportWaypoint[]): number {
  const t = tableFor(lane);
  return t.lengths[t.lengths.length - 1];
}

/** The pose `distance` yards along `lane` (clamped to its ends). */
export function transportLanePoseAt(
  lane: readonly TransportWaypoint[],
  distance: number,
  out: TransportPose,
): TransportPose {
  const n = lane.length;
  const table = tableFor(lane);
  const total = table.lengths[table.lengths.length - 1];
  if (n === 1 || distance <= 0) {
    out.x = lane[0].x;
    out.z = lane[0].z;
    out.rot = table.rots[0];
    return out;
  }
  if (distance >= total) {
    out.x = lane[n - 1].x;
    out.z = lane[n - 1].z;
    out.rot = table.rots[n - 1];
    return out;
  }
  // binary search the arc table for the sample pair around `distance`
  let lo = 0;
  let hi = table.lengths.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table.lengths[mid] <= distance) lo = mid;
    else hi = mid;
  }
  const span = table.lengths[hi] - table.lengths[lo];
  const f = span > 1e-9 ? (distance - table.lengths[lo]) / span : 0;
  const u = table.us[lo] + (table.us[hi] - table.us[lo]) * f;
  splineAt(lane, u, out);
  const { i, s } = segmentOf(n, u);
  const r = table.rots;
  out.rot = catmull(r[Math.max(0, i - 1)], r[i], r[i + 1], r[Math.min(n - 1, i + 2)], s);
  return out;
}

// ---------------------------------------------------------------------------
// The voyage's speed profile
// ---------------------------------------------------------------------------

/** Yards between the speed profile's samples. */
const PROFILE_STEP = 1;

interface VoyageProfile {
  timings: TransportTimings;
  /** arc length (yards) and speed (yards per second) at each sample */
  dists: Float64Array;
  speeds: Float64Array;
  /** seconds from casting off at each sample */
  times: Float64Array;
}

const profiles = new WeakMap<readonly TransportWaypoint[], VoyageProfile>();
const profilePose: TransportPose = { x: 0, z: 0, rot: 0 };

/**
 * The lane's speed profile under `timings`: at each yard the ship goes no
 * faster than cruise, nor than its turn rate allows where the heading bends
 * (speed = turnRate / (radians per yard)), and it can reach and shed that
 * speed at `accel` from rest at both berths. Built once per lane (a cache of
 * frozen content).
 */
function profileFor(lane: readonly TransportWaypoint[], timings: TransportTimings): VoyageProfile {
  const cached = profiles.get(lane);
  if (cached && cached.timings === timings) return cached;
  const length = transportLaneLength(lane);
  const n = Math.max(2, Math.ceil(length / PROFILE_STEP) + 1);
  const dists = new Float64Array(n);
  const speeds = new Float64Array(n);
  const times = new Float64Array(n);
  const rots = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    dists[k] = (length * k) / (n - 1);
    rots[k] = transportLanePoseAt(lane, dists[k], profilePose).rot;
  }
  const step = length / (n - 1);
  for (let k = 0; k < n; k++) {
    const lo = Math.max(0, k - 1);
    const hi = Math.min(n - 1, k + 1);
    const bend = Math.abs(rots[hi] - rots[lo]) / ((hi - lo) * step);
    speeds[k] = Math.min(timings.cruise, bend > 1e-9 ? timings.turnRate / bend : Infinity);
  }
  // at rest at both berths; reachable under the acceleration both ways
  speeds[0] = 0;
  speeds[n - 1] = 0;
  for (let k = 1; k < n; k++) {
    speeds[k] = Math.min(speeds[k], Math.sqrt(speeds[k - 1] ** 2 + 2 * timings.accel * step));
  }
  for (let k = n - 2; k >= 0; k--) {
    speeds[k] = Math.min(speeds[k], Math.sqrt(speeds[k + 1] ** 2 + 2 * timings.accel * step));
  }
  for (let k = 1; k < n; k++) {
    const v = speeds[k - 1] + speeds[k];
    times[k] = times[k - 1] + (v > 1e-9 ? (2 * step) / v : 0);
  }
  const profile = { timings, dists, speeds, times };
  profiles.set(lane, profile);
  return profile;
}

/** Index of the last profile sample at or before `t` seconds. */
function sampleAt(p: VoyageProfile, t: number): number {
  let lo = 0;
  let hi = p.times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Yards along `lane` and the ship's speed `t` seconds after casting off.
 * Between two samples the ship accelerates uniformly, so the distance is
 * continuous and so is the speed.
 */
export function voyageMotionAt(
  lane: readonly TransportWaypoint[],
  timings: TransportTimings,
  t: number,
  out: { distance: number; speed: number },
): { distance: number; speed: number } {
  const p = profileFor(lane, timings);
  const last = p.times.length - 1;
  if (t <= 0) {
    out.distance = 0;
    out.speed = 0;
    return out;
  }
  if (t >= p.times[last]) {
    out.distance = p.dists[last];
    out.speed = 0;
    return out;
  }
  const k = sampleAt(p, t);
  const v0 = p.speeds[k];
  const v1 = p.speeds[k + 1];
  const dt = p.times[k + 1] - p.times[k];
  const tau = t - p.times[k];
  const a = dt > 1e-9 ? (v1 - v0) / dt : 0;
  out.distance = Math.min(p.dists[k + 1], p.dists[k] + v0 * tau + 0.5 * a * tau * tau);
  out.speed = v0 + a * tau;
  return out;
}

const motion = { distance: 0, speed: 0 };

/**
 * Where the ship is at `clock`. Docked: the berth pose. Sailing: along the
 * voyage's lane. Returns the pose (the phase it was computed at lands in
 * `phaseOut`).
 */
export function transportShipPoseAt(
  route: TransportRouteDef,
  clock: number,
  out: TransportPose,
  phaseOut: TransportPhaseState = scratchPose,
): TransportPose {
  const s = transportPhaseAt(route, clock, phaseOut);
  if (s.phase === 'docked') {
    const b = route.berths[s.berth];
    out.x = b.x;
    out.z = b.z;
    out.rot = b.rot;
    return out;
  }
  const lane = route.lanes[s.from];
  voyageMotionAt(lane, route.timings, s.elapsed, motion);
  return transportLanePoseAt(lane, motion.distance, out);
}

const scratchPose = newTransportPhaseState();

/** The ship's speed at `clock` (0 while docked). */
export function transportShipSpeedAt(route: TransportRouteDef, clock: number): number {
  const s = transportPhaseAt(route, clock, scratchPose);
  if (s.phase === 'docked') return 0;
  return voyageMotionAt(route.lanes[s.from], route.timings, s.elapsed, motion).speed;
}

// ---------------------------------------------------------------------------
// The read model the HUD and renderer consume (IWorld.ferryView)
// ---------------------------------------------------------------------------

/** One route's state for presentation. A LIVE object each world reuses:
 *  read it, never retain it across frames. */
export interface TransportFerryView {
  routeId: string;
  /** The schedule clock (seconds) this view was built at. */
  clock: number;
  phase: TransportPhase;
  /** Berth ids: docked = where it lies, sailing = bound for. */
  berth: string;
  from: string;
  to: string;
  /** Seconds left in this phase, and until the next departure (0 sailing). */
  remaining: number;
  departsIn: number;
  /** The ship's pose. */
  x: number;
  z: number;
  rot: number;
  /** Its speed (yards per second; 0 docked), for the wake. */
  speed: number;
  /** World Y of the hull frame's origin: the waterline it floats on. */
  baseY: number;
  /** Whether the viewing player rides it (aboard while it sails). */
  passenger: boolean;
}

export function emptyTransportFerryView(route: TransportRouteDef): TransportFerryView {
  const b = route.berths[0];
  return {
    routeId: route.id,
    clock: 0,
    phase: 'docked',
    berth: b.id,
    from: b.id,
    to: route.berths[1].id,
    remaining: 0,
    departsIn: 0,
    x: b.x,
    z: b.z,
    rot: b.rot,
    speed: 0,
    baseY: 0,
    passenger: false,
  };
}

const viewPhase = newTransportPhaseState();
const viewPose: TransportPose = { x: 0, z: 0, rot: 0 };

/** Fill `out` with `route` at `clock` for a viewer who is (or is not) aboard. */
export function transportFerryViewAt(
  route: TransportRouteDef,
  clock: number,
  baseY: number,
  passenger: boolean,
  out: TransportFerryView,
): TransportFerryView {
  transportShipPoseAt(route, clock, viewPose, viewPhase);
  out.routeId = route.id;
  out.clock = clock;
  out.phase = viewPhase.phase;
  out.berth = route.berths[viewPhase.berth].id;
  out.from = route.berths[viewPhase.from].id;
  out.to = route.berths[viewPhase.to].id;
  out.remaining = viewPhase.remaining;
  out.departsIn = viewPhase.departsIn;
  out.x = viewPose.x;
  out.z = viewPose.z;
  out.rot = viewPose.rot;
  out.speed = transportShipSpeedAt(route, clock);
  out.baseY = baseY;
  out.passenger = passenger;
  return out;
}
