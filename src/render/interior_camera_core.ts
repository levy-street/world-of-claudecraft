// The indoor chase-camera clamp's pure decisions (the driver is interior_camera.ts). A walk-in
// building registers its INTERIOR as the air a camera may occupy: a union of axis-aligned
// boxes in world yards (its rooms, the doorways and arches between them, a round tower),
// each box authored against the inner wall faces, the floors and the ceilings. While the
// player's eye stands in that air, the camera is kept in it: the chase ray from the look
// point to the desired camera is walked through the union, and the camera is pulled IN to
// the first point where the ray would leave the air, less a near-plane pad, the classic MMO
// indoor camera. The outer shell is then never between the lens and the player, so it never
// has to open onto the outside.
//
// This is the ONE sanctioned exception to the pinned rule that scene geometry never changes
// the chase camera's distance (tests/graphics_overhaul_integration.test.ts): outdoors nothing
// here runs (no interior holds the eye), and the player's requested distance is never
// written; only the drawn camera is pulled in, gliding both ways (stepInteriorBoom), and the
// clamp blends in over the first yards past a front door (interiorEntryWeight), so walking in
// the camera settles into the room rather than snapping in behind the head.
//
// Walking in through a front door the camera follows through it: past the door's outside
// face the lens is held no higher over the eye than the door's head allows
// (interiorEntryCap), keeping its distance behind the player, so its sight line threads the
// doorway while the lens is still outside; a ray that leaves the air through an OPENING may
// run on past it (interiorSegmentFraction's `through`), so nothing between the lens and the
// player has to be cut away. Where a ray would pass over a lintel or under a ceiling the
// camera flattens by the least that clears it (chooseInteriorFraming, found by bisection, so
// it changes smoothly with the walk) rather than pulling in: the lens never dives from high
// outside the building down into the head, and its height only falls on the way in.
//
// The same walk answers the nameplate question for a player indoors: a plate outside the
// interior shows only when the camera's sight line to it leaves the air through an OPENING
// (a face of a box the building marks as open onto the world, its front door), never
// through a wall.
//
// A piece of air is a box, or a box cut round by a vertical cylinder (a round tower's shaft:
// the cylinder's xz circle within the box's bounds), so a round room is exact, not stepped.
//
// Three-, DOM- and i18n-free, deterministic, allocation-free per call: slab and circle tests
// on a handful of pieces, with the last walk's exit written to module scratch.

/** One box of air, world yards: [x0, x1, y0, y1, z0, z1]. */
export type InteriorBox = readonly [number, number, number, number, number, number];

/** A vertical cylinder that rounds one box's air: its axis (x, z) and radius, world yards. */
export type InteriorRound = readonly [number, number, number];

/** A face of one box that opens onto the world outside (a front door): the box's index in
 *  the interior, the axis (0 x, 1 y, 2 z) and the side (+1 the max face, -1 the min face). */
export interface InteriorOpening {
  box: number;
  axis: 0 | 1 | 2;
  side: 1 | -1;
}

/** A registered interior: its air and its openings onto the world. */
export interface CameraInterior {
  id: string;
  /** Preserve the player's angle in enclosed rooms; adaptive interiors may seek a new
   *  framing. Door entry may still flatten briefly to thread an opening. */
  framing?: 'adaptive' | 'preserve-angle';
  boxes: readonly InteriorBox[];
  /** Per box, the cylinder that rounds it (null: the plain box). */
  rounds: readonly (InteriorRound | null)[];
  openings: readonly InteriorOpening[];
  /** Per opening, its threshold: how deep its box runs in from its outside face before the
   *  rooms' air begins (a front door's wall thickness). The eye is on the threshold, not yet
   *  indoors, until it is past it. */
  thresholds: readonly number[];
  /** The union's bounds: a point outside them is outside every box. */
  bounds: InteriorBox;
}

/** An opening's threshold: from its outside face in to where the other boxes that share its
 *  cross-section begin (none: the whole box). */
function openingThreshold(boxes: readonly InteriorBox[], o: InteriorOpening): number {
  const b = boxes[o.box];
  const a = o.axis;
  const face = o.side > 0 ? b[a * 2 + 1] : b[a * 2];
  let reach = o.side > 0 ? b[a * 2] : b[a * 2 + 1];
  for (let j = 0; j < boxes.length; j++) {
    if (j === o.box) continue;
    const c = boxes[j];
    let overlaps = true;
    for (let k = 0; k < 3; k++) {
      if (k === a) continue;
      if (c[k * 2] >= b[k * 2 + 1] || c[k * 2 + 1] <= b[k * 2]) overlaps = false;
    }
    if (!overlaps) continue;
    reach =
      o.side > 0
        ? Math.max(reach, Math.min(c[a * 2 + 1], face))
        : Math.min(reach, Math.max(c[a * 2], face));
  }
  return Math.abs(face - reach);
}

