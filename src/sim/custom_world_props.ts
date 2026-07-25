import { EASTBROOK_LAYOUT } from './eastbrook_layout';
import type { ZonePropsDef } from './types';

const EASTBROOK_BUILDING_IDS = new Set<string>([
  ...EASTBROOK_LAYOUT.preservedBuildings.map((placement) => placement.id),
  ...EASTBROOK_LAYOUT.buildings.map((placement) => placement.id),
]);
const EASTBROOK_WELL_IDS = new Set<string>([EASTBROOK_LAYOUT.civic.wellBeacon.id]);
const EASTBROOK_STALL_IDS = new Set<string>(
  EASTBROOK_LAYOUT.market.stalls.map((placement) => placement.id),
);
const EASTBROOK_FENCE_IDS = new Set<string>(
  EASTBROOK_LAYOUT.fences.map((placement) => placement.id),
);
const EASTBROOK_BENCH_IDS = new Set<string>(
  EASTBROOK_LAYOUT.civic.benches.map((placement) => placement.id),
);
const EASTBROOK_WALL_IDS = new Set<string>(
  EASTBROOK_LAYOUT.wall.segments.map((placement) => placement.id),
);

function cloneRecords<T extends object>(records: readonly T[]): T[] {
  return records.map((record) => ({ ...record }));
}

function cloneRecordsWithoutIds<T extends { id?: string }>(
  records: readonly T[],
  excludedIds: ReadonlySet<string>,
): T[] {
  return records
    .filter((record) => record.id === undefined || !excludedIds.has(record.id))
    .map((record) => ({ ...record }));
}

/**
 * Clone built-in static props for a custom world while omitting only the
 * canonical Eastbrook layout. Other Vale props and every later-zone placement
 * remain available to custom maps that start from the built-in world.
 */
export function clonePropsWithoutEastbrookLayout(source: ZonePropsDef): ZonePropsDef {
  const eastbrookGraveyard = EASTBROOK_LAYOUT.services.graveyard.position;
  const result: ZonePropsDef = {
    buildings: cloneRecordsWithoutIds(source.buildings, EASTBROOK_BUILDING_IDS),
    wells: cloneRecordsWithoutIds(source.wells, EASTBROOK_WELL_IDS),
    stalls: cloneRecordsWithoutIds(source.stalls, EASTBROOK_STALL_IDS),
    mines: cloneRecords(source.mines),
    docks: source.docks.map((dock) => ({ ...dock, hutLocal: { ...dock.hutLocal } })),
    tents: cloneRecords(source.tents),
    crates: source.crates.map(([x, z]) => [x, z]),
    campfires: source.campfires.map(([x, z]) => [x, z]),
    mudHuts: source.mudHuts.map(([x, z]) => [x, z]),
    ruinRings: cloneRecords(source.ruinRings),
    fences: cloneRecordsWithoutIds(source.fences, EASTBROOK_FENCE_IDS),
    graveyards: source.graveyards
      .filter(({ x, z }) => x !== eastbrookGraveyard.x || z !== eastbrookGraveyard.z)
      .map((graveyard) => ({ ...graveyard })),
  };
  if (source.benches) {
    result.benches = cloneRecordsWithoutIds(source.benches, EASTBROOK_BENCH_IDS);
  }
  if (source.walls) {
    result.walls = cloneRecordsWithoutIds(source.walls, EASTBROOK_WALL_IDS);
  }
  if (source.delveMarkers) result.delveMarkers = cloneRecords(source.delveMarkers);
  return result;
}
