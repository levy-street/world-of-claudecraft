// Rivalmoot (The Quartered Isle): the challengers' town on its rise at the
// foot of the Gyre's climb, above the great crater, built new in the
// painted brick look. Four buildings stand between the four roads that leave
// the plaza due south (down to the crater), east, west and north (onto the
// Gyre's path): the inn north-west, the Moot Hall (a chapel kind, the town's
// meeting hall) north-east, the outfitter's shop south-west and the Gilded
// Strongbox's counting house south-east, its bursar at the door. Every pad
// stands at the rise's own height (10), so the town reads as one level top. A pure,
// frozen data/geometry module: no engine imports, no randomness, no clocks
// (sim/painted_towns/CLAUDE.md).
import {
  deepFreeze,
  indexById,
  levelTownPads,
  localToWorld,
  makeTownNpc,
  type TownGround,
} from '../placed_town_kit';
import { paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

const LOOK = 'brick' as const;
const NORTH_FACING = Math.PI; // the door looks north (+z)
const SOUTH_FACING = 0; // the door looks south (-z)
const WEST_FACING = -Math.PI / 2; // the door looks west (+x)

// The rise's height: the hub flatten's 3 plus Rivalmoot's rise of 7
// (quartered_isle_terrain.ts RIVALMOOT_HILL).
const PLATEAU = 10;

// The inn: north-west of the plaza, between the Wilds road and the north
// road, its door toward the square.
const INN = paintedTownBuilding({
  id: 'rivalmoot_inn',
  kind: 'inn',
  model: 'tavern',
  look: LOOK,
  anchor: { x: -18, z: 2266 },
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
  anchor: { x: 16, z: 2266 },
  rotation: SOUTH_FACING,
  scale: 1,
});
// The outfitter's shop: south-west of the plaza between the crater road and
// the Wilds road, its counter facing the square.
const SHOP = paintedTownBuilding({
  id: 'rivalmoot_outfitters',
  kind: 'house',
  model: 'shop_a',
  look: LOOK,
  anchor: { x: -16, z: 2232 },
  rotation: NORTH_FACING,
  scale: 1,
});

// The Gilded Strongbox's counting house: south-east of the plaza beside the
// Cinderscar road, the same banking hall Eastbrook keeps (the stock painted
// bank, not a brick bake: the bank builds every branch alike). It fills the
// corner, so the challengers' camp lies across the crater road behind the
// outfitter's. Its bursar stands a few strides out from the door, beside its
// line, as Eastbrook's does.
const BANK = paintedTownBuilding({
  id: 'rivalmoot_strongbox',
  kind: 'house',
  model: 'bank',
  look: 'default',
  anchor: { x: 18.5, z: 2232 },
  rotation: NORTH_FACING,
  scale: 1,
});
const BURSAR_STAND = localToWorld(BANK.frontStandingPoint, BANK.rotation, 3.4, -1.6);

const BUILDINGS = [INN, HALL, SHOP, BANK] as const;

const NPCS = [
  // the bursar before the counting house door, looking out at the east road
  makeTownNpc('bursar_maud_ashby', BURSAR_STAND, BANK.frontFacing, BANK.id),
] as const;

const GROUND: readonly TownGround[] = [
  { building: INN, height: PLATEAU, columns: 3, rows: 2, taper: 4, apron: 7 },
  { building: HALL, height: PLATEAU, columns: 2, rows: 3, taper: 4, apron: 7 },
  { building: SHOP, height: PLATEAU, columns: 2, rows: 2, taper: 4, apron: 6 },
  { building: BANK, height: PLATEAU, columns: 3, rows: 3, taper: 4, apron: 5 },
];

export const RIVALMOOT_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'rivalmoot',
  layoutId: 'rivalmoot_painted_v1',
  zoneId: 'quartered_isle',
  hub: { center: { x: 0, z: 2248 }, radius: 24 },
  buildings: BUILDINGS,
  // Built new: no kit records or decor rows came before it.
  replacedKitBuildings: [],
  replacedDecorProps: [],
  pads: levelTownPads(GROUND),
  npcs: NPCS,
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const RIVALMOOT_BUILDINGS_BY_ID = indexById(RIVALMOOT_LAYOUT.buildings);
export const RIVALMOOT_NPC_PLACEMENTS_BY_ID = indexById(RIVALMOOT_LAYOUT.npcs);
