// Pure core of the Arc Bolt stepped-leader lightning (the Shaman's
// lightning_bolt): the path a real lightning leader carves, its forked
// branches, the return-stroke / restrike / afterglow envelope at impact, and
// the light envelope that rides it. Three-, DOM- and i18n-free; every random
// draw comes from an injected source, so a test drives it deterministically.
// The Three-side owner is stepped_leader.ts, which draws these points as
// ribbons strips and moves a tracked point light.
//
// The read it models: a dim, branching leader jerks forward in discrete steps
// toward the target, keeping every kink it has already carved; the moment it
// connects, a blinding return stroke lights the whole path and its branches,
// restrikes once, and leaves a fading violet afterglow. Cosmetic only: the
// projectile it follows and the hit it lands on are unchanged.

/** One leader step every 50 ms, the visible "jerk" of a stepped leader. */
export const LEADER_STEP_S = 0.05;
/** Kinks carved per step between the old tip and the head sample. */
export const LEADER_KINKS_PER_STEP = 2;
/** Lateral kink size relative to the vertical one (see stepLeader). */
export const LATERAL_SHARE = 0.6;
/** Point capacity of the main channel: three points per step (two kinks plus
 * the head sample) over the projectile's whole 3 s ttl (60 steps), so even a
 * bolt homing on a fleeing target never runs out; a full path only slides
 * its last point. */
export const LEADER_MAX_PTS = 192;
/** Branch cap per bolt and the points each forked tendril carries. */
export const LEADER_MAX_BRANCHES = 8;
export const BRANCH_PTS = 6;
/** Chance a step forks a new branch off the old tip. */
export const BRANCH_CHANCE = 0.5;
/** Return stroke at impact, the restrike window, and the afterglow's end. */
export const RETURN_STROKE_S = 0.07;
export const RESTRIKE_AT_S = 0.12;
export const RESTRIKE_END_S = 0.17;
export const RESTRIKE_GAIN = 0.8;
export const AFTERGLOW_END_S = 0.6;

export type Rand = () => number;

export interface LeaderPath {
  /** Packed x, y, z per point. */
  xyz: Float32Array;
  count: number;
}

export function createLeaderPath(capacity: number): LeaderPath {
  return { xyz: new Float32Array(capacity * 3), count: 0 };
}

export function leaderCapacity(path: LeaderPath): number {
  return path.xyz.length / 3;
}

export function resetLeaderPath(path: LeaderPath, x: number, y: number, z: number): void {
  path.xyz[0] = x;
  path.xyz[1] = y;
  path.xyz[2] = z;
  path.count = 1;
}

/** Re-pin the root to the caster's hand, so the channel stays attached while
 * the caster's animation moves the hand. */
export function setLeaderOrigin(path: LeaderPath, x: number, y: number, z: number): void {
  if (path.count === 0) {
    resetLeaderPath(path, x, y, z);
    return;
  }
  path.xyz[0] = x;
  path.xyz[1] = y;
  path.xyz[2] = z;
}

function push(path: LeaderPath, x: number, y: number, z: number): void {
  const i = path.count * 3;
  path.xyz[i] = x;
  path.xyz[i + 1] = y;
  path.xyz[i + 2] = z;
  path.count++;
}

function setLast(path: LeaderPath, x: number, y: number, z: number): void {
  const i = (path.count - 1) * 3;
  path.xyz[i] = x;
  path.xyz[i + 1] = y;
  path.xyz[i + 2] = z;
}

export interface Basis {
  dx: number;
  dy: number;
  dz: number;
  sx: number;
  sy: number;
  sz: number;
  ux: number;
  uy: number;
  uz: number;
}

/** Unit travel direction plus two unit perpendiculars (side, up-ish) for a
 * segment. A near-vertical segment falls back to the world x axis for its side,
 * so the frame never degenerates. Writes into `out`; returns false for a
 * zero-length segment. */
export function segmentBasis(dx: number, dy: number, dz: number, out: Basis): boolean {
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return false;
  const fx = dx / len;
  const fy = dy / len;
  const fz = dz / len;
  // side = dir x worldUp (0,1,0) = (-fz, 0, fx)
  let sx = -fz;
  let sy = 0;
  let sz = fx;
  let sl = Math.hypot(sx, sy, sz);
  if (sl < 1e-4) {
    // travel is vertical: side = dir x worldX (1,0,0) = (0, fz, -fy)
    sx = 0;
    sy = fz;
    sz = -fy;
    sl = Math.hypot(sx, sy, sz);
  }
  sx /= sl;
  sy /= sl;
  sz /= sl;
  out.dx = fx;
  out.dy = fy;
  out.dz = fz;
  out.sx = sx;
  out.sy = sy;
  out.sz = sz;
  // up = side x dir
  out.ux = sy * fz - sz * fy;
  out.uy = sz * fx - sx * fz;
  out.uz = sx * fy - sy * fx;
  return true;
}

const stepBasis: Basis = { dx: 0, dy: 0, dz: 0, sx: 0, sy: 0, sz: 0, ux: 0, uy: 0, uz: 0 };

