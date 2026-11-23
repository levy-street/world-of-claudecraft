// Icemantle (The Frostveil Reach): the painted rebuild of the town's kit houses,
// in the Highwatch look (Alpine slate). The plaza keeps every service it had
// (the well and the great fire, the four stalls and their crates, Warden
// Kaldra, the mailbox, the board, the Frostveil Barrow); the buildings ring it
// between its four roads: the Hearth-Lodge south, the trade hall west, the
// chapel north behind the graves, a house on the high shelf north-east, and
// the east side open over the sea cliff. A pure, frozen data/geometry module:
// no engine imports, no randomness, no clocks (sim/painted_towns/CLAUDE.md).
import {
  deepFreeze,
  indexById,
  levelTownPads,
  makeTownNpc,
  type TownGround,
} from '../placed_town_kit';
import { paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

const LOOK = 'highwatch' as const;
const SOUTH_FACING = 0; // the door looks south (-z)
const NORTH_FACING = Math.PI; // the door looks north (+z)
const EAST_FACING = Math.PI / 2; // the door looks east (-x)
const WEST_FACING = -Math.PI / 2; // the door looks west (+x)

// The Hearth-Lodge: south of the plaza on the shelf above the sea cliff, its
// long front and door on the plaza at the plaza's own height. It stands at 1.0,
// not the grand 1.2: between the pass road and the sea cliff the promontory is
// about 38 yd across, and the 36 yd lodge at 1.2 runs onto the road or sends
// its pads over the cliff into the sea in every position and turn; the other
// sides of the plaza are narrower still (the cove and the wolves' benches to
// the west and north-west, the Shiverfen road to the north). Its door still
// clears 4.4 yd.
const INN = paintedTownBuilding({
  id: 'icemantle_hearth_lodge',
  kind: 'inn',
  model: 'tavern_b',
  look: LOOK,
  anchor: { x: -39.05, z: 1529.92 },
  rotation: NORTH_FACING,
  scale: 1,
});
// The chapel: north of the plaza behind the Frostveil Barrow, between the tarn
// road and the Shiverfen road, its door and bell tower over the graves.
const CHAPEL = paintedTownBuilding({
  id: 'icemantle_chapel',
  kind: 'chapel',
  model: 'hall',
  look: LOOK,
  anchor: { x: -27.9, z: 1600.83 },
  rotation: SOUTH_FACING,
  scale: 1.2,
});
// The trade hall (the kit 'inn' record that stood for it): west of the plaza
// between the tarn road and the pass road, its counter and door on the market.
const TRADE_HALL = paintedTownBuilding({
  id: 'icemantle_trade_hall',
  kind: 'house',
  model: 'shop_a',
  look: LOOK,
  anchor: { x: -3.65, z: 1554 },
  rotation: EAST_FACING,
  scale: 1.5,
});
// A house on the high shelf across the Shiverfen road from the chapel (sealed),
// its door on the road.
const SHELF_HOUSE = paintedTownBuilding({
  id: 'icemantle_shelf_house',
  kind: 'house',
  model: 'house_c',
  look: LOOK,
  anchor: { x: -68.06, z: 1598 },
  rotation: WEST_FACING,
  scale: 1.4,
});

const BUILDINGS = [INN, CHAPEL, TRADE_HALL, SHELF_HOUSE] as const;

// Each building's pad and its apron. The lodge stands at the plaza's own
// height (3.0) with a small apron that stays off the sea-cliff face; the trade
// hall sits on the low ground west of the plaza (1.5), the chapel in the dip
// behind the graves (2.5), the house on the high shelf (5.5).
const GROUND: readonly TownGround[] = [
  { building: INN, height: 3, columns: 4, rows: 3, taper: 4, apron: 6 },
  { building: CHAPEL, height: 2.5, columns: 2, rows: 3, taper: 4, apron: 8 },
  { building: TRADE_HALL, height: 1.5, columns: 2, rows: 2, taper: 4, apron: 8 },
  { building: SHELF_HOUSE, height: 5.5, columns: 2, rows: 2, taper: 4, apron: 6 },
];

// Hearthkeeper Maeve keeps the lodge (her old spot was the kit lodge's door): a
// stride out from its door, on the plaza's edge, so she stands a yard inside
// the hub circle and her errands stay town quests (the door's own standing
// point is 21.9 yd out, of the circle's 22).
const MAEVE = { x: INN.frontStandingPoint.x, z: INN.frontStandingPoint.z + 1 };
const NPCS = [makeTownNpc('hearthkeeper_maeve', MAEVE, INN.frontFacing, INN.id)];

export const ICEMANTLE_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'icemantle',
  layoutId: 'icemantle_painted_v1',
  zoneId: 'frostveil',
  hub: { center: { x: -30, z: 1560 }, radius: 22 },
  buildings: BUILDINGS,
  replacedKitBuildings: [
    { kind: 'inn', x: -42, z: 1554, w: 6, d: 7, rot: 0.9 }, // the Hearth-Lodge
    { kind: 'house', x: -20, z: 1550, w: 6, d: 6, rot: -0.5 },
    { kind: 'house', x: -40, z: 1572, w: 6, d: 6, rot: 2.2 },
    { kind: 'chapel', x: -18, z: 1570, w: 5, d: 7, rot: -2.0 },
    { kind: 'house', x: -30, z: 1544, w: 5, d: 5, rot: 0.1 }, // the fisher's hut
    { kind: 'house', x: -44, z: 1563, w: 5, d: 5, rot: 1.4 },
    { kind: 'inn', x: -22, z: 1578, w: 5, d: 6, rot: -2.6 }, // the trade hall
  ],
  replacedDecorProps: [],
  pads: levelTownPads(GROUND),
  npcs: NPCS,
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const ICEMANTLE_BUILDINGS_BY_ID = indexById(ICEMANTLE_LAYOUT.buildings);
export const ICEMANTLE_NPC_PLACEMENTS_BY_ID = indexById(ICEMANTLE_LAYOUT.npcs);
