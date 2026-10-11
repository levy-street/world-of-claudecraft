import type { VehicleStationDef, WorldQuestDef } from '../types';

// Wyrmwatch placement preview. Preserve the original IDs and completion claims.
export const NORTH_WATCH_CANNON: Readonly<VehicleStationDef> = {
  id: 'north_watch_cannon',
  entityId: 9_400_010,
  questId: 'wq_evergarden_cannon',
  // Moved north-west of the release's Wyrmwatch church, which now stands on
  // the old battery at (390, 1870). The field is 26 wide: the wave lanes need
  // 25 yards to keep simultaneous bodies a yard apart.
  x: 384,
  z: 1862,
  field: { minX: 375, maxX: 401, minZ: 1812, maxZ: 1852 },
};

export const WORLD_QUEST_CANNON: WorldQuestDef = {
  id: NORTH_WATCH_CANNON.questId,
  zoneId: 'drakelands',
  minLevel: 16,
  area: { x: 384, z: 1842, radius: 48 },
  objective: { type: 'vehicle', stationId: NORTH_WATCH_CANNON.id },
  count: 1,
};

export const LAST_KEEP_CANNON: Readonly<VehicleStationDef> = {
  id: 'last_keep_cannon',
  entityId: 9_400_011,
  questId: 'wq_last_keep_cannon',
  x: 375,
  z: 1964,
  field: { minX: 364, maxX: 386, minZ: 1912, maxZ: 1952 },
};

export const WORLD_QUEST_LAST_KEEP_CANNON: WorldQuestDef = {
  ...WORLD_QUEST_CANNON,
  id: LAST_KEEP_CANNON.questId,
  area: { x: 375, z: 1944, radius: 48 },
  objective: { type: 'vehicle', stationId: LAST_KEEP_CANNON.id },
};

export const VEHICLE_STATIONS: readonly Readonly<VehicleStationDef>[] = [
  NORTH_WATCH_CANNON,
  LAST_KEEP_CANNON,
];
