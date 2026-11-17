// The Gyre's storm granite: painted crags standing round the storm peak's foot and standing
// stones along its climb, so the mountain reads as the wind quarter's own rock instead of a bare
// dome. Four generated models (public/models/props, registered in render/props.ts): a spire stack,
// a broad bluff, a wind arch and a slender standing stone, all wind-carved pale granite with
// lichen and sky-blue crystal.
//
// Authored decor only (a ZonePropsDef.decorProps list, merged by quartered_isle.ts): every piece
// is seated on existing ground (the Gyre's landform and the plains round it are not touched) with
// a collider inside its footprint. Pure leaf: deterministic, no rng, no SimContext.

import { GYRE_LAUNCH_POCKETS, gyreYardsAtT } from '../quartered_gyre_wind';
import { GYRE_PEAK, gyrePathPoint } from '../quartered_landmarks';
import type { ZonePropsDef } from '../types';
import { GYRE_RAIL_GAP_HALF, gyreLipAt } from './quartered_gyre_rails';

type DecorProp = NonNullable<ZonePropsDef['decorProps']>[number];

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The crags' models at scale 1: footprint (w across the front, d deep) and height, yards
 *  (render/prop_natural_size.generated.ts, which a test pins). */
export const GYRE_CRAG_KIT = {
  gyreStormSpire: { w: 11.86, d: 10.18, h: 22 },
  gyreStormBluff: { w: 18, d: 10.42, h: 9.17 },
  gyreStormArch: { w: 14.4, d: 7.13, h: 11.36 },
  gyreStormStone: { w: 3.01, d: 2.78, h: 8 },
} as const;
export type GyreCragKey = keyof typeof GYRE_CRAG_KIT;

/** How much of a crag's footprint its collider covers: the rock's silhouette is narrower than its
 *  bounding box, so the box a player bumps is held inside it (a corner is never an invisible
 *  wall a stride out). */
const CRAG_COLLIDER_SHARE = 0.72;
/** A standing stone is slim and its foot is a rough low base: its box is a little tighter still. */
const STONE_COLLIDER_SHARE = 0.8;

export interface GyreCragPiece {
  key: GyreCragKey;
  x: number;
  z: number;
  /** model front is +z; rot turns it (rotation.y), so PI/2 faces +x (east) */
  rot: number;
  scale: number;
}

/** A point at bearing `deg` (degrees anticlockwise from east, seen from above) and `r` yards
 *  from the peak's centre. */
function onPeak(deg: number, r: number): { x: number; z: number } {
  const a = (deg * Math.PI) / 180;
  return { x: GYRE_PEAK.x + Math.cos(a) * r, z: GYRE_PEAK.z + Math.sin(a) * r };
}

/** The rot that turns a model's front to face bearing `deg` (the same degrees as onPeak). */
function facing(deg: number): number {
  return Math.PI / 2 - (deg * Math.PI) / 180;
}

/** The foot ring: crags on the low ground round the peak, each one's face turned out across the
 *  plain, with its back to the mountain. Bearings are degrees from east (anticlockwise). */
const FOOT_RING: ReadonlyArray<{
  key: GyreCragKey;
  deg: number;
  r: number;
  /** degrees the face is turned from facing straight out */
  turn: number;
  scale: number;
}> = [
  // the east plain, toward the Cinderscar: the one great spire the plain has the room for
  { key: 'gyreStormSpire', deg: 3, r: 55, turn: 0, scale: 1.2 },
  // the west plain: a bluff at the peak's foot and a spire further out along the shore
  { key: 'gyreStormBluff', deg: 183, r: 51, turn: 8, scale: 1 },
  { key: 'gyreStormSpire', deg: 201, r: 53, turn: 0, scale: 1.1 },
  // either side of the causeway the town's road climbs on: the arch to the east, a spire to the west
  { key: 'gyreStormSpire', deg: -111, r: 52, turn: 12, scale: 0.95 },
  { key: 'gyreStormArch', deg: -63, r: 57, turn: -12, scale: 1.15 },
];

/** The foot ring's pieces. */
export function gyreFootCrags(): GyreCragPiece[] {
  return FOOT_RING.map((c) => {
    const p = onPeak(c.deg, c.r);
    return { key: c.key, x: p.x, z: p.z, rot: facing(c.deg + c.turn), scale: c.scale };
  });
}

