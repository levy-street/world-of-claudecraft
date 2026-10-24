// Eldershine (The Veiled Hollow): the painted rebuild of the town's hollow kit
// houses. The town stays radial: the great tree, the ring path round it (r 14)
// and its four spoke roads are untouched, the market under the tree keeps its
// stalls and folk, and the painted buildings stand in the quiet sectors between
// the spokes, doors on the ring or on their spoke: the inn east of the tree,
// its long front on the square; the shrine south, over the Eldershine Rest
// graves; the market west on the west road; the smithy north-east on the north
// road; a wayhouse on the Duskfall road where the portal's travellers come in.
// A pure, frozen data/geometry module: no engine imports, no randomness, no
// clocks (sim/painted_towns/CLAUDE.md).
import {
  deepFreeze,
  indexById,
  levelTownPads,
  makeTownNpc,
  type TownGround,
  type TownPadStamp,
} from '../placed_town_kit';
import { paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

// The diamond look: default colours, diamond slate roof, ashlar walls.
const LOOK = 'diamond' as const;
const NORTH_FACING = Math.PI; // the door looks north (+z)
const EAST_FACING = Math.PI / 2; // the door looks east (-x)
const WEST_FACING = -Math.PI / 2; // the door looks west (+x)

// The inn: east of the tree between the north spoke and the Duskfall road (the
// widest, flattest sector), its long front on the ring, door looking at the well.
const INN = paintedTownBuilding({
  id: 'eldershine_inn',
  kind: 'inn',
  model: 'tavern',
  look: LOOK,
  anchor: { x: -69.14, z: 1036.76 },
  rotation: WEST_FACING,
  scale: 1.2,
});
// The shrine (the old hollow chapel): south of the tree, its door and bell tower
// over the square's gathering fire, the graves at its east side.
const SHRINE = paintedTownBuilding({
  id: 'eldershine_shrine',
  kind: 'chapel',
  model: 'hall',
  look: LOOK,
  anchor: { x: -37, z: 992.5 },
  rotation: NORTH_FACING,
  scale: 1,
});
// The market (Fenna's stores): west of the tree between the west and south-west
// spokes, its counter and door on the square.
const MARKET = paintedTownBuilding({
  id: 'eldershine_market',
  kind: 'house',
  model: 'shop_a',
  look: LOOK,
  anchor: { x: -1.65, z: 1017 },
  rotation: EAST_FACING,
  scale: 1.5,
});
// The smithy (the old forges): north of the inn, its door and forge shelter on
// the north road.
const SMITHY = paintedTownBuilding({
  id: 'eldershine_smithy',
  kind: 'house',
  model: 'smithy',
  look: LOOK,
  anchor: { x: -66.98, z: 1063.11 },
  rotation: WEST_FACING,
  scale: 1.3,
});
// A wayhouse on the Duskfall road, south of it, its door on the road (sealed).
const WAYHOUSE = paintedTownBuilding({
  id: 'eldershine_wayhouse',
  kind: 'house',
  model: 'house_c',
  look: LOOK,
  anchor: { x: -82, z: 991.9 },
  rotation: NORTH_FACING,
  scale: 1.4,
});

const BUILDINGS = [INN, SHRINE, MARKET, SMITHY, WAYHOUSE] as const;

// Each building's pad and its apron. The inn, the shrine and the smithy stand at
// the square's own height (2.5); the market on the ground falling west (1.5),
// the wayhouse down on the Duskfall road (0.6).
const GROUND: readonly TownGround[] = [
  { building: INN, height: 2.5, columns: 3, rows: 2, taper: 4, apron: 10 },
  { building: SHRINE, height: 2.5, columns: 2, rows: 3, taper: 4, apron: 10 },
  { building: MARKET, height: 1.5, columns: 2, rows: 2, taper: 4, apron: 10 },
  { building: SMITHY, height: 2.5, columns: 3, rows: 2, taper: 4, apron: 10 },
  { building: WAYHOUSE, height: 0.6, columns: 2, rows: 2, taper: 4, apron: 8 },
];

// The aprons reach the ring path: the square under the great tree is set back
// at its own height (level out to 16 yd from the trunk) after the aprons and
// before the pads, as Highwatch's square is.
const SQUARE_RELEVEL: TownPadStamp = {
  x: -40,
  z: 1026,
  radius: 19,
  delta: 2.5,
  hardness: 16 / 19,
};

// Loremother Bryn, the Voice of the Shrine, keeps the shrine's door (it stands
// inside the hub circle, so her errands stay town quests).
const NPCS = [
  makeTownNpc('loremother_bryn', SHRINE.frontStandingPoint, SHRINE.frontFacing, SHRINE.id),
];

export const ELDERSHINE_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'eldershine',
  layoutId: 'eldershine_painted_v1',
  zoneId: 'veiled_hollow',
  hub: { center: { x: -40, z: 1030 }, radius: 30 },
  buildings: BUILDINGS,
  replacedKitBuildings: [
    { kind: 'hollowInn', x: -59, z: 1033, w: 6, d: 7, rot: 1.92 },
    { kind: 'hollowHouse', x: -52, z: 1041, w: 7, d: 6, rot: 2.47 },
    { kind: 'hollowHouse', x: -33, z: 1044, w: 7, d: 6, rot: 2.77 },
    { kind: 'hollowHouse', x: -24, z: 1038, w: 6, d: 6, rot: -2.21 },
    { kind: 'hollowSmith', x: -21, z: 1023, w: 7, d: 6.5, rot: -1.41 },
    { kind: 'hollowChapel', x: -18, z: 1012, w: 5, d: 7, rot: -0.9 },
    { kind: 'hollowHouse', x: -47, z: 1008, w: 7, d: 6, rot: 0.37 },
    { kind: 'hollowMarket', x: -54, z: 1010, w: 8, d: 6, rot: 0.72 },
  ],
  replacedDecorProps: [],
  pads: levelTownPads(GROUND, { between: [SQUARE_RELEVEL] }),
  npcs: NPCS,
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const ELDERSHINE_BUILDINGS_BY_ID = indexById(ELDERSHINE_LAYOUT.buildings);
export const ELDERSHINE_NPC_PLACEMENTS_BY_ID = indexById(ELDERSHINE_LAYOUT.npcs);
