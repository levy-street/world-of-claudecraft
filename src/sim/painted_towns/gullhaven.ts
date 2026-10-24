// Gullhaven (The Farshore): the redoubt's kit houses replaced by three painted
// Tidehold buildings round its square, in the brick look (harbour colours,
// brick walls, slate roofs). A pure, frozen data/geometry module: no engine
// imports, no randomness, no clocks (sim/painted_towns/CLAUDE.md).
//
// The town is a bowl on the island's north shore: the sea behind it to the
// north and east, the hills rising to the south, and its two roads meeting at
// the square from the south (the shore road up from the Landing, the meadow
// road out to the Watch Meadow). The four kit records (the muster hall, the
// menders' hall, two cottages) gave way to three grand buildings closing three
// sides of the square; the square keeps everything it had (the well, the
// muster fire and Warden Coalfast, Quartermaster Edda's arming table, the war
// camp's tents and crates, the mailbox, the noticeboard, Gullhaven Rest and the
// barricade fences) and stays open to the east, where the shore road and
// Fisher Bram's walk home (esc_fs_bram) come in. No fourth building: every
// other spot the bowl has is on the steep east ridge, across Bram's lane, hard
// against the chapel or with its apron in the sea.
import { deepFreeze, indexById, levelTownPads, makeTownNpc } from '../placed_town_kit';
import { paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

const LOOK = 'brick' as const;

// The models face local -Z (rotation 0 turns the door south, -z; PI north,
// +z; PI / 2 east, -x: this world's east is -x).
const SOUTH_FACING = 0;
const NORTH_FACING = Math.PI;
const EAST_FACING = Math.PI / 2;

// The muster hall (tavern, 1.2: the door clears 5.3): the square's north side,
// its long front on the square and its back to the sea, on the knoll behind
// the old north barricade cut down to the square's height. Its door looks south
// at the well, so the first thing a newcomer sees coming up the shore road is
// the inn across the square.
const INN = paintedTownBuilding({
  id: 'gullhaven_muster_inn',
  kind: 'inn',
  model: 'tavern',
  look: LOOK,
  anchor: { x: 311, z: 91.96 },
  rotation: SOUTH_FACING,
  scale: 1.2,
});
// The menders' hall (hall, 1.0: a five-yard portal already): the square's west
// side, its gable, door and bell tower on the square and its nave running back
// up the slope. Mender Saul keeps its door, inside the hub circle where his
// quest's anchor must stand. 1.0 rather than 1.2: at 1.2 the nave reaches the
// meadow road and the inn's corner.
const CHAPEL = paintedTownBuilding({
  id: 'gullhaven_menders_chapel',
  kind: 'chapel',
  model: 'hall',
  look: LOOK,
  anchor: { x: 332.3, z: 71 },
  rotation: EAST_FACING,
  scale: 1,
});
// The redoubt's watch house (house_a, 1.4, sealed; Wickharbor's cottage model,
// so the two brick towns share their bakes): in the fork between the shore road
// and the meadow road, its door on the square, keeping the way into town.
const WATCH_HOUSE = paintedTownBuilding({
  id: 'gullhaven_watch_house',
  kind: 'house',
  model: 'house_a',
  look: LOOK,
  anchor: { x: 304.54, z: 43.91 },
  rotation: NORTH_FACING,
  scale: 1.4,
});

const NPCS = [
  // the field surgeon at the menders' hall door, looking out at the square
  makeTownNpc('mender_saul', CHAPEL.frontStandingPoint, CHAPEL.frontFacing, CHAPEL.id),
] as const;

// Level pads: each building on level ground across its whole reach, eased out
// by a soft apron. The square sits at about 3.5; the inn is cut into the knoll
// at the square's height, the chapel stands a little up the west slope and the
// watch house higher in the fork, each grading down to the square at a
// walkable slope. The inn's apron is short: a wider one carried the knoll's
// fill onto the strand behind it, raising the salvage spots by the wreck
// (content/world_quests.ts) and steepening the bank under the herbs at
// (291, 104). No stamp reaches the sea, Gull Mere or a camp's ground (the
// nearest camp, the north downs wretches at (400, 96), stays more than 35 yd
// past its radius from every pad).
const PADS = levelTownPads([
  { building: INN, height: 3.6, columns: 3, rows: 2, taper: 4, apron: 4 },
  { building: CHAPEL, height: 5.4, columns: 2, rows: 3, taper: 4, apron: 10 },
  { building: WATCH_HOUSE, height: 6.8, columns: 2, rows: 2, taper: 4, apron: 10 },
]);

export const GULLHAVEN_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'gullhaven',
  layoutId: 'gullhaven_painted_v1',
  zoneId: 'farshore_isle',
  hub: { center: { x: 305, z: 70 }, radius: 15 },
  buildings: [INN, CHAPEL, WATCH_HOUSE],
  replacedKitBuildings: [
    { kind: 'inn', x: 298, z: 64, w: 6, d: 7, rot: 0.5 },
    { kind: 'house', x: 312, z: 78, w: 5, d: 5, rot: -1.1 },
    { kind: 'house', x: 296, z: 78, w: 5, d: 5, rot: 2.1 },
    { kind: 'chapel', x: 316, z: 62, w: 5, d: 7, rot: -2.4 },
  ],
  replacedDecorProps: [],
  pads: PADS,
  npcs: NPCS,
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const GULLHAVEN_BUILDINGS_BY_ID = indexById(GULLHAVEN_LAYOUT.buildings);
export const GULLHAVEN_NPC_PLACEMENTS_BY_ID = indexById(GULLHAVEN_LAYOUT.npcs);
