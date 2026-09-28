// Thrown-body physics on closed-form motion segments. A segment carries its
// start and end tick (fractional) and a position at any fractional tick, so a
// host samples it at any frame rate and the owning state changes only at
// transitions. Contacts are found once, when a segment is planned, through an
// injected probe. Pure: no world reads, no rng, no clock.

import { DT, type Vec3 } from '../types';

export interface SweepResult {
  x: number;
  z: number;
  blocked: boolean;
}

export interface ThrowProbe {
  ground(x: number, z: number): number;
  /** Water surface height at (x, z), or null where there is no water. */
  water(x: number, z: number): number | null;
  /**
   * Swept horizontal move of a body of `radius` whose feet are at `fromY` and `toY`
   * at the two ends (a body flying high clears knee-high colliders). Returns where
   * the move stopped or slid to. Bound to a resolveMovement-like resolver,
   * `blocked` is "the resolved point differs from the target"; a resolver that
   * stops at the last good point (a fence, a sealed border) reads as a surface
   * facing straight back along the move, and the body reverses off it.
   */
  sweep?(
    fx: number,
    fz: number,
    tx: number,
    tz: number,
    radius: number,
    fromY: number,
    toY: number,
  ): SweepResult;
}

export interface ThrowPhysics {
  readonly gravity: number;
  readonly bounceMinSpeed: number;
  readonly restitution: number;
  readonly bounceKeep: number;
  readonly wallRestitution: number;
  readonly skidDecel: number;
  readonly skidStopSpeed: number;
  readonly deepWater: number;
  readonly maxFlightTicks: number;
  readonly maxSkidTicks: number;
  readonly substeps: number;
  readonly stepRise: number;
}

/** Every segment carries `y`, the height it falls back to where the ground reads non-finite. */
export interface MarchSegment {
  kind: 'march';
  start: number;
  end: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
}

/** 'void' means no contact was found within the search bound. */
export type FlyContact = 'ground' | 'water' | 'wall' | 'void';

export interface FlySegment {
  kind: 'fly';
  start: number;
  end: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
  contact: FlyContact;
  /** Outward surface normal at a 'wall' contact, zero otherwise. */
  nx: number;
  nz: number;
}

export type SkidContact = 'stop' | 'wall' | 'water';

export interface SkidSegment {
  kind: 'skid';
  start: number;
  end: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  decel: number;
  contact: SkidContact;
}

export interface StillSegment {
  kind: 'still';
  start: number;
  end: number;
  x: number;
  y: number;
  z: number;
}

export type MotionSegment = MarchSegment | FlySegment | SkidSegment | StillSegment;

export type FlightOutcome =
  | { kind: 'bounce'; x: number; y: number; z: number; speed: number; seg: FlySegment }
  | { kind: 'wall'; x: number; y: number; z: number; speed: number; seg: FlySegment }
  | { kind: 'land'; x: number; y: number; z: number; skid: SkidSegment | null }
  | { kind: 'splash'; x: number; y: number; z: number }
  | { kind: 'void'; x: number; y: number; z: number };

type GroundProbe = Pick<ThrowProbe, 'ground'>;

const REFINE_STEPS = 12;
const EPS = 1e-9;
const GRADIENT_STEP = 0.05;

/** Blast falloff: 1 inside the core, linear to 0 at the rim, 0 outside (and for NaN). */
export function blastFalloff(distance: number, radius: number, core: number): number {
  if (!(distance < radius)) return 0;
  if (distance <= core) return 1;
  return 1 - (distance - core) / (radius - core);
}

/** Unit horizontal direction from the blast to the body; outward from the center when dead-center. */
export function throwDirection(
  blastX: number,
  blastZ: number,
  bodyX: number,
  bodyZ: number,
  centerX: number,
  centerZ: number,
  deadCenter: number,
): { x: number; z: number } {
  let dx = bodyX - blastX;
  let dz = bodyZ - blastZ;
  let len = Math.hypot(dx, dz);
  if (!(len >= deadCenter)) {
    dx = bodyX - centerX;
    dz = bodyZ - centerZ;
    len = Math.hypot(dx, dz);
    if (!(len > EPS)) return { x: 0, z: 1 };
  }
  return { x: dx / len, z: dz / len };
}

