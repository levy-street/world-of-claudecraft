// The raid-marker command family off the dispatch switch in server/game.ts:
// the target markers (setMarker / clearMarker, byte-identical to the cases they
// replace) and the raid's shared marks (map_mark_set from the map,
// map_mark_place from a ground click in the world, map_mark_clear) and the
// party pings (ping, from the ping wheel).
// This layer only checks wire SHAPE (types, finiteness) and drops anything
// else; the Sim (src/sim/social/shared_map_marks.ts, party_pings.ts, targeting.ts)
// owns every rule: group membership, the instance the sender stands in, edit
// rights, bounds, the symbol and page ranges and the per-group rate limit. The
// socket's command lane bounds the frame rate before any of this runs.

import type { Sim } from '../src/sim/sim';

export type MarkerCommand =
  | 'setMarker'
  | 'clearMarker'
  | 'map_mark_set'
  | 'map_mark_place'
  | 'map_mark_clear'
  | 'ping';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function dispatchMarkerCommand(
  sim: Sim,
  command: MarkerCommand,
  msg: Record<string, unknown>,
  pid: number,
): void {
  switch (command) {
    case 'setMarker':
      if (typeof msg.id === 'number' && typeof msg.marker === 'number')
        sim.setMarker(msg.id, msg.marker, pid);
      return;
    case 'clearMarker':
      if (typeof msg.id === 'number') sim.clearMarker(msg.id, pid);
      return;
    case 'map_mark_set':
      if (isInt(msg.page) && isNum(msg.x) && isNum(msg.z) && isInt(msg.symbol))
        sim.placeSharedMapMark(msg.page, msg.x, msg.z, msg.symbol, pid);
      return;
    case 'map_mark_place':
      if (isInt(msg.page) && isNum(msg.x) && isNum(msg.y) && isNum(msg.z) && isInt(msg.symbol))
        sim.placeSharedWorldMark(msg.page, msg.x, msg.y, msg.z, msg.symbol, pid);
      return;
    case 'map_mark_clear':
      if (msg.symbol === null || isInt(msg.symbol)) sim.clearSharedMapMarks(msg.symbol, pid);
      return;
    case 'ping':
      // A unit ping carries the unit (its point is the sim's); a ground ping a finite point.
      if (
        isInt(msg.kind) &&
        (msg.target === null || isInt(msg.target)) &&
        isNum(msg.x) &&
        isNum(msg.y) &&
        isNum(msg.z)
      )
        sim.sendPing(msg.kind, msg.target, msg.x, msg.y, msg.z, pid);
      return;
  }
}
