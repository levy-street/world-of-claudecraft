// Hedgewick (The Evergarden): the groundskeepers' hamlet by the gate lawns,
// rebuilt with five painted Tidehold buildings round its green, in the thatch
// look (oldtown colours, thatch roofs, rubble walls). A pure, frozen
// data/geometry module: no engine imports, no randomness, no clocks
// (sim/painted_towns/CLAUDE.md).
//
// The green is flat lawn (about 2) above the south shore where five roads
// meet: the Garden Gate road in from the south-west, the Parterre road north
// to the maze, the Dawnhold road north-east, the pond road west and the
// Gardenwalk east. Round it stood three kit records (the inn on the crossroads
// itself, two cottages) and a ring of hexagon-kit decor buildings (the church
// in its iron-railed churchyard, a tavern, a blacksmith, two homes and a
// market). All of them gave way to five grand buildings standing in the
// wedges between the roads, every door on the green 20 to 26 yd out; the
// green keeps everything it had (the well, the stall and the board, the fire
// and the crates, the mailbox, Head Gardener Amaranth and Wickmother Sorrel,
// both quest anchors inside the hub circle), and the graveyard keeps its
// churchyard in front of the chapel's door. Dawnhold's barracks, the
// windmills and the flower beds stay.
import { deepFreeze, indexById, levelTownPads, type TownGround } from '../placed_town_kit';
import { paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

const LOOK = 'thatch' as const;

// The models face local -Z (rotation 0 turns the door south, -z; PI north,
// +z; PI / 2 east, -x: this world's east is -x). The buildings stand at free
// angles, each turned to its own wedge of the green.

// The inn (tavern, 1.2: the door clears 5.3): the green's south-west side,
// where the hexagon home stood, between the Garden Gate road and the
// churchyard with the shore behind it; its long front and door look north
// over the green, so the first door a traveller up from the gate reaches is
// the inn's. Wickmother Sorrel keeps her spot on the green (her quests count
// the hub circle, and the door is 24.5 yd out).
const INN = paintedTownBuilding({
  id: 'hedgewick_inn',
  kind: 'inn',
  model: 'tavern',
  look: LOOK,
  anchor: { x: 332.92, z: 781.38 },
  rotation: -2.88,
  scale: 1.2,
});
// The chapel (hall, 1.0: a five-yard portal already): where the hexagon church
// stood in its churchyard, south-east of the green, the door and the bell
// tower looking west over the gardener's graves to the green. 1.0 rather than
// 1.2: at 1.2 it runs onto the Gardenwalk road and over the graveyard.
const CHAPEL = paintedTownBuilding({
  id: 'hedgewick_chapel',
  kind: 'chapel',
  model: 'hall',
  look: LOOK,
  anchor: { x: 293.14, z: 792.19 },
  rotation: -1.833,
  scale: 1,
});
// The smithy (smithy, 1.3, walk-in): where the hexagon blacksmith stood, the
// wedge between the Gardenwalk and the Dawnhold road north-east of the green,
// its door and forge shelter turned to the green.
const SMITHY = paintedTownBuilding({
  id: 'hedgewick_smithy',
  kind: 'house',
  model: 'smithy',
  look: LOOK,
  anchor: { x: 287.68, z: 821.98 },
  rotation: -1.261,
  scale: 1.3,
});
// The green house (house_b, 1.3, sealed): north of the green between the
// Parterre road and the Dawnhold road, where the kit cottage, the hexagon home
// and the market stood, its door on the green.
const GREEN_HOUSE = paintedTownBuilding({
  id: 'hedgewick_green_house',
  kind: 'house',
  model: 'house_b',
  look: LOOK,
  anchor: { x: 320.7, z: 837.9 },
  rotation: 0.025,
  scale: 1.3,
});
// The pond house (house_a, 1.4, sealed): the wedge between the pond road and
// the Parterre road north-west of the green, where the other kit cottage
// stood, its door turned to the green.
const POND_HOUSE = paintedTownBuilding({
  id: 'hedgewick_pond_house',
  kind: 'house',
  model: 'house_a',
  look: LOOK,
  anchor: { x: 346.74, z: 828.03 },
  rotation: 0.524,
  scale: 1.4,
});

const BUILDINGS = [INN, CHAPEL, SMITHY, GREEN_HOUSE, POND_HOUSE] as const;

// Level pads: the lawns are near flat, so each building stands on the ground
// it already has (2.0 by the shore, rising to 2.6 by the pond road) with a
// short apron. The inn's back corner sits above the shore bank; nothing
// reaches the sea, the Petal Pond or a camp's ground (the nearest camp, the
// hedge knights at (306, 872) north of the green house, stays more than 11 yd
// past its radius from every pad).
const GROUND: readonly TownGround[] = [
  { building: INN, height: 2, columns: 3, rows: 2, taper: 4, apron: 6 },
  { building: CHAPEL, height: 2, columns: 2, rows: 3, taper: 4, apron: 6 },
  { building: SMITHY, height: 2.2, columns: 3, rows: 2, taper: 4, apron: 6 },
  { building: GREEN_HOUSE, height: 2.4, columns: 2, rows: 2, taper: 4, apron: 6 },
  { building: POND_HOUSE, height: 2.6, columns: 2, rows: 2, taper: 4, apron: 6 },
];

export const HEDGEWICK_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'hedgewick',
  layoutId: 'hedgewick_painted_v1',
  zoneId: 'evergarden',
  hub: { center: { x: 320, z: 810 }, radius: 16 },
  buildings: BUILDINGS,
  replacedKitBuildings: [
    { kind: 'inn', x: 318, z: 808, w: 9, d: 10, rot: 0.7 },
    { kind: 'house', x: 344, z: 826, w: 8, d: 8, rot: -1.0 },
    { kind: 'house', x: 318, z: 828, w: 8, d: 8, rot: 2.1 },
  ],
  // the hexagon quarter, exactly as content/evergarden.ts had it
  replacedDecorProps: [
    { key: 'hexChurch', x: 302, z: 788, rot: Math.PI / 2, scale: 8, r: 5.6, h: 15 },
    { key: 'hexTavern', x: 352, z: 806, rot: -1.45, scale: 8, r: 6, h: 13 },
    { key: 'hexBlacksmith', x: 290, z: 824, rot: 2.03, scale: 7.5, r: 5.6, h: 10 },
    { key: 'hexHomeA', x: 328, z: 838, rot: Math.PI, scale: 7.5, r: 5.2, h: 11 },
    { key: 'hexHomeB', x: 334, z: 790, rot: 0.6, scale: 7.5, r: 5.2, h: 11 },
    { key: 'hexMarket', x: 310, z: 844, rot: Math.PI, scale: 6, r: 4.5, h: 7 },
  ],
  pads: levelTownPads(GROUND),
  npcs: [],
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const HEDGEWICK_BUILDINGS_BY_ID = indexById(HEDGEWICK_LAYOUT.buildings);
export const HEDGEWICK_NPC_PLACEMENTS_BY_ID = indexById(HEDGEWICK_LAYOUT.npcs);