export function cameraInterior(
  id: string,
  boxes: readonly InteriorBox[],
  openings: readonly InteriorOpening[] = [],
  rounds: ReadonlyMap<number, InteriorRound> = new Map(),
  framing: CameraInterior['framing'] = 'adaptive',
): CameraInterior {
  const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const box of boxes) {
    for (let a = 0; a < 3; a++) {
      b[a * 2] = Math.min(b[a * 2], box[a * 2]);
      b[a * 2 + 1] = Math.max(b[a * 2 + 1], box[a * 2 + 1]);
    }
  }
  return {
    id,
    framing,
    boxes,
    rounds: boxes.map((_, i) => rounds.get(i) ?? null),
    openings,
    thresholds: openings.map((o) => openingThreshold(boxes, o)),
    bounds: [b[0], b[1], b[2], b[3], b[4], b[5]],
  };
}

/** Whether a point stands in piece `i`, `pad` yards clear of its faces. */
function inPiece(vol: CameraInterior, i: number, x: number, y: number, z: number, pad: number) {
  const b = vol.boxes[i];
  if (
    x < b[0] + pad ||
    x > b[1] - pad ||
    y < b[2] + pad ||
    y > b[3] - pad ||
    z < b[4] + pad ||
    z > b[5] - pad
  ) {
    return false;
  }
  const r = vol.rounds[i];
  if (!r) return true;
  const dx = x - r[0];
  const dz = z - r[1];
  const rr = r[2] - pad;
  return rr > 0 && dx * dx + dz * dz <= rr * rr;
}

/** Whether a point stands in the air, `pad` yards clear of every face. */
export function interiorContains(
  vol: CameraInterior,
  x: number,
  y: number,
  z: number,
  pad = 0,
): boolean {
  const u = vol.bounds;
  if (x < u[0] || x > u[1] || y < u[2] || y > u[3] || z < u[4] || z > u[5]) return false;
  for (let i = 0; i < vol.boxes.length; i++) if (inPiece(vol, i, x, y, z, pad)) return true;
  return false;
}

/**
 * Whether a player's eye at this point is indoors: in a box of the air that is not an
 * opening's (a body in the front doorway's thickness is still on the threshold: the camera
 * is left exactly as it is, and every blend in starts from nothing past the threshold).
 */
export function interiorHoldsEye(vol: CameraInterior, x: number, y: number, z: number): boolean {
  const u = vol.bounds;
  if (x < u[0] || x > u[1] || y < u[2] || y > u[3] || z < u[4] || z > u[5]) return false;
  for (let i = 0; i < vol.boxes.length; i++) {
    if (!inPiece(vol, i, x, y, z, 0)) continue;
    let opening = false;
    for (const o of vol.openings) if (o.box === i) opening = true;
    if (!opening) return true;
  }
  return false;
}

// the slab test's result for one box (module scratch: no allocation per call)
let slabEnter = 0;
let slabExit = 0;
let slabExitAxis = 0;
let slabExitSide = 1;

/** The exit axis a round piece's curved face reports (never an opening's). */
const ROUND_FACE = 3;

/** The segment's parameter interval inside one piece shrunk by `pad` (slab test, then the
 *  circle for a round piece), written to the scratch above; false when the line misses. */
function slabPiece(
  b: InteriorBox,
  round: InteriorRound | null,
  pad: number,
  ax: number,
  ay: number,
  az: number,
  dx: number,
  dy: number,
  dz: number,
): boolean {
  slabEnter = -Infinity;
  slabExit = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ax : axis === 1 ? ay : az;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = b[axis * 2] + pad;
    const hi = b[axis * 2 + 1] - pad;
    if (lo > hi) return false;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return false;
      continue;
    }
    const t0 = (lo - o) / d;
    const t1 = (hi - o) / d;
    const near = Math.min(t0, t1);
    const far = Math.max(t0, t1);
    if (near > slabEnter) slabEnter = near;
    if (far < slabExit) {
      slabExit = far;
      slabExitAxis = axis;
      slabExitSide = d > 0 ? 1 : -1;
    }
  }
  if (round && slabEnter <= slabExit) {
    const rr = round[2] - pad;
    if (rr <= 0) return false;
    const px = ax - round[0];
    const pz = az - round[1];
    const a = dx * dx + dz * dz;
    const c = px * px + pz * pz - rr * rr;
    if (a < 1e-12) return c <= 0 && slabEnter <= slabExit;
    const bh = px * dx + pz * dz;
    const disc = bh * bh - a * c;
    if (disc < 0) return false;
    const root = Math.sqrt(disc);
    const t0 = (-bh - root) / a;
    const t1 = (-bh + root) / a;
    if (t0 > slabEnter) slabEnter = t0;
    if (t1 < slabExit) {
      slabExit = t1;
      slabExitAxis = ROUND_FACE;
      slabExitSide = 1;
    }
  }
  return slabEnter <= slabExit;
}

/** Where the last walk left the air: the box (-1 when it never did, or never started in
 *  it) and that box's face; `open` when that face is an opening's onto the world. */
export const interiorExit = { box: -1, axis: 0, side: 1, open: false };

const EPS = 1e-6;

