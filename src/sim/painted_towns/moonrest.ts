// Moonrest (The Nightbloom): the painted rebuild of the town's kit houses, a
// snug lantern village on its rise. The square round the well keeps every
// service it had (the well and the fire, the two stalls and their crates, Lira
// Dewsong and Weaver Amelle, the mailbox, the board) and its five roads still
// meet there. No wedge between the five spokes takes a grand inn near the
// square, so the Moonspring spur's first stretch is re-routed
// (MOONREST_MOONSPRING_ROAD, which the zone file reads) and the inn stands west
// of the square with its door on it. The moon shrine stands south over the
// Nightbloom Rest graves, a house north-east. A pure, frozen data/geometry
// module: no engine imports, no randomness, no clocks
// (sim/painted_towns/CLAUDE.md).
import {
  deepFreeze,
  facingToward,
  indexById,
  levelTownPads,
  type Point2,
  type TownGround,
  wrapAngle,
} from '../placed_town_kit';
import { paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

// The diamond look: default colours, diamond slate roof, ashlar walls.
const LOOK = 'diamond' as const;
const HUB: Point2 = { x: -370, z: 1420 };
const NORTH_FACING = Math.PI; // the door looks north (+z)

/** The rotation that turns a painted model's door (its -Z face) toward `target`. */
function doorToward(anchor: Point2, target: Point2): number {
  return wrapAngle(facingToward(anchor, target) + Math.PI);
}

// The inn: west-south-west of the square between the Vigil road and the
// re-routed Moonspring spur, turned to face the square, its long front and door
// on it; its north corner keeps clear of the moonfleece grazers' ground.
const INN_ANCHOR: Point2 = { x: -343.5, z: 1409.5 };
const INN = paintedTownBuilding({
  id: 'moonrest_inn',
  kind: 'inn',
  model: 'tavern',
  look: LOOK,
  anchor: INN_ANCHOR,
  rotation: doorToward(INN_ANCHOR, HUB),
  scale: 1.2,
});
// The moon shrine (the old kit chapel): south of the Nightbloom Rest graves,
// its door and bell tower looking over them to the square, the Nightgate road
// along its west side. It stands at 1.0 (its portal still clears 5 yd): at 1.2
// it closes on the Nightgate road or, shifted east, sends its pads into the
// inlet.
const SHRINE = paintedTownBuilding({
  id: 'moonrest_moon_shrine',
  kind: 'chapel',
  model: 'hall',
  look: LOOK,
  anchor: { x: -380.5, z: 1382.4 },
  rotation: NORTH_FACING,
  scale: 1,
});
// A house north-north-east between the Barrow road and the Gloamfield road
// (sealed), turned to face the square.
const HOUSE_ANCHOR: Point2 = { x: -385.5, z: 1454.5 };
const HOUSE = paintedTownBuilding({
  id: 'moonrest_house',
  kind: 'house',
  model: 'house_c',
  look: LOOK,
  anchor: HOUSE_ANCHOR,
  rotation: doorToward(HOUSE_ANCHOR, HUB),
  scale: 1.4,
});

const BUILDINGS = [INN, SHRINE, HOUSE] as const;

// Each building's pad and its apron, near the mean of the ground under it (the
// square stays at 2.5): the inn at 2.0 with a small apron toward the grazers,
// the shrine at 1.8, the house at 1.2 where the land falls north.
const GROUND: readonly TownGround[] = [
  { building: INN, height: 2, columns: 3, rows: 2, taper: 4, apron: 6 },
  { building: SHRINE, height: 1.8, columns: 2, rows: 3, taper: 4, apron: 8 },
  { building: HOUSE, height: 1.2, columns: 2, rows: 2, taper: 4, apron: 6 },
];

/** The Moonspring road, re-routed: it still leaves the square, but
 *  south-south-west between the inn's south end and the Nightgate road, and
 *  swings west to its old line at the shore (it ran (-370, 1420) (-334, 1402)
 *  (-308, 1388), through the inn's ground). content/nightbloom.ts reads it. */
export const MOONREST_MOONSPRING_ROAD: readonly Point2[] = deepFreeze([
  { x: -370, z: 1420 },
  { x: -363, z: 1401 },
  { x: -348, z: 1388 },
  { x: -328, z: 1383 },
  { x: -308, z: 1388 },
]);

export const MOONREST_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'moonrest',
  layoutId: 'moonrest_painted_v1',
  zoneId: 'nightbloom',
  hub: { center: HUB, radius: 18 },
  buildings: BUILDINGS,
  replacedKitBuildings: [
    { kind: 'inn', x: -378, z: 1424, w: 6, d: 7, rot: 0.6 },
    { kind: 'house', x: -361, z: 1416, w: 6, d: 6, rot: -1.1 },
    { kind: 'house', x: -376, z: 1410, w: 5, d: 5, rot: 2.2 },
    { kind: 'chapel', x: -364, z: 1430, w: 5, d: 7, rot: -2.4 }, // the moon shrine
  ],
  replacedDecorProps: [],
  pads: levelTownPads(GROUND),
  npcs: [],
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const MOONREST_BUILDINGS_BY_ID = indexById(MOONREST_LAYOUT.buildings);
export const MOONREST_NPC_PLACEMENTS_BY_ID = indexById(MOONREST_LAYOUT.npcs);