export function rotateDir(x: number, z: number, angle: number): { x: number; z: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c + z * s, z: z * c - x * s };
}

export function launchVelocity(
  falloff: number,
  mass: number,
  dirX: number,
  dirZ: number,
  push: number,
  pop: number,
): Vec3 {
  const k = falloff / Math.sqrt(mass);
  return { x: dirX * push * k, y: pop * k, z: dirZ * push * k };
}

/** The probe's ground height, or `fallback` where the probe reads non-finite. */
export function groundOr(probe: GroundProbe, x: number, z: number, fallback: number): number {
  const g = probe.ground(x, z);
  return Number.isFinite(g) ? g : fallback;
}

/** The water surface at (x, z), or `fallback` where there is none. */
export function waterSurfaceOr(probe: ThrowProbe, x: number, z: number, fallback: number): number {
  const w = probe.water(x, z);
  return w !== null && Number.isFinite(w) ? w : fallback;
}

function span(seg: MotionSegment, tick: number): number {
  const t = tick - seg.start;
  if (!(t > 0)) return 0;
  const len = seg.end - seg.start;
  return t < len ? t : len;
}

function atLeast(y: number, floor: number): number {
  return floor > y ? floor : y;
}

function skidDistance(seg: SkidSegment, s: number): { ux: number; uz: number; d: number } {
  const speed = Math.hypot(seg.vx, seg.vz);
  if (!(speed > EPS)) return { ux: 0, uz: 0, d: 0 };
  return { ux: seg.vx / speed, uz: seg.vz / speed, d: speed * s - 0.5 * seg.decel * s * s };
}

/**
 * Position at any fractional tick; a flight never reads below the ground. Past
 * `end` a segment holds its end point: the next segment exists only once the
 * owning tick has run, so a client that renders between ticks predicts it with
 * resolveFlightEnd over the same ground.
 */
export function positionAt(seg: MotionSegment, tick: number, probe: GroundProbe): Vec3 {
  const s = span(seg, tick) * DT;
  switch (seg.kind) {
    case 'march': {
      const x = seg.x + seg.dx * seg.speed * s;
      const z = seg.z + seg.dz * seg.speed * s;
      return { x, y: groundOr(probe, x, z, seg.y), z };
    }
    case 'fly': {
      const x = seg.x + seg.vx * s;
      const z = seg.z + seg.vz * s;
      const y = seg.y + seg.vy * s - 0.5 * seg.g * s * s;
      return { x, y: atLeast(y, probe.ground(x, z)), z };
    }
    case 'skid': {
      const k = skidDistance(seg, s);
      const x = seg.x + k.ux * k.d;
      const z = seg.z + k.uz * k.d;
      return { x, y: groundOr(probe, x, z, seg.y), z };
    }
    case 'still':
      return { x: seg.x, y: atLeast(seg.y, probe.ground(seg.x, seg.z)), z: seg.z };
  }
}

export function velocityAt(seg: MotionSegment, tick: number): Vec3 {
  const s = span(seg, tick) * DT;
  switch (seg.kind) {
    case 'march':
      if (tick >= seg.end) return { x: 0, y: 0, z: 0 };
      return { x: seg.dx * seg.speed, y: 0, z: seg.dz * seg.speed };
    case 'fly':
      return { x: seg.vx, y: seg.vy - seg.g * s, z: seg.vz };
    case 'skid': {
      const speed = Math.hypot(seg.vx, seg.vz);
      if (!(speed > EPS)) return { x: 0, y: 0, z: 0 };
      const now = Math.max(0, speed - seg.decel * s);
      return { x: (seg.vx / speed) * now, y: 0, z: (seg.vz / speed) * now };
    }
    case 'still':
      return { x: 0, y: 0, z: 0 };
  }
}

function deepWater(probe: ThrowProbe, phys: ThrowPhysics, x: number, z: number): number | null {
  const w = probe.water(x, z);
  if (w === null || !Number.isFinite(w)) return null;
  return w - probe.ground(x, z) > phys.deepWater ? w : null;
}

