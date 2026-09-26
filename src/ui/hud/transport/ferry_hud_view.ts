// The ferry HUD's pure view-core: from the world's timetable view
// (IWorld.ferryView) and where the player stands, what the small ferry panel
// says. DOM-free; the painter (ferry_hud_painter.ts) only writes what this
// returns.
//
//  - On the pier or aboard a docked ship (within FERRY_HUD_NEAR_YD of it):
//    "The ferry to <dest> departs in 0:45", plus the boarding hint.
//  - Aboard while it sails: a quiet "Sailing to <dest>" line. The voyage
//    itself is in plain sight (the ship sails the whole way), so there is no
//    card over the world.
//  - Anywhere else, or with no ferry in this world: nothing.

import { TRANSPORT_ROUTES } from '../../../sim/content/transport_ships';
import type { TransportFerryView } from '../../../world_api';

/** The panel shows the countdown this close (yards) to the docked ship. */
export const FERRY_HUD_NEAR_YD = 45;

export type FerryHudLine = 'none' | 'departsIn' | 'castingOff' | 'sailing';

export interface FerryHudModel {
  line: FerryHudLine;
  /** The destination's POI mark (poi:<zone>:<poi>), for its localized label. */
  destPoi: string;
  /** Whole seconds to the departure (departsIn only). */
  seconds: number;
  /** The boarding hint under the countdown. */
  hint: boolean;
}

export function emptyFerryHudModel(): FerryHudModel {
  return { line: 'none', destPoi: '', seconds: 0, hint: false };
}

/** Fill `out` for this update (allocation free). */
export function ferryHudModel(
  view: TransportFerryView | null,
  playerX: number,
  playerZ: number,
  out: FerryHudModel = emptyFerryHudModel(),
): FerryHudModel {
  out.line = 'none';
  out.destPoi = '';
  out.seconds = 0;
  out.hint = false;
  if (!view) return out;
  const route = TRANSPORT_ROUTES.find((r) => r.id === view.routeId);
  if (!route) return out;
  const dest = route.berths.find((b) => b.id === view.to);
  out.destPoi = dest?.poi ?? '';
  if (view.passenger) {
    out.line = 'sailing';
    return out;
  }
  if (view.phase !== 'docked') return out;
  if (Math.hypot(playerX - view.x, playerZ - view.z) > FERRY_HUD_NEAR_YD) return out;
  out.seconds = Math.ceil(view.departsIn);
  out.line = out.seconds >= 1 ? 'departsIn' : 'castingOff';
  out.hint = true;
  return out;
}
