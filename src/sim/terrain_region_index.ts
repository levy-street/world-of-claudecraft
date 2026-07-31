export const TERRAIN_REGION_CELL_SIZE = 128;
const MAX_APPLIERS = 64;
const MAX_CELLS_PER_BOUND = 1_000_000;

export interface TerrainRegionBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface TerrainRegionCell {
  readonly maskLow: number;
  readonly maskHigh: number;
  readonly campIndices: readonly number[];
  readonly hubIndices: readonly number[];
}

export interface TerrainRegionIndex {
  readonly rows: ReadonlyMap<number, ReadonlyMap<number, TerrainRegionCell>>;
  readonly always: TerrainRegionCell;
  readonly full: TerrainRegionCell;
}

export const TERRAIN_APPLIER = {
  mirefenImpactCrater: 0,
  hollowShaping: 1,
  emberShaping: 2,
  frostMassif: 3,
  amberShelf: 4,
  nightCaldera: 5,
  palmCone: 6,
  hollowCoast: 7,
  emberCoast: 8,
  frostCoast: 9,
  amberCoast: 10,
  fenCoast: 11,
  nightCoast: 12,
  woodCoast: 13,
  reachCoast: 14,
  gardenCoast: 15,
  galeCoast: 16,
  valeCoast: 17,
  isleCoast: 18,
  causeway: 19,
  starterMoat: 20,
  columnStraits: 21,
  stripFlankCoast: 22,
  rowMeres: 23,
  northBay: 24,
  emberLavaNetwork: 25,
  emberLavaBasins: 26,
  drakemawEscape: 27,
  eastConeBreach: 28,
  frostTerraces: 29,
  fenBraids: 30,
  glacierTarnRamp: 31,
  sowfieldFlatten: 32,
  stableFlatten: 33,
} as const;

function bounds(minX: number, maxX: number, minZ: number, maxZ: number): TerrainRegionBounds {
  return { minX, maxX, minZ, maxZ };
}

// Each finite box includes the applier's complete early-out, falloff, or
// smoothstep support. Appliers with an h-dependent or unbounded support stay
// in the always-run mask. The index adds one more 128yd guard cell per side.
export const TERRAIN_APPLIER_BOUNDS: readonly (readonly TerrainRegionBounds[] | null)[] = [
  [bounds(119.5, 179.5, 265, 325)],
  [bounds(-200, 154, 970, 1241)],
  null,
  [bounds(-176, 176, 1500, 1940)],
  [bounds(-306, -172, 1860, 2098)],
  [bounds(-368, -232, 1532, 1668)],
  [bounds(-380, -308, 966, 1038)],
  [bounds(-188, 210, 940, 1448)],
  [bounds(172, 566, 1812, 2428)],
  [bounds(-188, 188, 1432, 1968)],
  [bounds(-566, -172, 1812, 2388)],
  [bounds(-566, -172, 172, 708)],
  [bounds(-566, -172, 1252, 1828)],
  [bounds(172, 566, 1252, 1828)],
  [bounds(-566, -172, 692, 1268)],
  [bounds(172, 566, 692, 1268)],
  [bounds(172, 566, 172, 708)],
  null,
  [bounds(166, 566, -188, 188)],
  [bounds(126, 262, -80, 60)],
  null,
  null,
  [bounds(-180, -124, 940, 1925), bounds(124, 180, 940, 1925)],
  null,
  null,
  [bounds(260, 480, 2160, 2360)],
  [bounds(253.2, 501.4, 2193.6, 2385.4)],
  [bounds(367, 413, 2266, 2343)],
  [bounds(449, 525, 2318, 2394)],
  [bounds(-178, 178, 1460, 1960)],
  [bounds(-380, -184, 240, 620)],
  [bounds(25.5, 57, 1631.5, 1649)],
  [bounds(-64, 42, -149, -75)],
  [bounds(320, 436, 536, 616)],
];

interface MutableCell {
  maskLow: number;
  maskHigh: number;
  campIndices: number[];
  hubIndices: number[];
}

interface BuildOptions {
  applierBounds: readonly (readonly TerrainRegionBounds[] | null)[];
  campBounds: readonly TerrainRegionBounds[];
  hubBounds: readonly TerrainRegionBounds[];
}

function addBit(cell: MutableCell, id: number): void {
  if (id < 32) cell.maskLow |= 1 << id;
  else cell.maskHigh |= 1 << (id - 32);
}

