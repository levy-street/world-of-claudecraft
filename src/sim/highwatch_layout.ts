// Canonical Highwatch rebuild layout: the hub of Thornpeak Heights with its
// five kit buildings replaced by painted Tidehold buildings in the Highwatch
// look. A pure, frozen data/geometry module shared by simulation content,
// collision, terrain, rendering and Studio. Keep engine imports, randomness,
// clocks, and mutable runtime state out of this file.
//
// Everything else in the town stays where it stood: the well, the
// apothecary station, the quartermaster's and the armorer's stalls, the
// mailbox, the noticeboard, the south gate's fence runs, the Thornpeak Cairns,
// the practice row and the farm. Only the buildings, the four NPCs whose
// spots a building took or who belong at its door, the Stormcrag road's
// first stretch and one herb node (content/gather_nodes.ts) moved.
import {
  deepFreeze,
  facingToward,
  indexById,
  localToWorld,
  makePlacedTownBuilding,
  makeTownNpc,
  placedTownSeat,
  scalePlacedTownMeasurements,
} from './placed_town_kit';

/** The five kit records the rebuild replaced (zone3 ZONE3_PROPS before it),
 *  kept for the record and for the tests that prove they are gone. */
export const REMOVED_HIGHWATCH_BUILDINGS = deepFreeze([
  { kind: 'house', x: 14, z: 671, width: 7, depth: 6, rotation: -0.5 },
  { kind: 'house', x: 8, z: 650, width: 6, depth: 5, rotation: 0.4 },
  { kind: 'house', x: 18, z: 660, width: 6, depth: 5, rotation: 1.2 },
  { kind: 'inn', x: -15, z: 666, width: 6, depth: 7, rotation: 0.6 },
  { kind: 'chapel', x: -16, z: 650, width: 5, depth: 7, rotation: 0.9 },
] as const);

const HUB_CENTER = { x: 0, z: 660 } as const;

// The painted models are authored in yards with their ground line at y 0 and
// one yard of footing below it; a visitor stands 1.8 yd off the wall face at a
// door at authored size, and that step grows with the building (its stoop and
// its upper storey's overhang grow too). Highwatch stands them GRAND, each at its own size, so a player (2.6 yd
// to the crown) walks in under a door of about five yards, as at a classic
// mountain inn, never stooping into a toy house. Measured off each model's
// baked collision (door head and ceiling over its floor, authored size), each
// scale brings the door to about five yards and the room to six or more:
//  - the inn (tavern_b): door 4.4, taproom ceiling 4.9 at authored size; at 1.2
//    the door clears 5.3 and the taproom 5.9, the ridge stands 25.6 yd up;
//  - the chapel (hall): door 5.0, nave walls 8.4 over its floor; at 1.2 the
//    portal clears 6.0 and the nave 10.1, a church door over an inn door;
//  - the counting house (shop_a): door 3.25, ceiling 4.2, the smallest; at 1.5
//    the door clears 4.9 and the counting room 6.3;
//  - the watch house (house_c, sealed): a storey of 3.9; at 1.4 it stands 5.5
//    a storey, beside the counting house;
//  - the smithy: door 4.0, ceiling 4.8; at 1.3 the door clears 5.2, the forge
//    room 6.2.
const FRONT_CLEARANCE = 1.8;
const INN_SCALE = 1.2;
const CHAPEL_SCALE = 1.2;
const COUNTING_HOUSE_SCALE = 1.5;
const WATCH_HOUSE_SCALE = 1.4;
const SMITHY_SCALE = 1.3;

// The Highwatch look of the painted set: the same models and geometry as
// /models/tidehold/, re-baked wearing the harbour colours with square slate
// roofs and ashlar walls (cool granite under blue slate for the peaks).
const PAINTED_SET = '/models/tidehold/highwatch';

const EAST_FACING = Math.PI / 2; // the door looks east (-x), the model turned a quarter
const WEST_FACING = -Math.PI / 2; // the door looks west (+x)
const SOUTH_FACING = 0; // the door looks south (-z), the model as authored
const NORTH_FACING = Math.PI; // the door looks north (+z), the model turned half round

