// The Gyre's two wind pads: the quick ways onto and off the storm peak, for the living and for a
// released spirit alike (the gale's lanes and launch pockets carry only the living,
// quartered_gyre_wind.ts).
//
//   The foot pad   beside Gyrefoot Rest, the graveyard at the mountain's back foot (the flat west
//                  shore: the north foot drops straight into the sea), where a fall on the peak
//                  rises. A body that steps onto it is thrown up over the west face, past the
//                  north side of the council's gate, and set down on the crown's north rim.
//   The crown pad  on the crown's south side, facing the town. A body that steps onto it is thrown
//                  out over the south face and set down at the mountain's foot by the road's
//                  start, unhurt: the flight is scripted, so no fall is ever taken.
//
// Both are the scripted flight the launch pockets use (the Heroic Leap's, with no landing blast),
// under the pockets' cooldown. Pure leaf: geometry and constants only, deterministic; the
// per-player step that throws a body is quartered_gyre_wind_step.ts, and a test flies both arcs
// over the real ground to keep them clear of the mountain.

import { GYREFOOT_REST } from './content/graveyards';
import { GYRE_CROWN_NORTH_LANDING } from './quartered_gyre_wind';
import { GYRE_PEAK } from './quartered_landmarks';

/** Gyrefoot Rest, the graveyard the foot pad stands by (content/graveyards.ts). */
export { GYREFOOT_REST };

export interface GyreWindPad {
  id: 'foot' | 'crown';
  /** the pad's centre */
  x: number;
  z: number;
  /** a body standing within this many yards of the centre is thrown */
  radius: number;
  /** where the flight sets a body down. `y` is given where the ground is the Gyre's own (the
   *  crown's level top); null means the ground there, read when the flight starts */
  landing: { x: number; y: number | null; z: number };
  /** the flight's length and the height of its arc over the straight line, seconds and yards */
  duration: number;
  apex: number;
}

/** The foot pad: ten yards from the Rest toward the mountain, so a spirit rising at the Keeper's
 *  side is never thrown before it has taken a step. */
export const GYRE_FOOT_PAD: GyreWindPad = {
  id: 'foot',
  x: -52,
  z: 2366,
  radius: 1.6,
  landing: {
    x: GYRE_CROWN_NORTH_LANDING.x,
    y: GYRE_CROWN_NORTH_LANDING.y,
    z: GYRE_CROWN_NORTH_LANDING.z,
  },
  duration: 3.2,
  apex: 18,
};

/** The crown pad: on the crown's level top, south of the lane and clear of the gate, the crown's
 *  touchdown points and the path's arrival on the east rim; it lands a body on the level ground at
 *  the foot of the road's start, on the town's side. */
export const GYRE_CROWN_PAD: GyreWindPad = {
  id: 'crown',
  x: GYRE_PEAK.x + 1.6,
  z: GYRE_PEAK.z - 3.8,
  radius: 1.2,
  landing: { x: GYRE_PEAK.x, y: null, z: 2298 },
  duration: 3.2,
  // high enough to clear the storm stones standing on the south face's upper turns
  apex: 22,
};

/** Both pads, foot first. */
export const GYRE_WIND_PADS: readonly GyreWindPad[] = [GYRE_FOOT_PAD, GYRE_CROWN_PAD];

/** The pad (x, z) stands on, or null. */
export function gyreWindPadAt(x: number, z: number): GyreWindPad | null {
  for (const pad of GYRE_WIND_PADS) {
    const dx = x - pad.x;
    const dz = z - pad.z;
    if (dx * dx + dz * dz <= pad.radius * pad.radius) return pad;
  }
  return null;
}
