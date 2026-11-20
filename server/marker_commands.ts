// The raid-marker command family off the dispatch switch in server/game.ts:
// the target markers (setMarker / clearMarker, byte-identical to the cases they
// replace) and the raid map's shared marks (map_mark_set / map_mark_clear).
// This layer only checks wire SHAPE (types, finiteness) and drops anything
// else; the Sim (src/sim/social/shared_map_marks.ts, src/sim/targeting.ts)
// owns every rule: group membership, the instance the sender stands in, edit
// rights, bounds, the symbol and page ranges and the per-group rate limit. The
// socket's command lane bounds the frame rate before any of this runs.

import type { Sim } from '../src/sim/sim';

export type MarkerCommand = 'setMarker' | 'clearMarker' | 'map_mark_set' | 'map_mark_clear';

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
    case 'map_mark_clear':
      if (msg.symbol === null || isInt(msg.symbol)) sim.clearSharedMapMarks(msg.symbol, pid);
      return;
  }
}