// The site plan, widened for the grand buildings: the square round the well
// keeps every service it had and opens out to the buildings round it. The inn
// is its west side, set back past the station and the mailbox, its long front
// on the square and its door looking at the apothecary station; the counting
// house stands east of the square past the quartermaster's stall, between the
// east road and the gate fence, the practice row behind it; the chapel and the
// watch house flank the Fenbridge road where it climbs in through the south
// gate, the chapel's door and bell tower looking north at the gate; and the
// smithy works the north-west terrace, its forge open onto the Stormcrag road.
// Each record's measurements are the model's at AUTHORED size
// (scalePlacedTownMeasurements carries them to the building's own scale).
const INN = makePlacedTownBuilding(
  {
    id: 'highwatch_summit_inn',
    assetId: `${PAINTED_SET}/tavern_b.glb`,
    kind: 'inn',
    anchor: { x: 29, z: 668.6 },
    rotation: EAST_FACING,
    ...scalePlacedTownMeasurements(
      {
        reach: { x: 1.079, z: -0.864, width: 30.262, height: 22.351, depth: 20.428 },
        walls: { x: 0, z: 0, width: 26, depth: 15 },
        annexes: [
          // the round turret at the front's south corner
          { name: 'turret', x: 13.5, z: -8.5, width: 3.8, depth: 3.8 },
          { name: 'chimney', x: -13.47, z: -1, width: 1, depth: 2.4 },
        ],
        doorX: -2,
      },
      INN_SCALE,
    ),
    walkIn: true,
  },
  placedTownSeat(INN_SCALE, FRONT_CLEARANCE * INN_SCALE),
);
const CHAPEL = makePlacedTownBuilding(
  {
    id: 'highwatch_gate_chapel',
    assetId: `${PAINTED_SET}/hall.glb`,
    kind: 'chapel',
    // east of the Fenbridge road at the south gate, its long side on the
    // road and its door looking north at the gate and the square: Brother
    // Aldric keeps the door inside the hub circle, as he kept his old spot
    anchor: { x: -12.2, z: 629.8 },
    rotation: NORTH_FACING,
    ...scalePlacedTownMeasurements(
      {
        reach: { x: 1.9255, z: -0.254, width: 18.851, height: 30.5, depth: 24.212 },
        walls: { x: 0, z: 0, width: 12, depth: 22 },
        annexes: [
          // the bell tower at the front's east corner, over the gate
          { name: 'bell_tower', x: 8.25, z: -9, width: 5.4, depth: 5.4 },
          { name: 'notice_board', x: -4.2, z: -11.8, width: 1.8, depth: 0.6 },
        ],
        doorX: 0,
      },
      CHAPEL_SCALE,
    ),
    walkIn: true,
  },
  placedTownSeat(CHAPEL_SCALE, FRONT_CLEARANCE * CHAPEL_SCALE),
);
const COUNTING_HOUSE = makePlacedTownBuilding(
  {
    id: 'highwatch_counting_house',
    // the goods shop with the sack sign: the hold's bank and market counter
    assetId: `${PAINTED_SET}/shop_a.glb`,
    kind: 'house',
    // east of the square, its counter and awning on the square
    anchor: { x: -26.8, z: 657.5 },
    rotation: WEST_FACING,
    ...scalePlacedTownMeasurements(
      {
        reach: { x: 0, z: -0.8, width: 13.004, height: 16.28, depth: 12.2 },
        walls: { x: 0, z: 0, width: 11, depth: 8.4 },
        annexes: [
          { name: 'stall_counter', x: 2.375, z: -5.925, width: 3.61, depth: 0.77 },
          { name: 'stall_barrels', x: 4.885, z: -5.762, width: 1.477, depth: 2.169 },
        ],
        doorX: -1.6,
      },
      COUNTING_HOUSE_SCALE,
    ),
    walkIn: true,
  },
  placedTownSeat(COUNTING_HOUSE_SCALE, FRONT_CLEARANCE * COUNTING_HOUSE_SCALE),
);
const WATCH_HOUSE = makePlacedTownBuilding(
  {
    id: 'highwatch_watch_house',
    assetId: `${PAINTED_SET}/house_c.glb`,
    kind: 'house',
    // west of the Fenbridge road at the south gate, its door on the road
    anchor: { x: 15, z: 634 },
    rotation: EAST_FACING,
    ...scalePlacedTownMeasurements(
      {
        reach: { x: 0.386, z: 0.23, width: 12.764, height: 19.58, depth: 16.264 },
        walls: { x: 0, z: 0, width: 8.56, depth: 11.96 },
        annexes: [{ name: 'tower', x: 4.61, z: 6.31, width: 2.76, depth: 2.76 }],
        doorX: -1.6,
      },
      WATCH_HOUSE_SCALE,
    ),
  },
  placedTownSeat(WATCH_HOUSE_SCALE, FRONT_CLEARANCE * WATCH_HOUSE_SCALE),
);
const SMITHY = makePlacedTownBuilding(
  {
    id: 'highwatch_smithy',
    assetId: `${PAINTED_SET}/smithy.glb`,
    kind: 'house',
    // the north-west terrace, the forge shelter at its west end
    anchor: { x: 20, z: 704 },
    rotation: SOUTH_FACING,
    ...scalePlacedTownMeasurements(
      {
        reach: { x: 3.4285, z: -0.2955, width: 19.797, height: 12.781, depth: 11.69 },
        walls: { x: 0, z: 0, width: 11, depth: 9 },
        annexes: [
          { name: 'forge_shelter', x: 9.12, z: -0.08, width: 7.24, depth: 9.64 },
          { name: 'chimney', x: -5.97, z: 1, width: 1, depth: 2 },
        ],
        doorX: -1.2,
      },
      SMITHY_SCALE,
    ),
    walkIn: true,
  },
  placedTownSeat(SMITHY_SCALE, FRONT_CLEARANCE * SMITHY_SCALE),
);

