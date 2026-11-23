// Lanternmere (The Amberfall): the painted rebuild of the town's kit houses on
// the Great Mere's north shore. The square round the well keeps every service
// it had (the well and the fire, the two stalls, Reeve Ottoline, the mailbox,
// the board); the Mere and the ferry close it to the north and the Goldmelt
// road comes in from the south. The inn stands west of the square between the
// Harvest Hollow road and the Monolith road, its long front and door on the
// square; across the well the chapel and a house stand east, between the
// orchard road and the Cindermaple roads. A pure, frozen data/geometry module:
// no engine imports, no randomness, no clocks (sim/painted_towns/CLAUDE.md).
import { deepFreeze, indexById, levelTownPads, type TownGround } from '../placed_town_kit';
import { paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

// The thatch look: old town colours, thatch roof, rubble walls, hewn beams.
const LOOK = 'thatch' as const;
const SOUTH_FACING = 0; // the door looks south (-z)
const EAST_FACING = Math.PI / 2; // the door looks east (-x)
const WEST_FACING = -Math.PI / 2; // the door looks west (+x)

// The inn: west of the square on the rise, its long front and door on the
// square looking straight at the well. Its back stays short of the drop to
// the sea, its south end out of the gloam foxes' ground.
const INN = paintedTownBuilding({
  id: 'lanternmere_inn',
  kind: 'inn',
  model: 'tavern',
  look: LOOK,
  anchor: { x: -331.86, z: 2073.5 },
  rotation: EAST_FACING,
  scale: 1.2,
});
// The chapel: east of the square, its door facing the inn's across the well and
// its bell tower over the Cindermaple road junction. It stands at 1.0 (its
// portal still clears 5 yd): at 1.2 it closes on the Cindermaple roads or on
// the house in every position between them.
const CHAPEL = paintedTownBuilding({
  id: 'lanternmere_chapel',
  kind: 'chapel',
  model: 'hall',
  look: LOOK,
  anchor: { x: -392.86, z: 2076.5 },
  rotation: WEST_FACING,
  scale: 1,
});
// A house south of the chapel (sealed), its door on the orchard road.
const HOUSE = paintedTownBuilding({
  id: 'lanternmere_house',
  kind: 'house',
  model: 'house_a',
  look: LOOK,
  anchor: { x: -389.53, z: 2058.86 },
  rotation: SOUTH_FACING,
  scale: 1.4,
});

const BUILDINGS = [INN, CHAPEL, HOUSE] as const;

// Each building's pad and its apron, all three at 3.0, a step above the square
// (which stays at 2.5). The aprons are small so the chapel's stay off the
// Mere's footprint and the inn's off the foxes' ground.
const GROUND: readonly TownGround[] = [
  { building: INN, height: 3, columns: 3, rows: 2, taper: 4, apron: 6 },
  { building: CHAPEL, height: 3, columns: 2, rows: 3, taper: 4, apron: 6 },
  { building: HOUSE, height: 3, columns: 2, rows: 2, taper: 4, apron: 6 },
];

export const LANTERNMERE_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'lanternmere',
  layoutId: 'lanternmere_painted_v1',
  zoneId: 'amberfall',
  hub: { center: { x: -360, z: 2072 }, radius: 24 },
  buildings: BUILDINGS,
  replacedKitBuildings: [
    { kind: 'inn', x: -372, z: 2066, w: 6, d: 7, rot: 0.6 },
    { kind: 'house', x: -348, z: 2062, w: 6, d: 6, rot: -0.8 },
    { kind: 'house', x: -374, z: 2084, w: 6, d: 6, rot: 2.0 },
    { kind: 'chapel', x: -346, z: 2082, w: 5, d: 7, rot: -2.2 },
  ],
  replacedDecorProps: [],
  pads: levelTownPads(GROUND),
  npcs: [],
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const LANTERNMERE_BUILDINGS_BY_ID = indexById(LANTERNMERE_LAYOUT.buildings);
export const LANTERNMERE_NPC_PLACEMENTS_BY_ID = indexById(LANTERNMERE_LAYOUT.npcs);
