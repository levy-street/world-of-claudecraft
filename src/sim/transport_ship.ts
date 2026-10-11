// Transport ship hull collision: the walkable decks, stairs, rails, masts and
// boarding gangways of a moored ship, authored as SIMPLE volumes in the
// ship's own frame and placed into ordinary world colliders here. The visual
// hull (render/transport_ship.ts, the shipped GLB) never collides: gameplay
// reads only these boxes and circles, so a player walks a flat, stable deck
// whatever the hull's carving or its idle bob does.
//
// Ship frame: origin at the waterline centre, +y up (yards above the
// waterline), +z toward the bow, +x to PORT (three.js rotation.y places the
// frame, so rot 0 points the bow at world +z). A placed ship's base is its
// waterline: the decorProps row's `float` sinks it that far below
// WATER_LEVEL, the same seat the renderer draws it on.
//
// Every volume is a column from the seabed up to `top`, like every other
// open-world collider (colliders.ts): a STANDABLE volume is a floor a mover
// walks on (decks, stair treads, the gangplank), a blocking one is a wall a
// grounded mover cannot step over (rails at waist height, masts). Blocking
// tops still feed the movement model's passes-over rule, so a rail at
// deck + 1.2 stays above a jump's apex (1.125) and a player on foot cannot
// hop the side; sight checks (`cameraTopY`) read the same tops, so a player
// sees over a rail but not through a mast.
//
// Pure leaf: deterministic, no SimContext, no three.js. The content rows
// live in content/transport_ships.ts; decor_prop_colliders.ts places them.

import type { Collider } from './colliders';

/** What a hull volume is for (reporting, tests, the preview scene). */
export type ShipVolumeKind =
  | 'deck'
  | 'stair'
  | 'rail'
  | 'gate'
  | 'mast'
  | 'prop'
  | 'gangway'
  | 'gangplank';

/** One simple collision volume, in the ship frame. */
export interface ShipVolume {
  id: string;
  kind: ShipVolumeKind;
  shape: 'obb' | 'circle';
  /** centre, ship frame */
  x: number;
  z: number;
  /** obb half extents along the volume's own axes (after `rot`) */
  hw?: number;
  hd?: number;
  /** circle radius */
  r?: number;
  /** yaw inside the ship frame (three.js rotation.y convention) */
  rot?: number;
  /** top, yards above the waterline */
  top: number;
  /** The sight-line top when it differs from `top`: an open balustrade stops a
   *  body at its rail but is seen and cast through above its bottom rail. */
  sightTop?: number;
  /** a floor a mover stands on (true) or a wall it is stopped by (false) */
  standable: boolean;
}

/** A gangway: where a gangplank docks and a boarding route opens. */
export interface ShipBoardingPoint {
  id: string;
  side: 'port' | 'starboard';
  /** the attachment point on the hull side, ship frame */
  x: number;
  y: number;
  z: number;
  /** clear width of the opening in the rail */
  width: number;
  /** open today (a gangplank lies here) or closed by a drop bar */
  open: boolean;
}

export interface ShipHullLayout {
  id: string;
  /** walkable deck heights, yards above the waterline */
  mainDeckY: number;
  captainDeckY: number;
  forecastleY: number;
  /** rail height above the deck it guards */
  railHeight: number;
  /** hull length (stem to transom at the deck) and max beam */
  length: number;
  beam: number;
  /** outer half-beam at deck level at ship-local z (stern -z to stem +z), the hull's
   *  taper; absent, the hull is `beam` wide from stem to transom */
  halfBeamAt?: (z: number) => number;
  /** keel depth below the waterline, midships */
  draft: number;
  boarding: readonly ShipBoardingPoint[];
  volumes: readonly ShipVolume[];
}

/** A placed ship: world position of its frame origin, yaw, waterline base. */
export interface ShipPose {
  x: number;
  z: number;
  rot: number;
  /** world Y of the ship frame's origin (the waterline it floats on) */
  baseY: number;
}

/** Ship-frame point to world XZ (three.js rotation.y convention). */
export function shipToWorld(pose: ShipPose, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(pose.rot);
  const s = Math.sin(pose.rot);
  return { x: pose.x + x * c + z * s, z: pose.z - x * s + z * c };
}

/** World XZ to the ship frame (the inverse of shipToWorld). */
export function worldToShip(pose: ShipPose, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(pose.rot);
  const s = Math.sin(pose.rot);
  const dx = x - pose.x;
  const dz = z - pose.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** The hull's volumes as world colliders for one placed ship. */
export function shipHullColliders(layout: ShipHullLayout, pose: ShipPose): Collider[] {
  const out: Collider[] = [];
  for (const v of layout.volumes) {
    const at = shipToWorld(pose, v.x, v.z);
    const top = pose.baseY + v.top;
    const cameraTopY = pose.baseY + (v.sightTop ?? v.top);
    const stand = v.standable ? { moveTopY: top, standable: true as const } : { moveTopY: top };
    if (v.shape === 'circle') {
      out.push({ type: 'circle', x: at.x, z: at.z, r: v.r ?? 0.5, cameraTopY, ...stand });
      continue;
    }
    out.push({
      type: 'obb',
      x: at.x,
      z: at.z,
      hw: v.hw ?? 0.5,
      hd: v.hd ?? 0.5,
      rot: pose.rot + (v.rot ?? 0),
      cameraTopY,
      ...stand,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Authoring helpers (used by the content rows; exported for tests)
// ---------------------------------------------------------------------------

/**
 * A straight flight of stair treads: `steps` standable boxes climbing from
 * `fromY` to `toY` along the ship's z axis, starting at `z0` and running
 * `run` yards per tread toward `dir` (+1 bow-ward, -1 stern-ward). The last
 * tread lands exactly on `toY`.
 */
export function stairFlight(
  id: string,
  x: number,
  halfWidth: number,
  z0: number,
  dir: 1 | -1,
  run: number,
  steps: number,
  fromY: number,
  toY: number,
): ShipVolume[] {
  const rise = (toY - fromY) / steps;
  const out: ShipVolume[] = [];
  for (let k = 1; k <= steps; k++) {
    out.push({
      id: `${id}_${k}`,
      kind: 'stair',
      shape: 'obb',
      x,
      z: z0 + dir * (k - 0.5) * run,
      hw: halfWidth,
      hd: run / 2,
      top: fromY + rise * k,
      standable: true,
    });
  }
  return out;
}

/**
 * A rail run along a polyline of ship-frame (x, z) points: one thin blocking
 * box per segment, `thickness` wide, its top at `top`. Consecutive boxes
 * overlap by the thickness so a corner never leaves a slit a body fits
 * through.
 */
export function railRun(
  id: string,
  points: readonly (readonly [number, number])[],
  top: number,
  thickness = 0.3,
  kind: ShipVolumeKind = 'rail',
  sightTop?: number,
): ShipVolume[] {
  const out: ShipVolume[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) continue;
    out.push({
      id: `${id}_${i + 1}`,
      kind,
      shape: 'obb',
      x: (x0 + x1) / 2,
      z: (z0 + z1) / 2,
      hw: thickness / 2,
      hd: len / 2 + thickness / 2,
      // local z runs along the segment: yaw so (0, 1) maps onto its direction
      rot: Math.atan2(x1 - x0, z1 - z0),
      top,
      ...(sightTop === undefined ? {} : { sightTop }),
      standable: false,
    });
  }
  return out;
}
