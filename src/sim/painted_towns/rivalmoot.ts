// Rivalmoot (The Quartered Isle): the challengers' town on the hilltop at the
// island's heart, built new in the painted brick look. Three buildings ring the
// plaza between the four roads that leave it: the inn
// south-west, the Moot Hall (a chapel kind, the town's meeting hall) north-east
// over the graves' side of the hill, and the outfitter's shop south, above the
// hill road that climbs past the Challengers' Ring. Every pad stands at the
// plateau's own height (21), so the hilltop reads as one level town. A pure,
// frozen data/geometry module: no engine imports, no randomness, no clocks
// (sim/painted_towns/CLAUDE.md).
import { deepFreeze, indexById, levelTownPads, type TownGround } from '../placed_town_kit';
import { paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

const LOOK = 'brick' as const;
const NORTH_FACING = Math.PI; // the door looks north (+z)
const SOUTH_FACING = 0; // the door looks south (-z)
const WEST_FACING = -Math.PI / 2; // the door looks west (+x)

// The plateau's height: the hub flatten's 3 plus Rivalmoot's hill rise of 18
// (quartered_isle_terrain.ts RIVALMOOT_HILL).
const PLATEAU = 21;

// The inn: south-west of the plaza, its door on the plaza's west
// side, clear of the Wilds road that leaves north of it.
const INN = paintedTownBuilding({
  id: 'rivalmoot_inn',
  kind: 'inn',
  model: 'tavern',
  look: LOOK,
  anchor: { x: -24, z: 2216 },
  rotation: WEST_FACING,
  scale: 1,
});
// The Moot Hall: north-east of the plaza between the north road and the
// Cinderscar road, its door and bell tower looking down on the square.
const HALL = paintedTownBuilding({
  id: 'rivalmoot_moot_hall',
  kind: 'chapel',
  model: 'hall',
  look: LOOK,
  anchor: { x: 18, z: 2258 },
  rotation: SOUTH_FACING,
  scale: 1,
});
// The outfitter's shop: south of the plaza above the hill road, its counter
// facing the square.
const SHOP = paintedTownBuilding({
  id: 'rivalmoot_outfitters',
  kind: 'house',
  model: 'shop_a',
  look: LOOK,
  anchor: { x: -2, z: 2208 },
  rotation: NORTH_FACING,
  scale: 1,
});

const BUILDINGS = [INN, HALL, SHOP] as const;

const GROUND: readonly TownGround[] = [
  { building: INN, height: PLATEAU, columns: 3, rows: 2, taper: 4, apron: 7 },
  { building: HALL, height: PLATEAU, columns: 2, rows: 3, taper: 4, apron: 7 },
  { building: SHOP, height: PLATEAU, columns: 2, rows: 2, taper: 4, apron: 6 },
];

export const RIVALMOOT_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'rivalmoot',
  layoutId: 'rivalmoot_painted_v1',
  zoneId: 'quartered_isle',
  hub: { center: { x: 0, z: 2235 }, radius: 24 },
  buildings: BUILDINGS,
  // Built new: no kit records or decor rows came before it.
  replacedKitBuildings: [],
  replacedDecorProps: [],
  pads: levelTownPads(GROUND),
  npcs: [],
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const RIVALMOOT_BUILDINGS_BY_ID = indexById(RIVALMOOT_LAYOUT.buildings);