/** Whether the exit left in `interiorExit` is an opening's face onto the world. */
function exitIsOpening(vol: CameraInterior): boolean {
  const exit = interiorExit;
  if (exit.box < 0) return false;
  for (const o of vol.openings) {
    if (o.box === exit.box && o.axis === exit.axis && o.side === exit.side) return true;
  }
  return false;
}

/**
 * Walk the segment a to b through the air (every box shrunk by `pad`) and return the
 * fraction of it (0 to 1) at which it first leaves; 1 when it never does. A start inside a
 * box but within `pad` of its faces (a player's eye against a wall) may walk out of that
 * band into the box, never the other way. The exit is left in `interiorExit`. A segment that
 * leaves through an opening's face onto the world runs on past it by `through` (0 to 1) of
 * the rest: the whole of it at 1 (the camera may stand outside, seeing in through the
 * doorway), none at 0.
 */
export function interiorSegmentFraction(
  vol: CameraInterior,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  pad: number,
  through = 0,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  interiorExit.box = -1;
  interiorExit.open = false;
  let t = 0;
  // each pass moves on to the farthest exit among the boxes the walk stands in, so it ends
  // within one pass per box
  for (let pass = 0; pass <= vol.boxes.length; pass++) {
    let best = t;
    let bestBox = -1;
    let bestAxis = 0;
    let bestSide = 1;
    for (let i = 0; i < vol.boxes.length; i++) {
      if (!slabPiece(vol.boxes[i], vol.rounds[i], pad, ax, ay, az, dx, dy, dz)) continue;
      const entered =
        slabEnter <= t + EPS ||
        // the clearance band: the start stands in the raw piece, the shrunk one lies ahead
        (t === 0 && slabEnter > 0 && inPiece(vol, i, ax, ay, az, 0));
      if (entered && slabExit > best) {
        best = slabExit;
        bestBox = i;
        bestAxis = slabExitAxis;
        bestSide = slabExitSide;
      }
    }
    if (bestBox < 0) return t;
    interiorExit.box = bestBox;
    interiorExit.axis = bestAxis;
    interiorExit.side = bestSide;
    if (best >= 1 - EPS) return 1;
    if (exitIsOpening(vol)) {
      // out through the front door: the world outside, as far as `through` lets it run
      interiorExit.open = true;
      return best + Math.max(0, Math.min(1, through)) * (1 - best);
    }
    t = best;
  }
  return t;
}

/**
 * Whether a camera standing in the air sees the point (x, y, z) outside it: its sight line
 * leaves the air through an opening onto the world, not through a wall, floor or ceiling.
 */
export function interiorSeesOut(
  vol: CameraInterior,
  camX: number,
  camY: number,
  camZ: number,
  x: number,
  y: number,
  z: number,
): boolean {
  if (interiorSegmentFraction(vol, camX, camY, camZ, x, y, z, 0) >= 1) return true;
  return interiorExit.open;
}

/** The pad that keeps the whole near-plane rectangle clear of a face (not just its centre),
 *  plus a hand of slack. `fovDeg` is the vertical field of view. */
export function interiorCameraPadding(near: number, fovDeg: number, aspect: number): number {
  const h = Math.tan((fovDeg * Math.PI) / 360) * near;
  return Math.hypot(near, h, h * aspect) + 0.08;
}

// ---------------------------------------------------------------------------
// The boom's glide: both ways, never a snap
// ---------------------------------------------------------------------------

/** The drawn boom's length and its rate of change (yards, yards a second): the spring the
 *  clamp glides the camera on, with the allowed boom it last glided toward and how far that
 *  fell in the frame before (yards). */
export interface InteriorBoomSpring {
  dist: number;
  vel: number;
  target: number;
  drop: number;
}

/** The smooth time (seconds) of a pull-in: quick, so a lens drawn past a wall is back in the
 *  air within a few frames (the building's cutaway covers those frames, see
 *  interior_camera.ts), and short enough that a boom shrinking at a walk's pace lags it by
 *  less than the near-plane pad (the lens stays in the room), yet never a one-frame jump. */
export const INTERIOR_BOOM_PULL_IN_SEC = 0.04;
/** The smooth time (seconds) of a release: the camera drifts back out as the view clears. */
export const INTERIOR_BOOM_RELEASE_SEC = 0.25;
/** However far the allowed boom jumps in, the drawn one never lags more than this (yards)
 *  past it: a camera swung hard into a wall comes most of the way at once and glides the
 *  rest, so what shows beyond the wall is a sliver for a moment, not a view. */
export const INTERIOR_BOOM_MAX_LAG = 1.0;
/** A fall of the allowed boom this large (yards) in one frame, and three times the frame
 *  before's, is a jump (the ray swung past a corner or a doorway's edge): only a jump lets
 *  the glide lag past the near-plane pad. A boom that shrinks steadily, however fast (a turn
 *  toward a wall, a walk backward), is followed within the pad: the lens stays in the room. */
export const INTERIOR_BOOM_JUMP = 0.5;
/** After a jump the lag past the allowed boom shrinks at least this fast (yards a second),
 *  so the lens is back within the pad a few frames later (the shell's cutaway covers them). */
