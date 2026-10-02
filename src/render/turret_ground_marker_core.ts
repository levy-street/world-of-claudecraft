// Fire and Fly monsters on screen, the ground marker half: the red disc and
// ring under every living monster, so a body reads from across the clearing in
// the dusk light. Where it lies (the ground under the body at the display
// tick; under a flying body that is its shadow point, so the landing spot
// reads), how big it is (by body radius), the slope it lies on, and when it is
// hidden (a corpse, a gone body, or a windup, whose own strike ring replaces
// it). The painter is turret_ground_markers.ts.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES).

import type { TurretMonsterState } from '../sim/minigames/turret_defense';

/** Marker radius (yd) = body radius x SCALE + PAD: a small body still reads from far away. */
export const TURRET_MARKER_RADIUS_SCALE = 1.5;
export const TURRET_MARKER_RADIUS_PAD = 0.7;
/** Yards over the ground; the painter's polygon offset covers what a slope's curve leaves. */
export const TURRET_MARKER_LIFT = 0.06;
/** The steepest the disc tilts with the ground (rad), so a cliff edge never stands it on end. */
export const TURRET_MARKER_MAX_TILT = 0.6;
/**
 * How far a body moves before its marker's slope is sampled again, as a share
 * of the marker radius, never under TURRET_MARKER_RESAMPLE_YD. A flying body's
 * shadow sweeps across the ground far faster than a walker, and its slope
 * only needs to follow the ground at the disc's own scale.
 */
export const TURRET_MARKER_RESAMPLE_SHARE = 0.25;
export const TURRET_MARKER_AIR_RESAMPLE_SHARE = 1;
export const TURRET_MARKER_RESAMPLE_YD = 0.25;
/** Floats per instance matrix. */
export const TURRET_MARKER_MATRIX_FLOATS = 16;

const MIN_UP = Math.cos(TURRET_MARKER_MAX_TILT);

export interface TurretGroundMarker {
  visible: boolean;
  x: number;
  y: number;
  z: number;
  /** Unit normal of the ground the disc lies on. */
  nx: number;
  ny: number;
  nz: number;
  radius: number;
}

/** The fields of a displayed monster (the engine's or its forecast) a marker reads. */
export interface TurretMarkerBody {
  readonly state: TurretMonsterState;
  readonly hp: number;
}

/** The fields of a resolved pose a marker reads: where the body is, and its windup (-1 outside it). */
export interface TurretMarkerPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly windup: number;
}

export function newTurretGroundMarker(): TurretGroundMarker {
  return { visible: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, radius: 0 };
}

export function turretMarkerRadius(bodyRadius: number): number {
  return Math.max(0, bodyRadius) * TURRET_MARKER_RADIUS_SCALE + TURRET_MARKER_RADIUS_PAD;
}

export function turretMarkerResampleYd(markerRadius: number, airborne: boolean): number {
  const share = airborne ? TURRET_MARKER_AIR_RESAMPLE_SHARE : TURRET_MARKER_RESAMPLE_SHARE;
  return Math.max(TURRET_MARKER_RESAMPLE_YD, markerRadius * share);
}

/** A living, present monster outside its windup. */
export function turretMarkerShown(body: TurretMarkerBody, windup: number): boolean {
  return body.hp > 0 && body.state !== 'dead' && body.state !== 'gone' && !(windup >= 0);
}

/**
 * The slope under one body's marker, sampled across the disc (four ground
 * reads) only once the body has moved turretMarkerResampleYd from the last
 * sample or the disc changed size: a slope turns slowly, while the center
 * height follows the body every frame.
 */
export class TurretMarkerGround {
  nx = 0;
  ny = 1;
  nz = 0;
  /** How far the rim's mean stood over the center at the last sample (never below 0). */
  rise = 0;
  private x = Number.NaN;
  private z = Number.NaN;
  private radius = Number.NaN;

  reset(): void {
    this.x = this.z = this.radius = Number.NaN;
  }

  sample(
    x: number,
    z: number,
    radius: number,
    center: number,
    airborne: boolean,
    probe: { ground(x: number, z: number): number },
  ): void {
    const every = turretMarkerResampleYd(radius, airborne);
    if (radius === this.radius && Math.hypot(x - this.x, z - this.z) < every) return;
    this.x = x;
    this.z = z;
    this.radius = radius;
    const east = probe.ground(x + radius, z);
    const west = probe.ground(x - radius, z);
    const north = probe.ground(x, z + radius);
    const south = probe.ground(x, z - radius);
    let nx = -(east - west) / (2 * radius);
    let nz = -(north - south) / (2 * radius);
    let ny = 1;
    const length = Math.hypot(nx, ny, nz);
    nx /= length;
    ny /= length;
    nz /= length;
    if (!(ny >= MIN_UP)) {
      const horizontal = Math.hypot(nx, nz);
      const k = horizontal > 1e-9 ? Math.sqrt(1 - MIN_UP * MIN_UP) / horizontal : 0;
      nx *= k;
      nz *= k;
      ny = MIN_UP;
    }
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.rise = Math.max(0, (east + west + north + south) / 4 - center);
  }
}

/**
 * Resolves one monster's marker into `out`: on the ground under the pose's
 * horizontal position whatever the body's height, tilted to the slope across
 * the disc, and lifted over the higher of its center and its rim's mean so a
 * dip never swallows the edge. A body on the ground stands at its pose height,
 * the ground read its pose already paid for; only a flying body's shadow point
 * reads the ground again. `slope` is the body's own sample, kept across frames.
 */
export function turretGroundMarkerInto(
  out: TurretGroundMarker,
  body: TurretMarkerBody,
  pose: TurretMarkerPose,
  bodyRadius: number,
  probe: { ground(x: number, z: number): number },
  slope: TurretMarkerGround,
): TurretGroundMarker {
  out.visible = turretMarkerShown(body, pose.windup);
  if (!out.visible) return out;
  const r = turretMarkerRadius(bodyRadius);
  const x = pose.x;
  const z = pose.z;
  const airborne = body.state === 'fly';
  const center = airborne ? probe.ground(x, z) : pose.y;
  slope.sample(x, z, r, center, airborne, probe);
  out.x = x;
  out.y = center + slope.rise + TURRET_MARKER_LIFT;
  out.z = z;
  out.nx = slope.nx;
  out.ny = slope.ny;
  out.nz = slope.nz;
  out.radius = r;
  return out;
}

/**
 * Writes a marker's instance matrix into `out` at `offset`, column-major (the
 * layout of three's Matrix4 and of an instance matrix buffer): the shortest
 * rotation from up to the ground normal, scaled by the radius, at the marker.
 */
export function turretGroundMarkerMatrixInto(
  out: Float32Array,
  offset: number,
  m: TurretGroundMarker,
): void {
  const { nx, ny, nz, radius: s } = m;
  const k = 1 / (1 + ny);
  out[offset] = (1 - nx * nx * k) * s;
  out[offset + 1] = -nx * s;
  out[offset + 2] = -nx * nz * k * s;
  out[offset + 3] = 0;
  out[offset + 4] = nx * s;
  out[offset + 5] = ny * s;
  out[offset + 6] = nz * s;
  out[offset + 7] = 0;
  out[offset + 8] = -nx * nz * k * s;
  out[offset + 9] = -nz * s;
  out[offset + 10] = (1 - nz * nz * k) * s;
  out[offset + 11] = 0;
  out[offset + 12] = m.x;
  out[offset + 13] = m.y;
  out[offset + 14] = m.z;
  out[offset + 15] = 1;
}
