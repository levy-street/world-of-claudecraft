// The Council's Seat: the Gyre's crown dressed as the sealed gate of the old
// council hall, the place the zone design calls "the climb to the seat". The
// crown is a level disc about twelve yards across at the top of the storm peak
// (quartered_landmarks.ts GYRE_PEAK). The path's last turn climbs onto it from
// the east, so the dressing is laid out as one walk: an open lane running west
// from the path's end across the paved crown to the sealed gate at its far end,
// with the crown's sides left clear for the wind's touchdowns and the wind pad
// back down (quartered_gyre_wind.ts, quartered_gyre_pads.ts). The door is sealed
// for now: it carries no portal, only the four-quarter seal the isle is named
// for.
//
// Authored decor only (a ZonePropsDef.decorProps list, merged by
// quartered_isle.ts): every piece is a generated model (public/models/props,
// registered in render/props.ts) with a collider matched to its footprint.
// Pure leaf: deterministic, no rng, no SimContext.

import { GYRE_FOOT_PAD } from '../quartered_gyre_pads';
import { GYRE_PEAK, gyrePathPoint } from '../quartered_landmarks';
import type { ZonePropsDef } from '../types';

type DecorProp = NonNullable<ZonePropsDef['decorProps']>[number];

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The seat's models at scale 1: footprint (w across the front, d deep) and
 *  height, yards (render/prop_natural_size.generated.ts, which a test pins). */
export const COUNCIL_SEAT_KIT = {
  councilSeatGate: { w: 8.05, d: 4.36, h: 9 },
  councilBeacon: { w: 1.9, d: 1.83, h: 4.6 },
  // the paved plaza: a thin round disc whose underside is the ground (the
  // prop renderer seats every model's lowest point on it), the paving a hand's
  // breadth up and a short curb of blocks at the rim; h is its whole height
  councilPlaza: { w: 10, d: 10, h: 0.16 },
} as const;
export type CouncilSeatKey = Exclude<
  keyof typeof COUNCIL_SEAT_KIT,
  'councilBeacon' | 'councilPlaza'
>;

/** How much of a piece's footprint its collider covers: the models are a
 *  little wider at the foot (steps, plinth lip) than the body a player bumps. */
const COLLIDER_SHARE = 0.96;

/** The lane's axis: due west along the crown's centre line, from the path's
 *  end (the east rim) to the gate. */
export const COUNCIL_LANE_Z = GYRE_PEAK.z;
/** The paved plaza: centred on the crown, drawn under everything else. Its
 *  painting's up is north (+z), so the compass rose lies in the isle's own
 *  quarters: the wind to the north, the fire east, the ice south, the earth
 *  west. Walk-through ground, no collider. */
export const COUNCIL_PLAZA = {
  x: GYRE_PEAK.x,
  z: GYRE_PEAK.z,
  /** the disc's radius, yards (the model is 10yd across): inside the level
   *  crown, so its rim stands on flat ground */
  radius: 5,
} as const;

export interface CouncilSeatPiece {
  key: CouncilSeatKey;
  x: number;
  z: number;
  /** model front is +z; rot turns it (rotation.y), so PI/2 faces +x (east) */
  rot: number;
  scale: number;
}

/** The gate, at the lane's west end, its face to the east: the player walks
 *  up the lane toward it from the path. */
export const COUNCIL_SEAT_GATE: CouncilSeatPiece = {
  key: 'councilSeatGate',
  x: GYRE_PEAK.x - 3.3,
  z: COUNCIL_LANE_Z,
  rot: Math.PI / 2,
  scale: 1,
};

/** Every piece on the crown: the gate alone, the rest of the crown left open. */
export const COUNCIL_SEAT_PIECES: readonly CouncilSeatPiece[] = [COUNCIL_SEAT_GATE];

/** Where along the path (0 at its foot, 1 at the crown) the way beacons
 *  stand, so the climb reads from far below and the last one flanks the way
 *  onto the crown. */
export const COUNCIL_BEACON_STOPS: readonly number[] = [0.14, 0.31, 0.48, 0.65, 0.82, 0.95];
/** A beacon stands this far outboard of the path's centre line (the path is
 *  GYRE_PEAK.pathW wide), on its outer lip, leaving most of the walk clear. */