export const INTERIOR_BOOM_LAG_DECAY = 15;
/** The release's top speed (yards a second): a long clear view opens as a glide. */
export const INTERIOR_BOOM_RELEASE_MAX_SPEED = 40;

/**
 * Glide the drawn boom toward the `allowed` length this frame, critically damped (the
 * classic smooth-damp: no overshoot of a still target, no velocity jump when it starts),
 * with the quick pull-in time when the target lies inside the drawn boom and the gentle
 * release time when it lies outside. A pull-in lags the allowed boom by at most `pad` (the
 * lens stays in the room) unless the allowed boom jumped in (INTERIOR_BOOM_JUMP): then by at
 * most INTERIOR_BOOM_MAX_LAG, the lag shrinking at INTERIOR_BOOM_LAG_DECAY or faster. `immediate` adopts the allowed length outright (a teleport,
 * reduced motion). Writes the spring in place and returns the drawn length.
 */
export function stepInteriorBoom(
  s: InteriorBoomSpring,
  allowed: number,
  dt: number,
  immediate: boolean,
  pad = 0,
): number {
  const step = Math.max(0, dt);
  const drop = s.target - allowed;
  const jumped = drop > INTERIOR_BOOM_JUMP && drop > 3 * s.drop;
  const lagBefore = s.dist - s.target;
  s.target = allowed;
  s.drop = Math.max(0, drop);
  if (immediate || !Number.isFinite(s.dist)) {
    s.dist = allowed;
    s.vel = 0;
    return allowed;
  }
  const pullIn = allowed < s.dist;
  // a glide that turns about starts from rest: the pull-in's speed never carries into a
  // release (a dip under the target), nor a release's into a pull-in
  if (pullIn ? s.vel > 0 : s.vel < 0) s.vel = 0;
  const smooth = pullIn ? INTERIOR_BOOM_PULL_IN_SEC : INTERIOR_BOOM_RELEASE_SEC;
  const omega = 2 / smooth;
  const x = omega * step;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = s.dist - allowed;
  if (!pullIn) {
    // the release's top speed: the gap it may close is capped (a pull-in never is)
    const cap = INTERIOR_BOOM_RELEASE_MAX_SPEED * smooth;
    change = Math.max(-cap, Math.min(cap, change));
  }
  const target = s.dist - change;
  const temp = (s.vel + omega * change) * step;
  let vel = (s.vel - omega * temp) * decay;
  let dist = target + (change + temp) * decay;
  // never past a still target (the smooth-damp's own guard)
  if (allowed - s.dist > 0 === dist > allowed) {
    dist = allowed;
    vel = 0;
  }
  // a pull-in lags the wall by at most the pad; a jump may lag up to the cap, the lag then
  // only shrinking, at least at the decay rate, back within the pad
  const cap = jumped
    ? INTERIOR_BOOM_MAX_LAG
    : Math.max(pad, Math.min(INTERIOR_BOOM_MAX_LAG, lagBefore) - INTERIOR_BOOM_LAG_DECAY * step);
  if (dist > allowed + cap) {
    dist = allowed + cap;
    vel = Math.min(vel, 0);
  }
  s.dist = Math.max(0, dist);
  s.vel = vel;
  return s.dist;
}

// ---------------------------------------------------------------------------
// The threshold: the clamp blends in over the first yards inside a door
// ---------------------------------------------------------------------------

/** Over this many yards in past an opening's threshold a pull-in blends in, from none at the
 *  door to whole: walking in at an angle (a sight line cut by a jamb, not threading the
 *  door) the camera closes in over a few strides, never snapping in behind the head at the
 *  threshold. A camera behind a player walking in threads the doorway (interiorEntryCap) and
 *  needs no blend; a flattening under a lintel or a ceiling is never blended. */
export const INTERIOR_ENTRY_BLEND = 4;
/** Over this many yards in past an opening's threshold the entry cap comes in whole. */
export const INTERIOR_ENTRY_CAP_IN = 5;
/** Past the point where the requested lens has come in through the door (its horizontal
 *  distance behind the eye, and a yard) the entry cap lets go over this many yards. */
export const INTERIOR_ENTRY_CAP_RELAX = 4;
/** However slowly the player comes in (or if they stop on the threshold), the clamp is whole
 *  this long (seconds) after the eye stepped inside: the lens never lingers outside. */
export const INTERIOR_ENTRY_SETTLE_SEC = 0.8;

/** The clamp's engagement from the time since the eye stepped inside: 0 at once, rising
 *  smoothly (smoothstep) to 1 at INTERIOR_ENTRY_SETTLE_SEC. The driver takes the larger of
 *  this and interiorEntryWeight. */
export function interiorEntrySettle(sec: number): number {
  const t = Math.min(1, Math.max(0, sec / INTERIOR_ENTRY_SETTLE_SEC));
  return t * t * (3 - 2 * t);
}

