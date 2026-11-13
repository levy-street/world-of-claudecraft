// The sun of the zone the camera stands in (zone_sun_core.ts), eased: crossing a zone border
// swings the light round over a few seconds, at the pace the zone's haze and light colour
// already change, instead of snapping every shadow to a new side.
import { CELESTIAL_NOON_ELEVATION_DEG, moonDirection, sunDirection } from './day_night_core';
import { easeAngleDeg, easeToward, foldDegrees, type ZoneSun } from './zone_sun_core';

/** How fast the sun follows its zone, per second (the zone environment's own response). */
export const ZONE_SUN_RESPONSE = 0.7;

const state = { turn: 0, elev: CELESTIAL_NOON_ELEVATION_DEG, primed: false };
const out = { turn: 0, elev: CELESTIAL_NOON_ELEVATION_DEG };

/** The eased turn and noon elevation for a zone's light row. The first call lands on the
 *  row at once: a session opens with its zone's sun, it does not swing into place. */
export function easeZoneSun(
  row: { sunTurn?: number; sunElev?: number },
  dt: number,
): Readonly<ZoneSun> {
  const turn = row.sunTurn ?? 0;
  const elev = row.sunElev ?? CELESTIAL_NOON_ELEVATION_DEG;
  if (!state.primed) {
    state.turn = turn;
    state.elev = elev;
    state.primed = true;
  } else {
    const k = 1 - Math.exp(-ZONE_SUN_RESPONSE * Math.max(0, dt));
    // folded, so a session that circles the map never winds the angle up
    state.turn = foldDegrees(easeAngleDeg(state.turn, turn, k));
    state.elev = easeToward(state.elev, elev, k);
  }
  out.turn = state.turn;
  out.elev = state.elev;
  return out;
}

const sky: { sun: [number, number, number]; moon: [number, number, number] } = {
  sun: [0, 1, 0],
  moon: [0, -1, 0],
};

/** The sun and moon directions at `phase` for the zone's light row, the zone's turn and
 *  noon height eased in. The one call the renderer's ambience makes each frame. */
export function zoneCelestial(
  row: { sunTurn?: number; sunElev?: number },
  dt: number,
  phase: number,
): Readonly<typeof sky> {
  const zone = easeZoneSun(row, dt);
  sky.sun = sunDirection(phase, zone.turn, zone.elev);
  sky.moon = moonDirection(phase, zone.turn, zone.elev);
  return sky;
}

/** Forget the eased sun: a new renderer (a rebuilt view, the editor's viewport) opens on
 *  its own zone's sun instead of swinging in from wherever the last one stood. */
export function resetZoneSun(): void {
  state.primed = false;
}