/** Where along the path (0 at its foot, 1 at the crown) the standing stones stand: between the
 *  way beacons (quartered_council_seat.ts COUNCIL_BEACON_STOPS, on the outer lip), on the
 *  inner lip, so the two never crowd the same stretch of the walk. */
export const GYRE_STONE_STOPS: readonly number[] = [0.07, 0.22, 0.39, 0.56, 0.73];
/** A stone stands this far inboard of the path's centre line (the path is GYRE_PEAK.pathW wide),
 *  against its inner lip, where the next turn's face rises behind it. */
export const GYRE_STONE_OFFSET = 2.2;

/** The standing stones along the climb, foot to crown, each facing back down the path toward
 *  whoever is climbing. */
export function gyreStonePieces(): GyreCragPiece[] {
  return GYRE_STONE_STOPS.map((t) => {
    const p = gyrePathPoint(t);
    const dx = p.x - GYRE_PEAK.x;
    const dz = p.z - GYRE_PEAK.z;
    const r = Math.hypot(dx, dz);
    const inward = (r - GYRE_STONE_OFFSET) / r;
    return {
      key: 'gyreStormStone',
      x: GYRE_PEAK.x + dx * inward,
      z: GYRE_PEAK.z + dz * inward,
      // the path runs anticlockwise; back down it is a model yaw of PI - bearing (as the beacons)
      rot: Math.PI - Math.atan2(dz, dx),
      scale: 1,
    };
  });
}

/** How far inside each end of a launch pocket's opening in the railing the gate stones stand, along
 *  the path, yards. */
export const GYRE_GATE_INSET = 1.4;
/** The gate stones stand a little taller than the path's other stones. */
export const GYRE_GATE_SCALE = 1.15;

/** The launch pockets' gate stones: a pair of standing stones inside each opening of the railing,
 *  their faces turned to each other across it, so each updraft reads from far down the climb. */
export function gyreGateStones(): GyreCragPiece[] {
  const out: GyreCragPiece[] = [];
  for (const pocket of GYRE_LAUNCH_POCKETS) {
    const c = gyreYardsAtT(pocket.t);
    const [a, b] = [-1, 1].map((side) =>
      gyreLipAt(c + side * (GYRE_RAIL_GAP_HALF - GYRE_GATE_INSET)),
    );
    // each faces the other across the opening
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      out.push({
        key: 'gyreStormStone',
        x: from.x,
        z: from.z,
        rot: Math.atan2(to.x - from.x, to.z - from.z),
        scale: GYRE_GATE_SCALE,
      });
    }
  }
  return out;
}

/** Every piece, foot ring first, then the stones up the path, then the pockets' gate stones. */
export function gyreCragPieces(): GyreCragPiece[] {
  return [...gyreFootCrags(), ...gyreStonePieces(), ...gyreGateStones()];
}

/** The crags' decor rows, in a stable order. */
export function gyreCragDecor(): DecorProp[] {
  return gyreCragPieces().map((p): DecorProp => {
    const k = GYRE_CRAG_KIT[p.key];
    const share = p.key === 'gyreStormStone' ? STONE_COLLIDER_SHARE : CRAG_COLLIDER_SHARE;
    return {
      key: p.key,
      // seated on the ground as it is: the calm pad round a big crag would only level the
      // plain's own relief, and on the path it would cut into the climb
      terrainCalm: false,
      x: round2(p.x),
      z: round2(p.z),
      rot: round2(p.rot),
      ...(p.scale === 1 ? {} : { scale: p.scale }),
      // the clearance radius scatter and roads keep out of: the footprint's circumscribed circle
      r: round2((Math.hypot(k.w, k.d) / 2) * p.scale),
      h: round2(k.h * p.scale),
      // a glide off the mountain crosses the lower turns and the foot: the collider is as tall as
      // the piece and no taller, so a body above it flies over (never an invisible wall in the sky)
      clearAbove: round2(k.h * p.scale),
      // the collider is the piece's own box, in its local axes
      hw: round2((k.w / 2) * p.scale * share),
      hd: round2((k.d / 2) * p.scale * share),
    };
  });
}