/**
 * How engaged the clamp is for an eye at (x, y, z): 0 on an opening's threshold (its outside
 * face, past the doorway's thickness), rising smoothly (smoothstep) to 1 INTERIOR_ENTRY_BLEND
 * yards further in; 1 in an interior with no openings.
 */
export function interiorEntryWeight(vol: CameraInterior, x: number, y: number, z: number) {
  if (vol.openings.length === 0) return 1;
  nearestOpening(vol, x, y, z);
  const t = Math.min(1, interiorNearestOpening.depth / INTERIOR_ENTRY_BLEND);
  return t * t * (3 - 2 * t);
}

/** The nearest opening to an eye, written by interiorEntryCap, interiorEntryWeight and
 *  interiorOpeningDepth: its box's top (world y), the eye's depth past its threshold (0 on the
 *  threshold and out), that depth along the opening's own axis alone, and how far the eye
 *  stands out to the side of the doorway (across the axis, the height aside). */
export const interiorNearestOpening = {
  top: Infinity,
  depth: Infinity,
  axial: Infinity,
  lateral: Infinity,
  axis: 0,
  side: 1,
};

function nearestOpening(vol: CameraInterior, x: number, y: number, z: number): void {
  let nearest = Infinity;
  let top = Infinity;
  let sill = 0;
  let axisOut = 0;
  let sideOut = 1;
  let axial = 0;
  let lateral = 0;
  for (let i = 0; i < vol.openings.length; i++) {
    const o = vol.openings[i];
    const b = vol.boxes[o.box];
    let d2 = 0;
    let along = 0;
    let across2 = 0;
    for (let axis = 0; axis < 3; axis++) {
      const v = axis === 0 ? x : axis === 1 ? y : z;
      const lo = b[axis * 2];
      const hi = b[axis * 2 + 1];
      let d: number;
      // past the face, out in the world: no depth in at all
      if (axis === o.axis) {
        d = Math.max(0, o.side * ((o.side > 0 ? hi : lo) - v));
        along = d;
      } else {
        d = v < lo ? lo - v : v > hi ? v - hi : 0;
        if (axis !== 1) across2 += d * d;
      }
      d2 += d * d;
    }
    if (d2 < nearest) {
      nearest = d2;
      top = b[3];
      sill = vol.thresholds[i] ?? 0;
      axisOut = o.axis;
      sideOut = o.side;
      axial = along;
      lateral = Math.sqrt(across2);
    }
  }
  interiorNearestOpening.top = top;
  interiorNearestOpening.depth = Math.max(0, Math.sqrt(nearest) - sill);
  interiorNearestOpening.axial = Math.max(0, axial - sill);
  interiorNearestOpening.lateral = lateral;
  interiorNearestOpening.axis = axisOut;
  interiorNearestOpening.side = sideOut;
}

/** How deep past its nearest opening's threshold a point stands (0 on the threshold and out;
 *  Infinity in an interior with no openings). */
export function interiorOpeningDepth(vol: CameraInterior, x: number, y: number, z: number) {
  if (vol.openings.length === 0) return Infinity;
  nearestOpening(vol, x, y, z);
  return interiorNearestOpening.depth;
}

const smoothstep01 = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/** The entry cap bites whole on a boom that runs back toward the door within this angle of
 *  its axis (the cosine), fading to nothing by INTERIOR_ENTRY_CAP_ACROSS (a boom across the
 *  room or deeper into it is never capped): a wide, soft band, so an orbit never drops the
 *  lens in a frame. */
export const INTERIOR_ENTRY_CAP_TOWARD = 0.9;
export const INTERIOR_ENTRY_CAP_ACROSS = 0.45;
/** An eye this far out to the side of the doorway (yards) is past the cap's reach: the cap is
 *  for walking in through the door, not for the rest of the front of the room. */
export const INTERIOR_ENTRY_CAP_ASIDE = 3.5;

/**
 * The entry cap: how high over an eye at (x, y, z) the lens may stand along a requested boom
 * (dx, dy, dz), near a front door, when the boom runs back toward that door (the camera
 * behind a player walking in). Past the door's threshold the lens is held no higher than the
 * door's head (less the near-plane pad) over the eye, keeping its distance behind the player,
 * so the sight line threads the doorway while the lens is still outside and the lens only
 * ever comes down on the way in (a smooth fall over INTERIOR_ENTRY_CAP_IN yards from nothing
 * on the threshold); once the requested lens has come in through the door the cap lets go
 * over INTERIOR_ENTRY_CAP_RELAX yards. A boom across the room or deeper into it, and an eye
 * well out to the side of the doorway, are never capped. Returns the capped rise (dy
 * unchanged when nothing caps it, or when the boom looks up), and leaves the cap's weight and
 * the rise it caps to in `interiorEntryHold` (the driver walks the weight in and out, and
 * holds it only for a player who walked in).
 */
