// Bridgemere (The Willowfen): the painted rebuild of the town's kit houses, the
// island town inside its ring moat, entered only over the Fenway causeway from
// the south. The island's level top (the hub plateau) is some 30 yd across,
// its banks falling steeply to the moat on the west and north: it takes
// exactly one painted building, the inn, at its authored size, filling the
// island's north half with its long front and door on the causeway's head.
// The little square the kit cottages stood round becomes the inn's forecourt
// at the head of the causeway, keeping every service it had (the well and the
// fire, the stall and its crates, Netter Maris and Bridgewright Alden, the
// mailbox, the board). The chapel crosses the bridge to the Willowfen Barrow,
// the town's graveyard at the causeway's foot. A pure, frozen data/geometry
// module: no engine imports, no randomness, no clocks
// (sim/painted_towns/CLAUDE.md).
import {
  deepFreeze,
  facingToward,
  indexById,
  levelTownPads,
  makeTownNpc,
  type Point2,
  type TownGround,
} from '../placed_town_kit';
import { paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

// The shakes look: Fenrire moss colours, wooden shake roofs.
const LOOK = 'shakes' as const;
const SOUTH_FACING = 0; // the door looks south (-z)

// The island inn: its walls on the level plateau (no pad: the plateau is
// already level, and any stamp here would reach the moat), its door on the
// forecourt and the bridge. It stands at 1.0, not the grand 1.2 (its door
// still clears 4.4 yd): at 1.2 it covers the whole plateau and the ground
// round it is the moat's steep banks. It sits a few yards east of the
// plateau's middle with its back off the north bank, so the ground round it
// stays walkable: the west and north banks drop steeply to the moat's open
// water, the east bank eases down to it.
const INN = paintedTownBuilding({
  id: 'bridgemere_island_inn',
  kind: 'inn',
  model: 'tavern',
  look: LOOK,
  anchor: { x: -364.25, z: 362 },
  rotation: SOUTH_FACING,
  scale: 1,
});
// The barrow chapel: across the bridge at the Willowfen Barrow, between the
// Bogshine road and the east road round the moat, its door and bell tower
// looking north-east over the barrow and the causeway's foot (a chapel by its
// graveyard). The island has no room for it, and this is the one spot within
// 70 yd of the hub that takes it; it stands at 1.0 (its portal still clears 5
// yd) between the two roads and the Bogshine pools.
const CHAPEL = paintedTownBuilding({
  id: 'bridgemere_barrow_chapel',
  kind: 'chapel',
  model: 'hall',
  look: LOOK,
  anchor: { x: -332.95, z: 293.45 },
  rotation: 2.356,
  scale: 1,
});

const BUILDINGS = [INN, CHAPEL] as const;

// Only the chapel stands on a pad: the barrow's ground is a little uneven. Its
// apron stays short (three yards wider and it reaches the pool to its south).
const GROUND: readonly TownGround[] = [
  { building: CHAPEL, height: 1, columns: 2, rows: 3, taper: 3, apron: 4 },
];

// The forecourt's two townsfolk, both still inside the hub circle: the netter
// by the moat's west edge, the bridgewright at the causeway's head watching
// who comes over the bridge he keeps.
const MARIS: Point2 = { x: -349.5, z: 352 };
const ALDEN: Point2 = { x: -356.5, z: 346 };
const NPCS = [
  makeTownNpc('netter_maris', MARIS, facingToward(MARIS, { x: -360, z: 344 }), INN.id),
  makeTownNpc('bridgewright_alden', ALDEN, 2.9, INN.id),
];

/** The Amberfen Steps road over the Fenway causeway, now ending in the inn's
 *  forecourt (it ran on to the hub, under the inn). content/willowfen.ts
 *  reads it. */
export const BRIDGEMERE_CAUSEWAY_ROAD: readonly Point2[] = deepFreeze([
  { x: -372, z: 260 },
  { x: -360, z: 322 },
  { x: -360, z: 350 },
]);

export const BRIDGEMERE_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'bridgemere',
  layoutId: 'bridgemere_painted_v1',
  zoneId: 'willowfen',
  hub: { center: { x: -360, z: 362 }, radius: 20 },
  buildings: BUILDINGS,
  replacedKitBuildings: [
    { kind: 'inn', x: -370, z: 369, w: 6, d: 7, rot: 0.7 },
    { kind: 'house', x: -350, z: 354, w: 6, d: 6, rot: -0.9 },
    { kind: 'house', x: -371, z: 349, w: 5, d: 5, rot: 2.4 },
    { kind: 'chapel', x: -351, z: 370, w: 5, d: 7, rot: -2.1 },
    { kind: 'house', x: -360, z: 375, w: 5, d: 5, rot: 0.1 },
  ],
  replacedDecorProps: [],
  pads: levelTownPads(GROUND),
  npcs: NPCS,
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const BRIDGEMERE_BUILDINGS_BY_ID = indexById(BRIDGEMERE_LAYOUT.buildings);
export const BRIDGEMERE_NPC_PLACEMENTS_BY_ID = indexById(BRIDGEMERE_LAYOUT.npcs);