/** What a falling body meets: the deep-water surface, else the ground; nothing where the ground is non-finite. */
function surfaceAt(probe: ThrowProbe, phys: ThrowPhysics, x: number, z: number): number {
  return deepWater(probe, phys, x, z) ?? groundOr(probe, x, z, Number.NEGATIVE_INFINITY);
}

export function marchSegment(
  start: number,
  x: number,
  y: number,
  z: number,
  targetX: number,
  targetZ: number,
  speed: number,
  stopDistance: number,
): MarchSegment {
  const dx = targetX - x;
  const dz = targetZ - z;
  const dist = Math.hypot(dx, dz);
  const travel = dist - stopDistance;
  const moves = dist > EPS && travel > 0 && speed > 0;
  return {
    kind: 'march',
    start,
    end: moves ? start + travel / speed / DT : start,
    x,
    y,
    z,
    dx: dist > EPS ? dx / dist : 0,
    dz: dist > EPS ? dz / dist : 0,
    speed: moves ? speed : 0,
  };
}

export function stillSegment(start: number, ticks: number, at: Vec3): StillSegment {
  return { kind: 'still', start, end: start + ticks, x: at.x, y: at.y, z: at.z };
}

/**
 * A vertical cylinder (the turret's body) as a swept obstacle for a body whose
 * `radius` is already added to the cylinder's. A move entering it with the feet
 * below `top` is blocked and slid out radially; a move starting inside (a body
 * that came down over the top) is free.
 */