export function interiorEntryCap(
  vol: CameraInterior,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  pad: number,
): number {
  interiorEntryHold.value = 0;
  interiorEntryHold.weight = 0;
  interiorEntryHold.rise = Infinity;
  if (vol.openings.length === 0) return dy;
  nearestOpening(vol, x, y, z);
  const { top, axial, lateral } = interiorNearestOpening;
  const behind = Math.hypot(dx, dz);
  // the requested lens has come in through the door: the cap, and the through-door hold,
  // let go
  const hold = 1 - smoothstep01((axial - behind - 1) / INTERIOR_ENTRY_CAP_RELAX);
  interiorEntryHold.value = hold;
  const rise = Math.max(0.2, top - pad - y);
  interiorEntryHold.rise = rise;
  const o = interiorNearestOpening;
  const toward = o.side * (o.axis === 0 ? dx : o.axis === 1 ? dy : dz);
  const cos = behind > 1e-9 ? toward / behind : 0;
  const e =
    smoothstep01(
      (cos - INTERIOR_ENTRY_CAP_ACROSS) / (INTERIOR_ENTRY_CAP_TOWARD - INTERIOR_ENTRY_CAP_ACROSS),
    ) *
    smoothstep01(axial / INTERIOR_ENTRY_CAP_IN) *
    (1 - smoothstep01(lateral / INTERIOR_ENTRY_CAP_ASIDE)) *
    hold;
  interiorEntryHold.weight = e;
  if (dy <= rise) return dy;
  return dy - e * (dy - rise);
}

/** The last interiorEntryCap's hold (1 while the requested lens may still be out beyond the
 *  door, easing to 0 once it has come in: the driver scales the through-door hold by it, so
 *  deep in a room a ray is never let out through the door), the cap's weight and the rise it
 *  caps to. */
export const interiorEntryHold = { value: 0, weight: 0, rise: Infinity };

/** How fast (1/s) the driver walks the entry cap's weight toward its target. */
export const INTERIOR_ENTRY_CAP_RATE = 8;
/** Over this many yards past a threshold a lagged look point hands the boom's start back from
 *  the eye to itself (a smooth hand-over, never a one-frame shift). */
export const INTERIOR_LOOK_BLEND = 1.2;

/** Whether the segment a to b touches the air anywhere (a body outside seen past the
 *  building rather than across it). */
export function interiorSegmentTouches(
  vol: CameraInterior,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  for (let i = 0; i < vol.boxes.length; i++) {
    if (!slabPiece(vol.boxes[i], vol.rounds[i], 0, ax, ay, az, dx, dy, dz)) continue;
    if (slabEnter <= 1 && slabExit >= 0) return true;
  }
  return false;
}

/** How long (seconds) the lens may stay outside a door once the player has stopped just
 *  inside it, before it comes in to the room (the through-door hold eases out). */
export const INTERIOR_THROUGH_HOLD_SEC = 1.0;
/** However the player walks, the lens has come in from outside this long (seconds) after the
 *  eye stepped in (a slow walk in, a camera turned to the door from deep in the room). */
export const INTERIOR_THROUGH_MAX_SEC = 4;
/** An eye first held deeper than this past a threshold (yards) did not walk in through the
 *  door (a teleport, a login inside): the lens is never held outside for it. */
export const INTERIOR_THROUGH_WALK_IN_DEPTH = 1.5;

/** Longest a release after walking out may take (seconds): then the camera is free. */
export const INTERIOR_RELEASE_MAX_SEC = 1.5;

// ---------------------------------------------------------------------------
// Framing a cramped spot: slide under a low ceiling, lift over a wall, or swing round it
// ---------------------------------------------------------------------------

/** A boom shorter than this (yards) is cramped (a player backed against a round tower's
 *  wall, or into a small room's corner): the drawn camera looks for a better
 *  framing nearby, over or round what cramps it, rather than sitting in the player's head. */
export const INTERIOR_COMFORT_BOOM = 3.5;
/** The camera never lifts past this elevation: it looks down on the player, never straight
 *  down. */
export const INTERIOR_LIFT_MAX_PITCH = 1.2;
/** Under a low ceiling (a low room, the top of a hall's air) the camera flattens its
 *  elevation to keep its distance, never below this (it still looks a touch down). */
export const INTERIOR_DROP_MIN_PITCH = 0.05;
/** The flattenings tried under a ceiling, least first (radians of elevation taken off). */
export const INTERIOR_DROPS: readonly number[] = [0.1, 0.2, 0.3, 0.45, 0.6];
/** A flattening is taken only for a boom this much longer (yards), so a small gain never
 *  turns the view. */
const DROP_GAIN = 1;
/** How fast a framing (lift and swing) glides in and settles back (1/s). */
export const INTERIOR_LIFT_RATE = 5;
/** How fast (radians a second) the camera may flatten when the geometry asks for more: fast
 *  enough that a walk in under a lintel never lags it (the lens never pulls in behind the
 *  head for want of a flattening), never a one-frame jump. Giving the flattening back is the
 *  gentle framing glide. */