/**
 * Carve one leader step from the current tip to the live head (hx, hy, hz):
 * LEADER_KINKS_PER_STEP kinks that wander off the straight line (lateral and
 * vertical, scaled by the step length times `jag`), then the exact head
 * sample, so the channel always ends ON the flying head. Every earlier point
 * is kept, which is what makes the leader read as carved rather than
 * re-rolled. When the path is full the head simply slides the last point (no
 * new kinks). Returns true when a new step was carved.
 */
export function stepLeader(
  path: LeaderPath,
  hx: number,
  hy: number,
  hz: number,
  jag: number,
  rand: Rand,
): boolean {
  if (path.count === 0) {
    resetLeaderPath(path, hx, hy, hz);
    return false;
  }
  const li = (path.count - 1) * 3;
  const lx = path.xyz[li];
  const ly = path.xyz[li + 1];
  const lz = path.xyz[li + 2];
  const dx = hx - lx;
  const dy = hy - ly;
  const dz = hz - lz;
  if (!segmentBasis(dx, dy, dz, stepBasis)) return false;
  if (path.count + LEADER_KINKS_PER_STEP + 1 > leaderCapacity(path)) {
    setLast(path, hx, hy, hz);
    return false;
  }
  const len = Math.hypot(dx, dy, dz);
  for (let k = 0; k < LEADER_KINKS_PER_STEP; k++) {
    // kinks march forward in order, each in its own slice of the step
    const along = (k + 0.25 + rand() * 0.5) / LEADER_KINKS_PER_STEP;
    // Vertical kinks read from every camera; a lateral kink seen side-on runs
    // toward the eye, where a camera-facing strip has no width to show, so
    // lateral stays the smaller share.
    const lat = (rand() * 2 - 1) * len * jag * LATERAL_SHARE;
    const vert = (rand() * 2 - 1) * len * jag;
    push(
      path,
      lx + dx * along + stepBasis.sx * lat + stepBasis.ux * vert,
      ly + dy * along + stepBasis.sy * lat + stepBasis.uy * vert,
      lz + dz * along + stepBasis.sz * lat + stepBasis.uz * vert,
    );
  }
  push(path, hx, hy, hz);
  return true;
}

/** Slide the channel's last point onto the live head between steps, so the
 * leader never lags behind its own tip. */
export function followHead(path: LeaderPath, hx: number, hy: number, hz: number): void {
  if (path.count < 2) {
    if (path.count === 0) resetLeaderPath(path, hx, hy, hz);
    else push(path, hx, hy, hz);
    return;
  }
  setLast(path, hx, hy, hz);
}

const branchBasis: Basis = { dx: 0, dy: 0, dz: 0, sx: 0, sy: 0, sz: 0, ux: 0, uy: 0, uz: 0 };

/**
 * Fill `out` with a short forked tendril that starts at (bx, by, bz), angled
 * off the travel direction (dx, dy, dz) to one side and drooping slightly, of
 * total length `length`. The tendril jags harder than the main channel, like a
 * real leader's failed side branches.
 */
export function planBranch(
  out: LeaderPath,
  bx: number,
  by: number,
  bz: number,
  dx: number,
  dy: number,
  dz: number,
  length: number,
  rand: Rand,
): void {
  resetLeaderPath(out, bx, by, bz);
  if (!segmentBasis(dx, dy, dz, branchBasis)) return;
  const side = rand() < 0.5 ? -1 : 1;
  const spread = 0.55 + rand() * 0.6; // radians-ish off the main heading
  const droop = 0.15 + rand() * 0.35;
  // heading = travel rotated toward one side, tipped down a little
  let hx = branchBasis.dx + branchBasis.sx * side * spread - branchBasis.ux * droop;
  let hy = branchBasis.dy + branchBasis.sy * side * spread - branchBasis.uy * droop;
  let hz = branchBasis.dz + branchBasis.sz * side * spread - branchBasis.uz * droop;
  const hl = Math.hypot(hx, hy, hz) || 1;
  hx /= hl;
  hy /= hl;
  hz /= hl;
  const n = Math.min(BRANCH_PTS, leaderCapacity(out));
  const seg = length / (n - 1);
  let x = bx;
  let y = by;
  let z = bz;
  for (let i = 1; i < n; i++) {
    const lat = (rand() * 2 - 1) * seg * 0.55;
    const vert = (rand() * 2 - 1) * seg * 0.35;
    x += hx * seg + branchBasis.sx * lat + branchBasis.ux * vert;
    y += hy * seg + branchBasis.sy * lat + branchBasis.uy * vert;
    z += hz * seg + branchBasis.sz * lat + branchBasis.uz * vert;
    push(out, x, y, z);
  }
}

/** Point i of a path, read into a caller-owned vector-like. */
export function leaderPoint(
  path: LeaderPath,
  i: number,
  out: { x: number; y: number; z: number },
): void {
  const k = i * 3;
  out.x = path.xyz[k];
  out.y = path.xyz[k + 1];
  out.z = path.xyz[k + 2];
}

