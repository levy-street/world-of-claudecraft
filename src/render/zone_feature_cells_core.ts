// XZ cell partition for zone-feature placements: which instances of a biome
// dressing family share one cull group.
//
// WHY THIS EXISTS. The zone-feature distance cull (zone_feature_visibility_core
// .ts) works per registered group, on the distance from the camera to the
// group's XZ footprint. A family instanced as ONE mesh over a whole zone has a
// zone-sized footprint, so the cull is all or nothing: from Eastbrook the
// Willowfen dressing's footprint edge sits about 311 yd out, inside the 340 yd
// low fog, and 1.49M triangles of fully fogged reeds, rafts and willows were
// submitted for nine placements that were themselves fogged (scene census,
// 2026-09-08, low, the town view facing the fen). Splitting the placements
// into cells gives every cell its own tight footprint, so the sweep keeps
// only the cells that really reach into the fog, and three's own frustum
// test culls the cells behind the camera inside the zone.
//
// The grid is world-aligned (cell index = floor(coordinate / size)) with no
// origin parameter on purpose: one parameter, deterministic, and reusable by
// every zone-feature module (farshore, gale) without a per-zone rectangle.
// A non-positive size means "one cell": the caller's way of building the
// pre-split layout (the `?fencells=off` census arm). On the far-vista arm the
// cull distance is the detail horizon (700 to 850 yd) and no fen cell lies
// beyond it from Eastbrook, so cells alone buy nothing there; the
// apparent-size reach (zone_feature_visibility_core.ts) is what sheds them.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/zone_feature_cells_core.test.ts.

export interface CellPlacement {
  x: number;
  z: number;
}

export interface PlacementCell<P extends CellPlacement> {
  /** `${cx},${cz}`: the cell's grid indices, stable for a given size. */
  key: string;
  cx: number;
  cz: number;
  /** The placements of this cell, in their source order. */
  spots: P[];
}

/** The grid index of a coordinate for a cell size (world-aligned floor). */
export function cellIndex(coordinate: number, cellSize: number): number {
  return Math.floor(coordinate / cellSize);
}

/**
 * Partition placements into world-aligned XZ cells. Deterministic: cells come
 * out in first-seen order over the source list, and every cell keeps its
 * placements in source order. Every placement lands in exactly one cell. A
 * `cellSize` of zero or less yields one cell (key `0,0`) holding everything.
 */
export function partitionByCell<P extends CellPlacement>(
  spots: readonly P[],
  cellSize: number,
): PlacementCell<P>[] {
  if (spots.length === 0) return [];
  if (!(cellSize > 0)) return [{ key: '0,0', cx: 0, cz: 0, spots: [...spots] }];
  const cells = new Map<string, PlacementCell<P>>();
  for (const spot of spots) {
    const cx = cellIndex(spot.x, cellSize);
    const cz = cellIndex(spot.z, cellSize);
    const key = `${cx},${cz}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { key, cx, cz, spots: [] };
      cells.set(key, cell);
    }
    cell.spots.push(spot);
  }
  return [...cells.values()];
}
