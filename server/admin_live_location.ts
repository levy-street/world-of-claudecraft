// The admin live-players panel's location readout for one entity, moved out of
// server/game.ts under the monolith ratchet: a pure function of the sim's instance and
// delve lookups plus the static zone/dungeon/delve tables, so it needs no GameServer
// state. Dungeon first (a claimed slot or a door-stamped id), then a delve run, else the
// overworld zone with its nearest named POI inside ADMIN_LOCATION_POI_RADIUS.

import { DELVES, DUNGEONS, zoneAt } from '../src/sim/data';
import type { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { round2 } from './tick_perf_log';

const ADMIN_LOCATION_POI_RADIUS = 32;

export interface AdminLiveLocation {
  kind: 'overworld' | 'dungeon' | 'delve';
  zoneId: string | null;
  zone: string;
  instanceId: string | null;
  instance: string | null;
  instanceSlot: number | null;
  poiIndex: number | null;
  poi: string | null;
  poiDistance: number | null;
}

export function adminLiveLocation(
  sim: Pick<Sim, 'instanceInfoAt' | 'delveRunForPlayer'>,
  e: Entity,
): AdminLiveLocation {
  const instance = sim.instanceInfoAt(e.pos);
  const dungeonId = e.dungeonId ?? instance?.dungeonId ?? null;
  if (dungeonId) {
    const dungeon = DUNGEONS[dungeonId];
    const zone = dungeon ? zoneAt(dungeon.doorPos.x, dungeon.doorPos.z) : zoneAt(e.pos.x, e.pos.z);
    return {
      kind: 'dungeon',
      zoneId: zone.id,
      zone: zone.name,
      instanceId: dungeonId,
      instance: dungeon?.name ?? dungeonId,
      instanceSlot: instance?.slot ?? null,
      poiIndex: null,
      poi: null,
      poiDistance: null,
    };
  }

  const delveRun = sim.delveRunForPlayer(e.id);
  if (delveRun) {
    const delve = DELVES[delveRun.delveId];
    const zone = delve ? zoneAt(delve.doorPos.x, delve.doorPos.z) : zoneAt(e.pos.x, e.pos.z);
    return {
      kind: 'delve',
      zoneId: zone.id,
      zone: zone.name,
      instanceId: delveRun.delveId,
      instance: delve?.name ?? delveRun.delveId,
      instanceSlot: delveRun.slot,
      poiIndex: null,
      poi: null,
      poiDistance: null,
    };
  }

  const zone = zoneAt(e.pos.x, e.pos.z);
  let bestIndex: number | null = null;
  let bestDistance = ADMIN_LOCATION_POI_RADIUS;
  for (let i = 0; i < zone.pois.length; i++) {
    const poi = zone.pois[i];
    const distance = Math.hypot(e.pos.x - poi.x, e.pos.z - poi.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  const poi = bestIndex === null ? null : zone.pois[bestIndex];
  return {
    kind: 'overworld',
    zoneId: zone.id,
    zone: zone.name,
    instanceId: null,
    instance: null,
    instanceSlot: null,
    poiIndex: bestIndex,
    poi: poi?.label ?? null,
    poiDistance: poi ? round2(bestDistance) : null,
  };
}