// The lord's manor on the rise west of the Sanctum road, north of the smithy's
// terrace: a walk-in house of one storey (scripts/assets/highwatch_manor/,
// built at its own grand size, so it stands at scale 1). Its great hall is the
// wall box, its door looks south over the smithy at the square; the two wings,
// the dais bay behind the hall and the kitchen's chimney are its solid
// annexes. The porch, the steps and the walled garden in front lie inside its
// reach. It stands clear of the Sanctum road and its two lamps on this side,
// of the smithy and the Stormcrag road, and its pad and aprons touch no
// camp's ground: the hill east of the road is the ogres' (a camp's wandering
// draws the shared rng, so its ground must not change).
const MANOR_SCALE = 1;
const MANOR = makePlacedTownBuilding(
  {
    id: 'highwatch_manor',
    assetId: `${PAINTED_SET}/manor.glb`,
    kind: 'house',
    anchor: { x: 31.5, z: 746 },
    rotation: SOUTH_FACING,
    ...scalePlacedTownMeasurements(
      {
        reach: { x: 0, z: -4.7075, width: 51.248, height: 34.1, depth: 47.155 },
        walls: { x: 0, z: 0, width: 27.8, depth: 21.8 },
        annexes: [
          { name: 'west_wing', x: 19.3, z: 3.7, width: 10.8, depth: 23.4 },
          { name: 'east_wing', x: -19.3, z: 2.6, width: 10.8, depth: 21.2 },
          { name: 'dais_bay', x: 0, z: 14.6, width: 13.8, depth: 7.4 },
          { name: 'kitchen_chimney', x: 20.3, z: 15.9, width: 3.8, depth: 1 },
        ],
        doorX: 0,
      },
      MANOR_SCALE,
    ),
    walkIn: true,
  },
  placedTownSeat(MANOR_SCALE, FRONT_CLEARANCE * MANOR_SCALE),
);

const BUILDINGS = [INN, CHAPEL, COUNTING_HOUSE, WATCH_HOUSE, SMITHY, MANOR] as const;

// The counting house's market counter (the stall annex on its front): the
// auctioneer keeps it, a stride and a half in front of the boards (the counter
// is the model's, at the building's scale; the stride is a person's).
const COUNTER = { x: 2.375, z: -5.925, depth: 0.77 } as const;
const COUNTER_STANDING_POINT = localToWorld(
  COUNTING_HOUSE.placement,
  COUNTING_HOUSE.rotation,
  COUNTER.x * COUNTING_HOUSE_SCALE,
  (COUNTER.z - COUNTER.depth / 2) * COUNTING_HOUSE_SCALE - 1.3,
);