export interface StrokeEnvelope {
  /** 0..1 brightness of the return stroke or restrike (0 between strokes). */
  stroke: number;
  /** 0..1 strength of the violet afterglow (drawn only while stroke is 0). */
  afterglow: number;
  /** True once the whole impact sequence has ended. */
  done: boolean;
}

/**
 * The impact sequence `since` seconds after the leader connects: the return
 * stroke, a dark gap, one restrike (skipped when `restrike` is false, the
 * reduced-motion and degraded arm, so nothing flashes twice), then a linear
 * afterglow fade. Writes into `out`.
 */
export function strokeEnvelopeAt(
  since: number,
  restrike: boolean,
  out: StrokeEnvelope,
): StrokeEnvelope {
  let stroke = 0;
  if (since >= 0 && since < RETURN_STROKE_S) stroke = 1;
  else if (restrike && since >= RESTRIKE_AT_S && since < RESTRIKE_END_S) stroke = RESTRIKE_GAIN;
  out.stroke = stroke;
  out.afterglow = since < 0 || since >= AFTERGLOW_END_S ? 0 : 1 - since / AFTERGLOW_END_S;
  out.done = since >= AFTERGLOW_END_S;
  return out;
}

/** Light gain over the impact sequence: full at the stroke, the restrike's
 * gain at the restrike, and a quadratic afterglow tail starting at a quarter.
 * 0 once the sequence is done. */
export function strokeLightGain(since: number, restrike: boolean): number {
  if (since < 0 || since >= AFTERGLOW_END_S) return 0;
  if (since < RETURN_STROKE_S) return 1;
  if (restrike && since >= RESTRIKE_AT_S && since < RESTRIKE_END_S) return RESTRIKE_GAIN;
  const k = 1 - since / AFTERGLOW_END_S;
  return 0.25 * k * k;
}

/**
 * Where the impact light stands: `standoff` yards back from the path's end
 * along the channel's final heading (end minus the point a few steps back, so
 * one sharp kink cannot swing it), lifted by `lift`. A light AT the impact
 * point sits inside the struck mesh, which lights the ground but not the
 * target's facing side. Falls back to the end point on a degenerate path.
 */
export function strokeLightPosition(
  path: LeaderPath,
  standoff: number,
  lift: number,
  out: { x: number; y: number; z: number },
): void {
  if (path.count === 0) {
    out.x = 0;
    out.y = lift;
    out.z = 0;
    return;
  }
  const e = (path.count - 1) * 3;
  const b = Math.max(0, path.count - 1 - (LEADER_KINKS_PER_STEP + 1) * 2) * 3;
  const ex = path.xyz[e];
  const ey = path.xyz[e + 1];
  const ez = path.xyz[e + 2];
  let dx = path.xyz[b] - ex;
  let dy = path.xyz[b + 1] - ey;
  let dz = path.xyz[b + 2] - ez;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) {
    dx = 0;
    dy = 0;
    dz = 0;
  } else {
    const k = Math.min(standoff, len) / len;
    dx *= k;
    dy *= k;
    dz *= k;
  }
  out.x = ex + dx;
  out.y = ey + dy + lift;
  out.z = ez + dz;
}

/** Light gain while the leader is in flight: a steady base with a flicker the
 * caller supplies (0..1), so the ground under the leader crackles. */
export function flightLightGain(flicker01: number): number {
  const f = Math.min(1, Math.max(0, flicker01));
  return 0.7 + 0.3 * f;
}

export interface ArcBoltLeaderPlan {
  /** Width and light scale (the overload echo draws smaller). */
  scale: number;
  /** Forked side branches (dropped on the degraded tier). */
  branches: boolean;
  /** The second flash at impact (dropped on the degraded tier and for the
   * overload echo; the painter also drops it under reduced motion, so nothing
   * strobes for a player who asked for less motion). */
  restrike: boolean;
  /** The wide violet plasma layer (shed at low VFX quality). */
  aura: boolean;
}

/** VFX quality (the render budget's 0..1 level) below which the leader sheds
 * its branches, and below which it also sheds the plasma aura. */
export const LEADER_BRANCH_QUALITY = 0.5;
export const LEADER_AURA_QUALITY = 0.3;

/**
 * What an Arc Bolt draws on a given ability-VFX budget tier and VFX quality:
 * tier 0 the full leader, tier 1 the leader without branches or restrike,
 * tier 2 (the spam floor) nothing, which keeps the legacy color-only
 * projectile. Falling quality sheds branches, then the plasma aura. The Arc
 * Overload echo is the same bolt drawn smaller. Cosmetic only: the strike's
 * timing and the hit it marks are identical on every arm.
 */
export function arcBoltLeaderPlan(
  tier: number,
  overload: boolean,
  quality = 1,
): ArcBoltLeaderPlan | null {
  if (tier >= 2) return null;
  const full = tier === 0;
  return {
    scale: overload ? 0.7 : 1,
    branches: full && quality >= LEADER_BRANCH_QUALITY,
    restrike: full && !overload,
    aura: quality >= LEADER_AURA_QUALITY,
  };
}