export const INTERIOR_FLATTEN_RATE = 6;
/** However far the boom, a flattening sweeps the lens no faster than this (yards a second). */
export const INTERIOR_FLATTEN_MAX_SPEED = 24;
/** The bisection steps of the least flattening (radians: the elevation span / 2^steps). */
const FLATTEN_STEPS = 12;
/** However far a framing turns the camera, the lens sweeps no faster than this (yards a
 *  second) round the look point: a long boom turns slowly, a short one quickly. */
export const INTERIOR_FRAMING_MAX_SPEED = 10;

/** A framing tried for a cramped boom: `lift` radians more elevation, `swing` radians of
 *  yaw round the look point (either side). */
export interface InteriorFraming {
  lift: number;
  swing: number;
}

/** The framings tried for a cramped boom, least departure from the requested view first: a
 *  lift or a flattening alone (the camera rises over what cramps it, or slides under it, the
 *  heading kept), then a swing along the wall, alone or with either. The first to give a
 *  comfortable boom wins, else the longest. A negative lift flattens. */
export const INTERIOR_FRAMINGS: readonly InteriorFraming[] = [
  { lift: 0.3, swing: 0 },
  { lift: -0.3, swing: 0 },
  { lift: 0.6, swing: 0 },
  { lift: 0.9, swing: 0 },
  { lift: 1.2, swing: 0 },
  { lift: 0, swing: 0.5 },
  { lift: 0.3, swing: 0.5 },
  { lift: -0.3, swing: 0.5 },
  { lift: 0, swing: 1.0 },
  { lift: 0.4, swing: 1.0 },
  { lift: -0.3, swing: 1.0 },
  { lift: 0, swing: 1.5 },
  { lift: 0.4, swing: 1.5 },
  { lift: -0.3, swing: 1.5 },
];

/** The boom (dx, dy, dz) swung `swing` radians round the vertical, then turned `lift` radians
 *  further up toward the vertical (never past INTERIOR_LIFT_MAX_PITCH), or for a negative
 *  lift flattened toward the level (never under INTERIOR_DROP_MIN_PITCH, never raised), its
 *  length kept, written to `out`. */
export function frameBoomInto<T extends { x: number; y: number; z: number }>(
  out: T,
  dx: number,
  dy: number,
  dz: number,
  lift: number,
  swing = 0,
): T {
  if (swing !== 0) {
    const c = Math.cos(swing);
    const sn = Math.sin(swing);
    const rx = dx * c - dz * sn;
    dz = dx * sn + dz * c;
    dx = rx;
  }
  const h = Math.hypot(dx, dz);
  const len = Math.hypot(h, dy);
  const e0 = Math.atan2(dy, h);
  const e =
    lift >= 0
      ? Math.max(e0, Math.min(e0 + lift, INTERIOR_LIFT_MAX_PITCH))
      : Math.min(e0, Math.max(e0 + lift, INTERIOR_DROP_MIN_PITCH));
  if (lift === 0 || len < 1e-9 || h < 1e-9 || e === e0) {
    out.x = dx;
    out.y = dy;
    out.z = dz;
    return out;
  }
  const ch = Math.cos(e) * len;
  out.x = (dx / h) * ch;
  out.y = Math.sin(e) * len;
  out.z = (dz / h) * ch;
  return out;
}

/** A framing value this frame, eased toward `target` (adopted outright when `immediate`), its
 *  turn capped so a lens `boom` yards out sweeps no faster than INTERIOR_FRAMING_MAX_SPEED. */
export function stepInteriorFraming(
  previous: number,
  target: number,
  dt: number,
  immediate: boolean,
  boom = 0,
): number {
  if (immediate) return target;
  const step = Math.max(0, dt);
  const eased = (target - previous) * (1 - Math.exp(-INTERIOR_LIFT_RATE * step));
  const most = (INTERIOR_FRAMING_MAX_SPEED / Math.max(1, boom)) * step;
  return previous + Math.max(-most, Math.min(most, eased));
}

const frameScratch = { x: 0, y: 0, z: 0 };

/** A framing's lift this frame: a flattening that must grow (a negative target under the
 *  current lift) follows at INTERIOR_FLATTEN_RATE, so the ray keeps clear of the lintel or
 *  ceiling that asked for it; anything else (a lift over a cramped spot, a flattening given
 *  back) takes the gentle framing glide (stepInteriorFraming). */
export function stepInteriorLift(
  previous: number,
  target: number,
  dt: number,
  immediate: boolean,
  boom = 0,
): number {
  if (immediate) return target;
  if (target < previous && target < 0) {
    const rate = Math.min(INTERIOR_FLATTEN_RATE, INTERIOR_FLATTEN_MAX_SPEED / Math.max(1, boom));
    return Math.max(target, previous - rate * Math.max(0, dt));
  }
  return stepInteriorFraming(previous, target, dt, false, boom);
}

/** The framing chosen for a cramped boom, written by chooseInteriorFraming: its lift and
 *  swing, the boom it allows, and whether it is a flattening the geometry asks for (a lintel,
 *  a ceiling), which the driver applies whole, never blended by the threshold. */
export const interiorFramingChoice = { lift: 0, swing: 0, boom: 0, flatten: false };