// Loremaster Caddis gave his corner to the inn's porch: he keeps the square's
// south-west corner, between the mailbox and the turret, facing the well.
const LOREMASTER_POSITION = { x: 8.5, z: 651.5 } as const;

const NPCS = [
  makeTownNpc('brother_aldric_highwatch', CHAPEL.frontStandingPoint, CHAPEL.frontFacing, CHAPEL.id),
  // the bursar keeps the counting house door, the strongbox beside him
  makeTownNpc(
    'bursar_aldous_crane',
    COUNTING_HOUSE.frontStandingPoint,
    COUNTING_HOUSE.frontFacing,
    COUNTING_HOUSE.id,
  ),
  makeTownNpc(
    'auctioneer_voss',
    COUNTER_STANDING_POINT,
    COUNTING_HOUSE.frontFacing,
    `${COUNTING_HOUSE.id}_counter`,
  ),
  makeTownNpc(
    'loremaster_caddis',
    LOREMASTER_POSITION,
    facingToward(LOREMASTER_POSITION, { x: 0, z: 662 }),
    'highwatch_square',
  ),
] as const;

// The Stormcrag road's first stretch: it leaves the square at its north-west
// corner beside the Sanctum road and runs west between the inn's north end
// and the smithy's terrace, then rejoins the old line down to Stormcrag.
const STORMCRAG_ROAD = [
  { x: 4, z: 674 },
  { x: 11, z: 689 },
  { x: 33, z: 691.5 },
  { x: 42, z: 695 },
  { x: 48, z: 700 },
  { x: 56, z: 707 },
  { x: 70, z: 720 },
  { x: 110, z: 760 },
] as const;

/**
 * Level pads under the buildings (terrain edits, applied after the built-in
 * world's other stamps): each building stands on level ground across its
 * whole reach, and the taper beyond carries the grade change into the
 * streets. The shelf is a disc of level ground at y 9; the inn and the
 * counting house stand at its height, cut into the rising ground behind them,
 * the chapel and the watch house a little lower where the road falls toward
 * the gate, the smithy on its terrace above. Each building gets a row of
 * stamps along its long axis rather than one circle, so the level ground
 * hugs its walls instead of spilling across the square.
 */
function padsAlong(
  building: (typeof BUILDINGS)[number],
  height: number,
  columns: number,
  rows: number,
  taper: number,
) {
  const reach = building.reach;
  const cellWidth = (reach.halfWidth * 2) / columns;
  const cellDepth = (reach.halfDepth * 2) / rows;
  const core = Math.hypot(cellWidth / 2, cellDepth / 2);
  const radius = core + taper;
  const pads: { x: number; z: number; radius: number; delta: number; hardness: number }[] = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const center = localToWorld(
        reach.center,
        reach.rotation,
        -reach.halfWidth + cellWidth * (column + 0.5),
        -reach.halfDepth + cellDepth * (row + 0.5),
      );
      pads.push({ x: center.x, z: center.z, radius, delta: height, hardness: core / radius });
    }
  }
  return pads;
}

// The Stormcrag road climbs out of the square's north-west corner between the
// inn (level with the square) and the smithy's terrace: three tilted stamps
// along it grade the lane from the one to the other, applied over the aprons
// and before the pads, so the buildings' own pads keep their ground.
const INN_HEIGHT = 9;
// the manor's pad, cut into the road's shoulder and filled over the hollow west
// of it, a little over the smithy's terrace
const MANOR_HEIGHT = 12.5;
const MANOR_APRON = 14;
const SMITHY_HEIGHT = 10.6;
const INN_NORTH_Z = INN.reach.center.z + INN.reach.halfWidth;
const SMITHY_SOUTH_Z = SMITHY.reach.center.z - SMITHY.reach.halfDepth;
// smithy terrace over inn shelf, across the lane
const ROAD_GRADE_FALL = (SMITHY_HEIGHT - INN_HEIGHT) / (SMITHY_SOUTH_Z - INN_NORTH_Z);
const ROAD_GRADE = [14, 22, 30].map((x) => {
  const z = 689 + ((x - 11) / 22) * 2.5;
  return {
    x,
    z,
    radius: 6,
    delta: INN_HEIGHT + ROAD_GRADE_FALL * (z - INN_NORTH_Z),
    hardness: 0.4,
    gx: 0,
    gz: ROAD_GRADE_FALL,
  };
});