export function sweepCylinder(
  cx: number,
  cz: number,
  radius: number,
  top: number,
  fx: number,
  fz: number,
  tx: number,
  tz: number,
  fromY: number,
  toY: number,
): SweepResult {
  const free = { x: tx, z: tz, blocked: false };
  const dx = tx - fx;
  const dz = tz - fz;
  const ox = fx - cx;
  const oz = fz - cz;
  const a = dx * dx + dz * dz;
  const c = ox * ox + oz * oz - radius * radius;
  if (!(c > 0) || !(a > EPS)) return free;
  const b = 2 * (ox * dx + oz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return free;
  const s = (-b - Math.sqrt(disc)) / (2 * a);
  if (s < 0 || s > 1) return free;
  if (!(fromY + s * (toY - fromY) < top)) return free;
  const rx = tx - cx;
  const rz = tz - cz;
  const rl = Math.hypot(rx, rz);
  if (rl > EPS) return { x: cx + (rx / rl) * radius, z: cz + (rz / rl) * radius, blocked: true };
  return { x: fx + dx * s, z: fz + dz * s, blocked: true };
}

/**
 * Reads a blocked sweep from (px, pz) to (cx, cz) as a contact plane through the
 * resolved point, its outward normal pointing from the blocked target back to
 * it. Returns where along the move the plane was crossed, or null when the move
 * is free or already leaves the surface (a body just reflected off it).
 */
function sweepContact(
  hit: SweepResult,
  px: number,
  pz: number,
  cx: number,
  cz: number,
  vx: number,
  vz: number,
): { frac: number; nx: number; nz: number } | null {
  if (!hit.blocked) return null;
  const ox = hit.x - cx;
  const oz = hit.z - cz;
  const olen = Math.hypot(ox, oz);
  const vlen = Math.hypot(vx, vz);
  let nx: number;
  let nz: number;
  if (olen > EPS) {
    nx = ox / olen;
    nz = oz / olen;
  } else if (vlen > EPS) {
    nx = -vx / vlen;
    nz = -vz / vlen;
  } else return null;
  if (!(vx * nx + vz * nz < 0)) return null;
  const before = (px - hit.x) * nx + (pz - hit.z) * nz;
  const after = (cx - hit.x) * nx + (cz - hit.z) * nz;
  const frac = before > 0 && before - after > EPS ? Math.min(1, before / (before - after)) : 0;
  return { frac, nx, nz };
}

/** Outward normal of a ground face met by a body moving along (vx, vz). */
function faceNormal(
  probe: ThrowProbe,
  x: number,
  z: number,
  vx: number,
  vz: number,
): { nx: number; nz: number } {
  const gx = groundOr(probe, x + GRADIENT_STEP, z, 0) - groundOr(probe, x - GRADIENT_STEP, z, 0);
  const gz = groundOr(probe, x, z + GRADIENT_STEP, 0) - groundOr(probe, x, z - GRADIENT_STEP, 0);
  const glen = Math.hypot(gx, gz);
  if (glen > EPS && -(gx * vx + gz * vz) / glen < 0) return { nx: -gx / glen, nz: -gz / glen };
  const vlen = Math.hypot(vx, vz);
  return vlen > EPS ? { nx: -vx / vlen, nz: -vz / vlen } : { nx: 0, nz: 0 };
}

function fly(
  start: number,
  x: number,
  y: number,
  z: number,
  v: Vec3,
  g: number,
  duration: number,
  contact: FlyContact,
  nx: number,
  nz: number,
): FlySegment {
  return {
    kind: 'fly',
    start,
    end: start + duration,
    x,
    y,
    z,
    vx: v.x,
    vy: v.y,
    vz: v.z,
    g,
    contact,
    nx,
    nz,
  };
}

/**
 * Plans one ballistic segment from a launch point. The first contact is searched
 * by sampling `substeps` times per tick up to `maxFlightTicks`, then refined by
 * bisection so the segment ends on the surface rather than on a sample. Ground
 * met well above the body (a step, a cliff) is a face and reflects like a
 * collider instead of lifting the body onto it.
 */
export function planFlight(
  start: number,
  x: number,
  y: number,
  z: number,
  v: Vec3,
  radius: number,
  probe: ThrowProbe,
  phys: ThrowPhysics,
): FlySegment {
  const g = phys.gravity;
  const step = 1 / phys.substeps;
  const steps = phys.maxFlightTicks * phys.substeps;
  const rawY = (t: number): number => {
    const s = t * DT;
    return y + v.y * s - 0.5 * g * s * s;
  };
  const above = (t: number): boolean => {
    const s = t * DT;
    return rawY(t) > surfaceAt(probe, phys, x + v.x * s, z + v.z * s);
  };
  let prev = 0;
  let px = x;
  let py = y;
  let pz = z;
  for (let k = 1; k <= steps; k++) {
    const t = k * step;
    const s = t * DT;
    const cx = x + v.x * s;
    const cz = z + v.z * s;
    const cy = rawY(t);
    const wall = probe.sweep
      ? sweepContact(probe.sweep(px, pz, cx, cz, radius, py, cy), px, pz, cx, cz, v.x, v.z)
      : null;
    const wallT = wall ? prev + wall.frac * step : -1;
    if (!above(t)) {
      let lo = prev;
      let hi = t;
      for (let i = 0; i < REFINE_STEPS; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid)) lo = mid;
        else hi = mid;
      }
      if (wallT < 0 || hi <= wallT) {
        const hx = x + v.x * hi * DT;
        const hz = z + v.z * hi * DT;
        if (deepWater(probe, phys, hx, hz) !== null) {
          return fly(start, x, y, z, v, g, hi, 'water', 0, 0);
        }
        if (groundOr(probe, hx, hz, rawY(hi)) - rawY(hi) > phys.stepRise) {
          const n = faceNormal(probe, hx, hz, v.x, v.z);
          return fly(start, x, y, z, v, g, lo, 'wall', n.nx, n.nz);
        }
        return fly(start, x, y, z, v, g, hi, 'ground', 0, 0);
      }
    }
    if (wall) return fly(start, x, y, z, v, g, wallT, 'wall', wall.nx, wall.nz);
    prev = t;
    px = cx;
    py = cy;
    pz = cz;
  }
  return fly(start, x, y, z, v, g, steps * step, 'void', 0, 0);
}

/**
 * Plans the slide after a landing: constant deceleration until the stop speed
 * (bounded by `maxSkidTicks`), cut short by a collider (the body stops against
 * it) or deep water (splash). Null when the body is already slower than the stop
 * speed.
 */
