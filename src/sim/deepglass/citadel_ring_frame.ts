// Tidehold, the ring city: the frame every ring-layout module shares.
//
// Troy's 2026-09-07 redesign: the peninsula city became a CIRCULAR island
// north of the Deepglass, three tiers rising to the castle at the centre, // docks and the poor quarters on the outer ring, the trading hub on the
// middle ring, the Warden's Seat on the crown, with the arena off to the
// south over a bridge and two more bridges out from the outer ring east and
// west. 1.7x the old footprint (the old wards covered ~150k sq yd; the island
// covers ~250k).
//
// Everything here is WORLD yards. Bearings are measured from north (+z),
// clockwise toward east (+x): pol(r, 0) is north of the centre, pol(r, PI/2)
// is east, pol(r, PI) is south (toward the arena).
//
// Kept DOM- and citadel-free on purpose: citadel.ts (the residents' roster)
// imports ringSeat() from here, and citadel_ring.ts imports helpers from
// citadel.ts, so this module must not import either.

import { DEEPGLASS_CENTER } from './layout';

/** Island centre. Due north of the bell, far enough that the south bridge
 *  clears the arena's chasm. */
export const RING_CX = DEEPGLASS_CENTER.x;
export const RING_CZ = 495;
/** Island radius: the quay edge. */
export const RING_R = 280;

/** The three tiers: [inner radius, outer radius, height]. The outer tier's
 *  outer edge IS the quay; the crown's inner radius is 0. */
export interface RingTier {
  id: 'outer' | 'middle' | 'crown';
  name: string;
  r0: number;
  r1: number;
  y: number;
  /** Radius of the tier's ring road (0 = no ring road: the crown has a plaza). */
  roadR: number;
}
export const RING_TIERS: readonly RingTier[] = [
  // roadR 240 (was 235): the Trading Ring's rim banks 6yd out onto this tier,
  // and its inner plot band had to move out past the bank's toe.
  { id: 'outer', name: 'The Low Wards', r0: 190, r1: RING_R, y: 6, roadR: 239 },
  { id: 'middle', name: 'The Trading Ring', r0: 100, r1: 190, y: 20, roadR: 145 },
  { id: 'crown', name: 'The Warden’s Seat', r0: 0, r1: 100, y: 36, roadR: 0 },
];
export const RING_OUTER = RING_TIERS[0];
export const RING_MIDDLE = RING_TIERS[1];
export const RING_CROWN = RING_TIERS[2];

/** Half-width of the ring roads and the four avenues. */
export const RING_ROAD_HALF_W = 6;
export const RING_AVENUE_HALF_W = 7;
/** Half-width of the diagonal lanes on the two lower tiers. */
export const RING_LANE_HALF_W = 3.5;

/** The four avenues, by bearing: south (to the arena bridge), east, north,
 *  west. Every tier boundary is climbed by a flight of stairs on each. */
export const RING_AVENUES: readonly number[] = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];
/** The four diagonal lanes on the outer and middle tiers. */
export const RING_LANES: readonly number[] = [
  Math.PI / 4,
  (3 * Math.PI) / 4,
  -Math.PI / 4,
  (-3 * Math.PI) / 4,
];

/** Wardens' Garden: the fenced flower garden on the north avenue of the
 *  trading ring, where Wardens' Row begins. */
export const RING_SQUARE = { r: 170, phi: 0 } as const;
/** Baldemar's Square: the Realm Builder monument's seat, the crossroads at the
 *  heart of the Glass Market where the south avenue meets the ring road
 *  (Troy, 2026-09-07: "move the realmbuilder monument to this crossroad").
 *  citadel.ts TH_MONUMENT (the click-target entity) and citadel_ring.ts (the
 *  model) both read this, so the statue and its interaction never part. */
export const RING_MONUMENT = { r: 145, phi: Math.PI } as const;

/** The Gilded Gull (tavern) and Tide's Coffer (bank): the two trading-ring
 *  landmarks with a keeper of their own. citadel.ts seats the innkeeper and
 *  the coffer-keeper RELATIVE to these (behind his own bar; at his own steps)
 *  so a building and its keeper can never part again, Troy's 2026-09-08
 *  screenshot had the innkeeper greeting customers outside the bank, because
 *  the old (u, v) re-seat put him where the old plan's tavern stood. Both
 *  buildings face inward, toward the ring road: rotY = phi. */
