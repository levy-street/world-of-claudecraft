// Wickharbor (The Galecrest): the coast's harbour town, its kit houses and its
// blue-roofed hexagon-kit quarter replaced by five painted Tidehold buildings,
// in the brick look (harbour colours, brick walls, slate roofs). A pure,
// frozen data/geometry module: no engine imports, no randomness, no clocks
// (sim/painted_towns/CLAUDE.md).
//
// The town stands on a flat shelf (the square at 2.5) between the harbour bay
// under its bluff (west), the sea cliffs (south) and a cove (north), where four
// roads meet: the Windway road in from the pass (east), the downs road
// (east-south-east), the beacon road down to the dock district and the Old
// Beacon (south-west) and the cliff road north past the shoal scuttlers' camp.
// The hexagon quarter (the town hall, the market hall, the shore tavern, the
// workshop, four homes) and the six kit records gave way to: the inn on the
// square's south side where the town hall stood, the smithy on the north-east
// corner where the workshop stood, the market hall on the north-west corner by
// the harbour market, and two houses down the roads in. The square keeps
// everything it had (the well, the fire, the two stalls, the mailbox, the
// board, Harbormaster Odile), the harbour keeps its stalls, braziers, cargo,
// boats, shipyard, anchor and ship monument, and Galecrest Rest keeps its
// walled churchyard. No town hall: the hall model fits only the square's
// north-east corner, the workshop's own ground the smithy holds.
import { deepFreeze, indexById, levelTownPads, type TownGround } from '../placed_town_kit';
import { paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

const LOOK = 'brick' as const;

// The models face local -Z (rotation 0 turns the door south, -z; PI north,
// +z; PI / 2 east, -x; -PI / 2 west, +x: this world's east is -x).
const SOUTH_FACING = 0;
const NORTH_FACING = Math.PI;

// The harbour inn (tavern, 1.2: the door clears 5.3): the square's south side,
// where the town hall stood, its long front and door on the square (the board
// and the south stall before it) and its back to the sea cliffs, the
// churchyard at its east end.
const INN = paintedTownBuilding({
  id: 'wickharbor_harbour_inn',
  kind: 'inn',
  model: 'tavern',
  look: LOOK,
  anchor: { x: 423, z: 333.04 },
  rotation: NORTH_FACING,
  scale: 1.2,
});
// The smithy (smithy, 1.3, walk-in): the square's north-east corner, where
// the hexagon workshop and the kit inn stood, its door looking west over its
// forecourt to the square and its forge shelter at the north end. It keeps
// the shoal scuttlers' wander clear (its reach is 9.5 yd past the camp).
const SMITHY = paintedTownBuilding({
  id: 'wickharbor_smithy',
  kind: 'house',
  model: 'smithy',
  look: LOOK,
  anchor: { x: 387.83, z: 370.64 },
  rotation: -1.561,
  scale: 1.3,
});
// The market hall (shop_a, 1.3, walk-in): the square's north-west corner,
// where the hexagon market hall stood, between the cliff road and the bluff
// over the bay, its door, counter and barrels looking south-east onto the
// well and the fire. 1.3 rather than the grand 1.5: the wedge is about 22 yd
// across, and at 1.5 its back corner stands on the bluff's lip.
const MARKET = paintedTownBuilding({
  id: 'wickharbor_market_hall',
  kind: 'house',
  model: 'shop_a',
  look: LOOK,
  anchor: { x: 434.62, z: 372.62 },
  rotation: 0.349,
  scale: 1.3,
});
// The downs house (house_a, 1.4, sealed): beside the churchyard where the
// hexagon home stood, its door on the downs road.
const DOWNS_HOUSE = paintedTownBuilding({
  id: 'wickharbor_downs_house',
  kind: 'house',
  model: 'house_a',
  look: LOOK,
  anchor: { x: 385.04, z: 335.91 },
  rotation: NORTH_FACING,
  scale: 1.4,
});
// The Windway house (house_a, 1.4, sealed): beyond the smithy where the kit
// cottage stood, its door on the Windway road, the first house a traveller
// off the pass reaches.
const WINDWAY_HOUSE = paintedTownBuilding({
  id: 'wickharbor_windway_house',
  kind: 'house',
  model: 'house_a',
  look: LOOK,
  anchor: { x: 368.96, z: 373.09 },
  rotation: SOUTH_FACING,
  scale: 1.4,
});

const BUILDINGS = [INN, SMITHY, MARKET, DOWNS_HOUSE, WINDWAY_HOUSE] as const;

// Level pads. The square's own height (2.5) carries the inn and the market
// hall, the smithy and the Windway house stand a little lower on the road in.
// Two aprons are short: the market hall's on the bluff side (a wide one
// steepened the bluff's lip) and the downs house's above the sea cliff, whose
// pad also sits low (1.2, the ground it has) for the same reason. No stamp
// reaches the sea or a camp's ground (the shoal scuttlers' radius stays about
// 3 yd past every pad).
const GROUND: readonly TownGround[] = [
  { building: INN, height: 2.5, columns: 3, rows: 2, taper: 4, apron: 6 },
  { building: SMITHY, height: 2.2, columns: 2, rows: 3, taper: 4, apron: 6 },
  { building: MARKET, height: 2.5, columns: 2, rows: 2, taper: 4, apron: 3 },
  { building: DOWNS_HOUSE, height: 1.2, columns: 2, rows: 2, taper: 3, apron: 3 },
  { building: WINDWAY_HOUSE, height: 2, columns: 2, rows: 2, taper: 3, apron: 6 },
];

export const WICKHARBOR_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'wickharbor',
  layoutId: 'wickharbor_painted_v1',
  zoneId: 'galecrest',
  hub: { center: { x: 420, z: 360 }, radius: 16 },
  buildings: BUILDINGS,
  replacedKitBuildings: [
    { kind: 'inn', x: 405, z: 371, w: 6, d: 7, rot: Math.PI },
    { kind: 'house', x: 376, z: 371, w: 5, d: 5, rot: Math.PI },
    { kind: 'house', x: 413, z: 381, w: 5, d: 5, rot: 1.62 },
    { kind: 'house', x: 434, z: 390, w: 5, d: 5, rot: -1.48 },
    // the two cottages that stood inside the shoal scuttlers' camp, with no
    // painted house in their place
    { kind: 'house', x: 417, z: 405, w: 5, d: 6, rot: 1.52 },
    { kind: 'house', x: 409, z: 394, w: 5, d: 5, rot: 1.68 },
  ],
  // the hexagon quarter, exactly as content/galecrest.ts had it
  replacedDecorProps: [
    { key: 'hexbTownhall', x: 414, z: 342, rot: 0.5, scale: 8, r: 6.5, h: 15 },
    { key: 'hexbMarket', x: 433, z: 369, rot: -1.9, scale: 6, r: 4.5, h: 7 },
    { key: 'hexbTavern', x: 441, z: 380, rot: -1.45, scale: 7.5, r: 5.5, h: 11 },
    { key: 'hexbWorkshop', x: 390, z: 373, rot: Math.PI, scale: 7, r: 6, h: 8 },
    { key: 'hexbHomeA', x: 429, z: 342, rot: 0.64, scale: 7.5, r: 4.5, h: 8 },
    { key: 'hexbHomeB', x: 442, z: 356, rot: -2.5, scale: 7.5, r: 5, h: 10 },
    { key: 'hexbHomeA', x: 441, z: 332, rot: 0.64, scale: 7.5, r: 4.5, h: 8 },
    { key: 'hexbHomeB', x: 386, z: 336, rot: -0.28, scale: 7.5, r: 5, h: 10 },
  ],
  pads: levelTownPads(GROUND),
  npcs: [],
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const WICKHARBOR_BUILDINGS_BY_ID = indexById(WICKHARBOR_LAYOUT.buildings);
export const WICKHARBOR_NPC_PLACEMENTS_BY_ID = indexById(WICKHARBOR_LAYOUT.npcs);