export function planSkid(
  start: number,
  x: number,
  y: number,
  z: number,
  vx: number,
  vz: number,
  radius: number,
  probe: ThrowProbe,
  phys: ThrowPhysics,
): SkidSegment | null {
  const speed = Math.hypot(vx, vz);
  if (!(speed > phys.skidStopSpeed)) return null;
  const a = phys.skidDecel;
  const ux = vx / speed;
  const uz = vz / speed;
  const total = Math.min((speed - phys.skidStopSpeed) / a / DT, phys.maxSkidTicks);
  const dist = (t: number): number => {
    const s = t * DT;
    return speed * s - 0.5 * a * s * s;
  };
  const skid = (end: number, contact: SkidContact): SkidSegment => ({
    kind: 'skid',
    start,
    end: start + end,
    x,
    y,
    z,
    vx,
    vz,
    decel: a,
    contact,
  });
  const step = 1 / phys.substeps;
  const steps = Math.ceil(total * phys.substeps);
  let prev = 0;
  let px = x;
  let py = y;
  let pz = z;
  for (let k = 1; k <= steps; k++) {
    const t = Math.min(k * step, total);
    const d = dist(t);
    const cx = x + ux * d;
    const cz = z + uz * d;
    const cy = groundOr(probe, cx, cz, py);
    const wall = probe.sweep
      ? sweepContact(probe.sweep(px, pz, cx, cz, radius, py, cy), px, pz, cx, cz, ux, uz)
      : null;
    if (wall) {
      const d0 = dist(prev);
      const reach = d0 + wall.frac * (d - d0);
      const disc = Math.max(0, speed * speed - 2 * a * reach);
      return skid((speed - Math.sqrt(disc)) / a / DT, 'wall');
    }
    if (deepWater(probe, phys, cx, cz) !== null) return skid(t, 'water');
    prev = t;
    px = cx;
    py = cy;
    pz = cz;
  }
  return skid(total, 'stop');
}

/** Resolves the contact that ends a flight: bounce, collider reflection, landing, splash or void. */
export function resolveFlightEnd(
  seg: FlySegment,
  radius: number,
  probe: ThrowProbe,
  phys: ThrowPhysics,
): FlightOutcome {
  const s = (seg.end - seg.start) * DT;
  const x = seg.x + seg.vx * s;
  const z = seg.z + seg.vz * s;
  const rawY = seg.y + seg.vy * s - 0.5 * seg.g * s * s;
  const vy = seg.vy - seg.g * s;
  switch (seg.contact) {
    case 'void':
      return { kind: 'void', x, y: rawY, z };
    case 'water':
      return { kind: 'splash', x, y: waterSurfaceOr(probe, x, z, rawY), z };
    case 'wall': {
      const y = atLeast(rawY, probe.ground(x, z));
      const into = seg.vx * seg.nx + seg.vz * seg.nz;
      const rx = into < 0 ? seg.vx - 2 * into * seg.nx : seg.vx;
      const rz = into < 0 ? seg.vz - 2 * into * seg.nz : seg.vz;
      const k = phys.wallRestitution;
      const v = { x: rx * k, y: vy, z: rz * k };
      return {
        kind: 'wall',
        x,
        y,
        z,
        speed: Math.hypot(seg.vx, seg.vz),
        seg: planFlight(seg.end, x, y, z, v, radius, probe, phys),
      };
    }
    case 'ground': {
      const y = groundOr(probe, x, z, rawY);
      if (vy < -phys.bounceMinSpeed) {
        const keep = phys.bounceKeep;
        const v = { x: seg.vx * keep, y: -vy * phys.restitution, z: seg.vz * keep };
        return {
          kind: 'bounce',
          x,
          y,
          z,
          speed: -vy,
          seg: planFlight(seg.end, x, y, z, v, radius, probe, phys),
        };
      }
      const skid = planSkid(seg.end, x, y, z, seg.vx, seg.vz, radius, probe, phys);
      return { kind: 'land', x, y, z, skid };
    }
  }
}