export const COUNCIL_BEACON_OFFSET = 2.2;
/** A beacon's collider radius, inside its plinth. */
export const COUNCIL_BEACON_R = 0.85;

export interface CouncilBeaconPiece {
  /** the stop along the path, 0..1 */
  t: number;
  x: number;
  z: number;
  /** its face turned back down the path, toward whoever is climbing */
  rot: number;
}

/** The way beacons on the Gyre's path, foot to crown. */
export function councilBeaconPieces(): CouncilBeaconPiece[] {
  return COUNCIL_BEACON_STOPS.map((t) => {
    const p = gyrePathPoint(t);
    const dx = p.x - GYRE_PEAK.x;
    const dz = p.z - GYRE_PEAK.z;
    const r = Math.hypot(dx, dz);
    const out = (r + COUNCIL_BEACON_OFFSET) / r;
    return {
      t,
      x: GYRE_PEAK.x + dx * out,
      z: GYRE_PEAK.z + dz * out,
      // the path runs anticlockwise (increasing angle a); its tangent is
      // (-sin a, cos a), so back down the path is (sin a, -cos a), turned to
      // a model yaw of PI - a
      rot: Math.PI - Math.atan2(dz, dx),
    };
  });
}

/** The seat's decor, in a stable order: the plaza, the crown's pieces (the
 *  gate), then the beacons up the path. */
export function councilSeatDecor(): DecorProp[] {
  const plaza: DecorProp = {
    key: 'councilPlaza',
    // seated on the crown's own level ground
    terrainCalm: false,
    x: round2(COUNCIL_PLAZA.x),
    z: round2(COUNCIL_PLAZA.z),
    rot: 0,
  };
  const crown = COUNCIL_SEAT_PIECES.map((p): DecorProp => {
    const k = COUNCIL_SEAT_KIT[p.key];
    return {
      key: p.key,
      // the crown is already level (the Gyre's landform sets it): the calm pad
      // round a nine yard gate would only reach into the path's last turn
      terrainCalm: false,
      x: round2(p.x),
      z: round2(p.z),
      rot: round2(p.rot),
      ...(p.scale === 1 ? {} : { scale: p.scale }),
      // the clearance radius scatter and roads keep out of: the footprint's
      // circumscribed circle
      r: round2((Math.hypot(k.w, k.d) / 2) * p.scale),
      h: round2(k.h * p.scale),
      // the collider is the piece's own box, in its local axes
      hw: round2((k.w / 2) * p.scale * COLLIDER_SHARE),
      hd: round2((k.d / 2) * p.scale * COLLIDER_SHARE),
    };
  });
  const beacons = councilBeaconPieces().map(
    (b): DecorProp => ({
      key: 'councilBeacon',
      // seated on the path's own ground: the calm that flattens ground for
      // other decor would cut into the path's slope
      terrainCalm: false,
      x: round2(b.x),
      z: round2(b.z),
      rot: round2(b.rot),
      r: COUNCIL_BEACON_R,
      h: COUNCIL_SEAT_KIT.councilBeacon.h,
      // a glide off the mountain crosses the lower turns' beacons: blocks only as high as it stands
      clearAbove: COUNCIL_SEAT_KIT.councilBeacon.h,
    }),
  );
  return [plaza, ...crown, ...beacons];
}

/** The foot pad's floor at Gyrefoot Rest (quartered_gyre_pads.ts): the crown's paved compass disc
 *  drawn small under the pad's updraft, a little wider than the pad itself, so the way back up to
 *  the crown reads as the council's own work. Walk-through ground, no collider, no terrain calm,
 *  like the plaza. */
export function gyreFootPadDecor(): DecorProp {
  return {
    key: 'councilPlaza',
    terrainCalm: false,
    x: round2(GYRE_FOOT_PAD.x),
    z: round2(GYRE_FOOT_PAD.z),
    rot: 0,
    scale: round2((GYRE_FOOT_PAD.radius * 2 + 0.4) / COUNCIL_SEAT_KIT.councilPlaza.w),
  };
}
