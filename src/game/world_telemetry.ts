// Zone identity for fleet perf reports (packet 0 ruling R4). Instance-aware
// following the instance_music.ts pattern: the overworld reports the
// zoneAt(x, z) id, and every far-off instance x-band reports a bounded id
// (dungeon:<id>, delve:<id>, arena, yumi_maze, battleground) so the
// crowded-town signal
// never mixes with raid interiors. Every emitted id comes from the fixed
// content catalogs, keeping the fleet dimension's cardinality bounded. Pure
// module: main.ts wires it into the reporter as a one-line provider closure.

import {
  DUNGEON_X_THRESHOLD,
  delveAt,
  dungeonAt,
  isArenaPos,
  isBgPos,
  isDelvePos,
  isYumiMazePos,
  zoneAt,
} from '../sim/data';

export interface WorldTelemetry {
  zoneId: string;
  simEntities: number;
}

export function telemetryZoneId(x: number, z: number): string {
  if (x <= DUNGEON_X_THRESHOLD) return zoneAt(x, z).id;
  if (isDelvePos(x)) return `delve:${delveAt(x)?.id ?? 'unknown'}`;
  if (isArenaPos(x)) return 'arena';
  if (isYumiMazePos(x)) return 'yumi_maze';
  if (isBgPos(x)) return 'battleground';
  const dungeon = dungeonAt(x);
  return dungeon ? `dungeon:${dungeon.id}` : 'instance';
}
