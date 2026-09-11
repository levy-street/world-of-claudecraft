import { EASTBROOK_LAYOUT } from './eastbrook_layout';
import { FENBRIDGE_LAYOUT } from './fenbridge_layout';
import type { ZonePropsDef } from './types';

const EASTBROOK_BUILDING_IDS = new Set<string>([
  ...EASTBROOK_LAYOUT.preservedBuildings.map((placement) => placement.id),
  ...EASTBROOK_LAYOUT.buildings.map((placement) => placement.id),
]);
const EASTBROOK_WELL_IDS = new Set<string>([EASTBROOK_LAYOUT.civic.monument.id]);
const EASTBROOK_STALL_IDS = new Set<string>(
  EASTBROOK_LAYOUT.market.stalls.map((placement) => placement.id),
);
const BUILTIN_ONLY_BUILDING_IDS = new Set<string>([
  ...EASTBROOK_BUILDING_IDS,
  ...FENBRIDGE_LAYOUT.buildings.map((placement) => placement.id),
]);
const BUILTIN_ONLY_WELL_IDS = new Set<string>([
  ...EASTBROOK_WELL_IDS,
  FENBRIDGE_LAYOUT.civic.cistern.id,
]);
const BUILTIN_ONLY_STALL_IDS = new Set<string>([
  ...EASTBROOK_STALL_IDS,
  FENBRIDGE_LAYOUT.civic.provisionStall.id,
]);
const EASTBROOK_FENCE_IDS = new Set<string>(
  EASTBROOK_LAYOUT.fences.map((placement) => placement.id),
);
const EASTBROOK_BENCH_IDS = new Set<string>(
  EASTBROOK_LAYOUT.civic.benches.map((placement) => placement.id),
);
const EASTBROOK_WALL_IDS = new Set<string>(
  EASTBROOK_LAYOUT.wall.segments.map((placement) => placement.id),
);
const BUILTIN_ONLY_WALL_IDS = new Set<string>([
  ...EASTBROOK_WALL_IDS,
  ...FENBRIDGE_LAYOUT.wall.segments.map((placement) => placement.id),
]);

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
 * Clone built-in static props for a custom world while omitting specialized
 * built-in-only placements. Other Vale props and later-zone placements whose
 * regular prop renderers remain active are fresh-cloned into the custom world.
 */
/**
 * Editor variant: keep the authored-town records (Eastbrook Vale, Fenbridge)
 * that the plain clone strips.
 *
 * They are stripped for a custom world because upstream draws those towns ONLY
 * for BUILTIN_WORLD, so a custom world carrying their records would render
 * nothing there. Studio is the case that breaks: its documents are copies of
 * the built-in world, and with the records gone the authored subtrees have
 * nothing to gate on and the generic kit stand-ins draw instead, the starting
 * village showed pre-rebuild brown houses while the live game showed the
 * white-and-blue town. Keeping the records lets authored_town_gate.ts resolve
 * true and the real art draw, exactly as the game does.
 */
export function clonePropsKeepingAuthoredTowns(source: ZonePropsDef): ZonePropsDef {
  // ONLY the four categories props.ts has a matching skip for. Benches, walls
  // and the town graveyard are drawn by the authored subtree with NO skip on
  // the generic path, so restoring those would double them instead of fixing
  // anything, they stay stripped exactly as the plain clone leaves them.
  return {
    ...clonePropsWithoutEastbrookLayout(source),
    buildings: cloneRecords(source.buildings),
    wells: cloneRecords(source.wells),
    stalls: cloneRecords(source.stalls),
    fences: cloneRecords(source.fences),
  };
}

export function clonePropsWithoutEastbrookLayout(source: ZonePropsDef): ZonePropsDef {
  const eastbrookGraveyard = EASTBROOK_LAYOUT.services.graveyard.position;
  const result: ZonePropsDef = {
    // Spread FIRST so a props category this function does not name survives.
    // It used to rebuild an explicit key list, which meant every category
    // upstream added after it was written vanished from every custom world
    // without a word: v0.39's decorProps (243 of them) and raceCourse were
    // simply gone from the editor, and nobody could tell from the map data
    // because the loss happened in the projection. Same rule propsWithinRect
    // already documents: an unrecognised key passes through untouched rather
    // than disappearing.
    ...source,
    buildings: cloneRecordsWithoutIds(source.buildings, BUILTIN_ONLY_BUILDING_IDS),
    wells: cloneRecordsWithoutIds(source.wells, BUILTIN_ONLY_WELL_IDS),
    stalls: cloneRecordsWithoutIds(source.stalls, BUILTIN_ONLY_STALL_IDS),
    mines: cloneRecords(source.mines),
    docks: source.docks.map((dock) => ({ ...dock, hutLocal: { ...dock.hutLocal } })),
    tents: cloneRecords(source.tents),
    marshReeds: source.marshReeds.map(([x, z]) => [x, z]),
    crates: source.crates.map(([x, z, stack]) => (stack === undefined ? [x, z] : [x, z, stack])),
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
    result.walls = cloneRecordsWithoutIds(source.walls, BUILTIN_ONLY_WALL_IDS);
  }
  if (source.delveMarkers) result.delveMarkers = cloneRecords(source.delveMarkers);
  return result;
}