function validCellRange(bounds: TerrainRegionBounds): [number, number, number, number] | null {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.minZ) ||
    !Number.isFinite(bounds.maxZ) ||
    bounds.minX > bounds.maxX ||
    bounds.minZ > bounds.maxZ
  ) {
    return null;
  }
  // Every declared bound already includes its applier's complete falloff.
  // One full guard cell on each side is the conservative index margin, so a
  // missing bit proves the applier is an exact no-op for every point there.
  const x0 = Math.floor(bounds.minX / TERRAIN_REGION_CELL_SIZE) - 1;
  const x1 = Math.floor(bounds.maxX / TERRAIN_REGION_CELL_SIZE) + 1;
  const z0 = Math.floor(bounds.minZ / TERRAIN_REGION_CELL_SIZE) - 1;
  const z1 = Math.floor(bounds.maxZ / TERRAIN_REGION_CELL_SIZE) + 1;
  const count = (x1 - x0 + 1) * (z1 - z0 + 1);
  if (!Number.isSafeInteger(count) || count > MAX_CELLS_PER_BOUND) return null;
  return [x0, x1, z0, z1];
}

export function buildTerrainRegionIndex(options: BuildOptions): TerrainRegionIndex {
  if (options.applierBounds.length > MAX_APPLIERS) {
    throw new Error(`terrain region index supports at most ${MAX_APPLIERS} appliers`);
  }

  const rows = new Map<number, Map<number, MutableCell>>();
  const mutableCellAt = (x: number, z: number): MutableCell => {
    let row = rows.get(z);
    if (!row) {
      row = new Map();
      rows.set(z, row);
    }
    let cell = row.get(x);
    if (!cell) {
      cell = { maskLow: 0, maskHigh: 0, campIndices: [], hubIndices: [] };
      row.set(x, cell);
    }
    return cell;
  };
  const forCells = (bounds: TerrainRegionBounds, visit: (cell: MutableCell) => void): boolean => {
    const range = validCellRange(bounds);
    if (!range) return false;
    const [x0, x1, z0, z1] = range;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) visit(mutableCellAt(x, z));
    }
    return true;
  };

  const alwaysMutable: MutableCell = {
    maskLow: 0,
    maskHigh: 0,
    campIndices: [],
    hubIndices: [],
  };
  for (let id = 0; id < options.applierBounds.length; id++) {
    const boundsList = options.applierBounds[id];
    if (boundsList === null || boundsList.some((bounds) => validCellRange(bounds) === null)) {
      addBit(alwaysMutable, id);
      continue;
    }
    for (const bounds of boundsList) {
      forCells(bounds, (cell) => addBit(cell, id));
    }
  }
  for (let id = 0; id < options.campBounds.length; id++) {
    if (!forCells(options.campBounds[id], (cell) => cell.campIndices.push(id))) {
      alwaysMutable.campIndices.push(id);
    }
  }
  for (let id = 0; id < options.hubBounds.length; id++) {
    if (!forCells(options.hubBounds[id], (cell) => cell.hubIndices.push(id))) {
      alwaysMutable.hubIndices.push(id);
    }
  }

  const freezeCell = (cell: MutableCell): TerrainRegionCell =>
    Object.freeze({
      maskLow: cell.maskLow | alwaysMutable.maskLow,
      maskHigh: cell.maskHigh | alwaysMutable.maskHigh,
      campIndices: Object.freeze(
        [...alwaysMutable.campIndices, ...cell.campIndices].sort((a, b) => a - b),
      ),
      hubIndices: Object.freeze(
        [...alwaysMutable.hubIndices, ...cell.hubIndices].sort((a, b) => a - b),
      ),
    });

  const frozenRows = new Map<number, ReadonlyMap<number, TerrainRegionCell>>();
  for (const [z, row] of rows) {
    const frozenRow = new Map<number, TerrainRegionCell>();
    for (const [x, cell] of row) frozenRow.set(x, freezeCell(cell));
    frozenRows.set(z, frozenRow);
  }

  const always = freezeCell({ maskLow: 0, maskHigh: 0, campIndices: [], hubIndices: [] });
  const fullMutable: MutableCell = {
    maskLow: 0,
    maskHigh: 0,
    campIndices: [],
    hubIndices: [],
  };
  for (let id = 0; id < options.applierBounds.length; id++) addBit(fullMutable, id);

  return {
    rows: frozenRows,
    always,
    full: Object.freeze({
      maskLow: fullMutable.maskLow,
      maskHigh: fullMutable.maskHigh,
      campIndices: Object.freeze(options.campBounds.map((_, index) => index)),
      hubIndices: Object.freeze(options.hubBounds.map((_, index) => index)),
    }),
  };
}

export function terrainRegionCellAt(
  index: TerrainRegionIndex,
  x: number,
  z: number,
): TerrainRegionCell {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return index.full;
  const cellX = Math.floor(x / TERRAIN_REGION_CELL_SIZE);
  const cellZ = Math.floor(z / TERRAIN_REGION_CELL_SIZE);
  return index.rows.get(cellZ)?.get(cellX) ?? index.always;
}

export function terrainRegionHas(cell: TerrainRegionCell, id: number): boolean {
  return id < 32 ? (cell.maskLow & (1 << id)) !== 0 : (cell.maskHigh & (1 << (id - 32))) !== 0;
}