/** The boom along a framing of (dx, dy, dz) from (sx, sy, sz) inside `vol`: the chooser's
 *  probe. */
function boomAlong(
  vol: CameraInterior,
  sx: number,
  sy: number,
  sz: number,
  dx: number,
  dy: number,
  dz: number,
  len: number,
  pad: number,
  through: number,
  lift: number,
  swing: number,
): number {
  const d = frameBoomInto(frameScratch, dx, dy, dz, lift, swing);
  return len * interiorSegmentFraction(vol, sx, sy, sz, sx + d.x, sy + d.y, sz + d.z, pad, through);
}

/**
 * Choose how to frame a boom from (sx, sy, sz) along (dx, dy, dz) inside `vol` (a ray out
 * through an opening runs on past it by `through`, interiorSegmentFraction's). A ray stopped
 * by a wall, a lintel or a ceiling first tries the least flattening that clears it (bisected,
 * so it follows the player's walk smoothly); failing that, under a low ceiling, the flattening
 * of INTERIOR_DROPS that gives the longest boom, taken only for a real gain: the camera
 * slides under rather than pulling in. Then none when that boom is comfortable (or the
 * requested one is shorter than comfort anyway), else the first framing of INTERIOR_FRAMINGS
 * that gives a comfortable boom, trying first the side the camera already swings to (`side`,
 * so it never flips about a corner), else the longest. Written to interiorFramingChoice.
 */
export function chooseInteriorFraming(
  vol: CameraInterior,
  sx: number,
  sy: number,
  sz: number,
  dx: number,
  dy: number,
  dz: number,
  pad: number,
  side: number,
  through = 0,
): typeof interiorFramingChoice {
  const out = interiorFramingChoice;
  const len = Math.hypot(dx, dy, dz);
  out.lift = 0;
  out.swing = 0;
  out.flatten = false;
  const full = len - 1e-6;
  out.boom = boomAlong(vol, sx, sy, sz, dx, dy, dz, len, pad, through, 0, 0);
  // A stable room changes distance, not the player's chosen heading/elevation. The
  // temporary through-door hold may flatten to clear the lintel while walking in.
  if (vol.framing === 'preserve-angle' && through <= 0) return out;
  if (out.boom < full) {
    const ceiling = interiorExit.axis === 1 && interiorExit.side === 1;
    const raw = out.boom;
    const most = Math.atan2(dy, Math.hypot(dx, dz)) - INTERIOR_DROP_MIN_PITCH;
    const flattest =
      most > 1e-4 ? boomAlong(vol, sx, sy, sz, dx, dy, dz, len, pad, through, -most, 0) : 0;
    if (most > 1e-4 && flattest >= full) {
      // the least flattening that keeps the whole distance
      let lo = 0;
      let hi = most;
      for (let k = 0; k < FLATTEN_STEPS; k++) {
        const mid = (lo + hi) / 2;
        if (boomAlong(vol, sx, sy, sz, dx, dy, dz, len, pad, through, -mid, 0) >= full) hi = mid;
        else lo = mid;
      }
      out.lift = -hi;
      out.boom = boomAlong(vol, sx, sy, sz, dx, dy, dz, len, pad, through, -hi, 0);
      out.flatten = true;
    } else if (ceiling) {
      for (const drop of INTERIOR_DROPS) {
        const d = frameBoomInto(frameScratch, dx, dy, dz, -drop, 0);
        if (d.x === dx && d.y === dy && d.z === dz) break; // already as flat as it goes
        const boom = boomAlong(vol, sx, sy, sz, dx, dy, dz, len, pad, through, -drop, 0);
        // a partial flattening is for a ceiling: never one that leaves through the door
        if (interiorExit.open) continue;
        if (boom > out.boom + 0.05 && boom >= raw + DROP_GAIN) {
          out.lift = -drop;
          out.boom = boom;
          out.flatten = true;
        }
        if (boom >= len - 0.05) break;
      }
    }
  }
  if (
    vol.framing === 'preserve-angle' ||
    out.boom >= INTERIOR_COMFORT_BOOM - 1e-9 ||
    len <= INTERIOR_COMFORT_BOOM
  )
    return out;
  const first = side < 0 ? -1 : 1;
  let best = out.boom;
  for (const f of INTERIOR_FRAMINGS) {
    for (let k = 0; k < (f.swing === 0 ? 1 : 2); k++) {
      const sign = k === 0 ? first : -first;
      const boom = boomAlong(
        vol,
        sx,
        sy,
        sz,
        dx,
        dy,
        dz,
        len,
        pad,
        through,
        f.lift,
        f.swing * sign,
      );
      if (boom > best + 0.05) {
        best = boom;
        out.lift = f.lift;
        out.swing = f.swing * sign;
        out.boom = boom;
        out.flatten = false;
      }
      if (boom >= INTERIOR_COMFORT_BOOM) {
        out.lift = f.lift;
        out.swing = f.swing * sign;
        out.boom = boom;
        out.flatten = false;
        return out;
      }
    }
  }
  return out;
}