// Each building's pad (`taper`) and its apron (`apron`). A pad's own taper is
// short so it keeps off its neighbours' ground, and on the shelf's rim that
// left banks too steep to walk where the hill rises behind a building or falls
// away before it. So every building first lays a wide, soft apron at its own
// height, before any pad: the hill eases down to it (and the fill out from it)
// at a walkable grade, and the pads, applied after every apron, still level
// each reach exactly. The counting house and the smithy cut deepest into the
// hill, so theirs reach furthest.
const GROUND = [
  { building: INN, height: INN_HEIGHT, columns: 4, rows: 3, taper: 5, apron: 15 },
  { building: COUNTING_HOUSE, height: 8.8, columns: 2, rows: 2, taper: 4, apron: 14 },
  { building: CHAPEL, height: 8.8, columns: 2, rows: 3, taper: 5, apron: 10 },
  { building: WATCH_HOUSE, height: 7.6, columns: 2, rows: 3, taper: 4, apron: 10 },
  { building: SMITHY, height: SMITHY_HEIGHT, columns: 3, rows: 2, taper: 4, apron: 13 },
  { building: MANOR, height: MANOR_HEIGHT, columns: 5, rows: 5, taper: 4, apron: MANOR_APRON },
] as const;

// The aprons reach into the square: this sets the shelf back at its own height
// (level out to 14 yd from the hub) before the road and the pads go down.
const SQUARE_HEIGHT = 9;
const SQUARE_FLAT = 14;
const SQUARE_RELEVEL = {
  x: HUB_CENTER.x,
  z: HUB_CENTER.z,
  radius: SQUARE_FLAT + 2,
  delta: SQUARE_HEIGHT,
  hardness: SQUARE_FLAT / (SQUARE_FLAT + 2),
};

// The crystal cave portal (content/realm.ts, the duskfall_passage side a) sits on its own
// level bench at (10, 770), just past the chapel's back wall: the manor's pads would carry
// it down to the manor's ground, so the bench goes back at its own height after them,
// banking down to the manor's ground before the chapel's back wall (the bank takes the
// open corner of the manor's reach behind the chapel, where the model has no wall).
const PORTAL_BENCH = { x: 10, z: 770, radius: 10.6, delta: 17.3, hardness: 0.5 };

const PADS = [
  ...GROUND.flatMap((g) => padsAlong(g.building, g.height, g.columns, g.rows, g.apron)),
  SQUARE_RELEVEL,
  ...ROAD_GRADE,
  ...GROUND.flatMap((g) => padsAlong(g.building, g.height, g.columns, g.rows, g.taper)),
  PORTAL_BENCH,
].map((pad) => ({ ...pad, falloff: 'smooth' as const, mode: 'level' as const }));

export const HIGHWATCH_LAYOUT = deepFreeze({
  id: 'highwatch_rebuild_v1',
  zoneId: 'thornpeak_heights',
  hub: { center: HUB_CENTER, radius: 20 },
  buildings: BUILDINGS,
  roads: { stormcrag: STORMCRAG_ROAD },
  pads: PADS,
  services: {
    bank: {
      id: 'highwatch_bank_service',
      buildingId: COUNTING_HOUSE.id,
      npcId: 'bursar_aldous_crane',
      entrance: COUNTING_HOUSE.sockets.entrance,
    },
    rest: { id: 'highwatch_inn_rest', buildingId: INN.id },
    npcs: NPCS,
  },
} as const);

/** Derived keyed views retain the exact frozen records owned by HIGHWATCH_LAYOUT. */
export const HIGHWATCH_BUILDINGS_BY_ID = indexById(HIGHWATCH_LAYOUT.buildings);
export const HIGHWATCH_NPC_PLACEMENTS_BY_ID = indexById(HIGHWATCH_LAYOUT.services.npcs);