export const RING_TAVERN = { r: 172, phi: -Math.PI / 2 - 0.44 } as const;
/** Castle B's seat on the crown (rotY 0, gate to the south). 30 not 26: the
 *  keep is 67 x 65 yd now, and this keeps its gate on the plaza's edge where
 *  the old keep's was while the great tower stays inside the crown wall. */
export const RING_CASTLE = { r: 30, phi: 0 } as const;
export const RING_BANK = { r: 172, phi: Math.PI / 2 + 0.44 } as const;

/** World point at a MODEL-space offset (lx, lz) from a placement seated at
 *  `origin` with yaw `rotY`, three.js rotation.y, local +x -> (cos, -sin),
 *  local +z -> (sin, cos), the frame colliders.ts rotates hitboxes in. */
export function localOffset(
  origin: { x: number; z: number },
  rotY: number,
  lx: number,
  lz: number,
): { x: number; z: number } {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return { x: origin.x + lx * c + lz * s, z: origin.z - lx * s + lz * c };
}

/** Run (yards, measured radially) of each stair flight between tiers, and the
 *  half-width of its lane. */
export const RING_STAIR_RUN = 26;
export const RING_STAIR_HALF_W = 8;

/** World point at radius r and bearing phi from the island centre. */
export function pol(r: number, phi: number): { x: number; z: number } {
  return { x: RING_CX + Math.sin(phi) * r, z: RING_CZ + Math.cos(phi) * r };
}

/** Radius and bearing of a world point relative to the island centre. */
export function polar(x: number, z: number): { r: number; phi: number } {
  const dx = x - RING_CX;
  const dz = z - RING_CZ;
  return { r: Math.hypot(dx, dz), phi: Math.atan2(dx, dz) };
}

/** Signed smallest difference between two bearings, in (-PI, PI]. */
export function bearingDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** The tier a radius falls in (the quay's outer slope counts as the outer
 *  tier; beyond it is the sea). */
export function tierAtRadius(r: number): RingTier | null {
  for (const t of RING_TIERS) if (r >= t.r0 && r < t.r1) return t;
  return null;
}

/** Placement yaw that turns a model's FRONT (its local -z) toward bearing
 *  `phi`, i.e. outward when `phi` is the bearing of the plot and the road
 *  lies outside it. Pass `phi + PI` to face inward. */
export function faceBearing(phi: number): number {
  // A placement rotated by rotY maps local (0, -1) to world (-sin rotY, -cos rotY),
  // so facing bearing phi (sin phi, cos phi) needs rotY = phi + PI.
  return phi + Math.PI;
}

/**
 * Re-seat a point of the OLD peninsula plan (city units u across, v along,
 * see citadel.ts th()) onto the ring. The old wards were bands along v; the
 * ring's tiers are bands of radius. The lower and market wards wrap around
 * the SOUTH half of the outer and middle rings, the high ward around the
 * north half of the middle ring, and the keep onto the crown, so the forty
 * residents keep their neighbours and their walks stay on their own tier.
 */
export function ringSeat(u: number, v: number): { x: number; z: number } {
  // Old ward bands (citadel.ts TH_WARDS): lower -6..52, market 52..106,
  // high 106..152, keep 152..196 (v), half-widths 70 / 82 / 74 / 52 (u).
  let r: number;
  let phi: number;
  if (v < 52) {
    const t = (v + 6) / 58;
    r = RING_OUTER.r1 - 12 - t * (RING_OUTER.r1 - 12 - (RING_OUTER.r0 + 10));
    phi = Math.PI - (u / 70) * (Math.PI / 2);
  } else if (v < 106) {
    const t = (v - 52) / 54;
    r = RING_MIDDLE.r1 - 10 - t * (RING_MIDDLE.r1 - 10 - (RING_MIDDLE.r0 + 12));
    phi = Math.PI - (u / 82) * (Math.PI / 2);
  } else if (v < 152) {
    const t = (v - 106) / 46;
    r = RING_MIDDLE.r1 - 10 - t * (RING_MIDDLE.r1 - 10 - (RING_MIDDLE.r0 + 12));
    phi = (u / 74) * (Math.PI / 2);
  } else {
    const t = (v - 152) / 44;
    r = RING_CROWN.r1 - 12 - t * (RING_CROWN.r1 - 12 - 40);
    phi = (u / 52) * (Math.PI / 2);
  }
  return pol(r, phi);
}
