// Gibbetmere (The Wraithwood): the painted rebuild of the town's kit houses, a
// shuttered hamlet under the eaves. The fenced square keeps every service it
// had (the well and the fire, the stall and its crates, Sexton Marrow and
// Widow Tansy, the mailbox, the board); the inn stands east of it between the
// Widow's Thicket road and the Crowgate road, the chapel west of it with its
// bell tower over the Wraithwood Graves, and the sexton's house south of the
// graves, its door on them. A pure, frozen data/geometry module: no engine
// imports, no randomness, no clocks (sim/painted_towns/CLAUDE.md).
import { deepFreeze, indexById, levelTownPads, type TownGround } from '../placed_town_kit';
import { paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

// The shakes look: Fenrire moss colours, wooden shake roof, rubble walls.
const LOOK = 'shakes' as const;
const NORTH_FACING = Math.PI; // the door looks north (+z)
const EAST_FACING = Math.PI / 2; // the door looks east (-x)
const WEST_FACING = -Math.PI / 2; // the door looks west (+x)

// The inn: east of the square, its long front and door on the square's open
// east side.
const INN = paintedTownBuilding({
  id: 'gibbetmere_inn',
  kind: 'inn',
  model: 'tavern',
  look: LOOK,
  anchor: { x: 332.36, z: 1421.1 },
  rotation: WEST_FACING,
  scale: 1.2,
});
// The chapel: west of the square facing the inn across the well (the bells
// the Sexton rings), its bell tower at the front's south corner over the
// graves. It stands at 1.0 for the hamlet (its portal still clears 5 yd).
const CHAPEL = paintedTownBuilding({
  id: 'gibbetmere_chapel',
  kind: 'chapel',
  model: 'hall',
  look: LOOK,
  anchor: { x: 388.36, z: 1433.5 },
  rotation: EAST_FACING,
  scale: 1,
});
// The sexton's house: south of the graves (sealed), its door on them.
const SEXTON_HOUSE = paintedTownBuilding({
  id: 'gibbetmere_sexton_house',
  kind: 'house',
  model: 'house_a',
  look: LOOK,
  anchor: { x: 385, z: 1392 },
  rotation: NORTH_FACING,
  scale: 1.4,
});

const BUILDINGS = [INN, CHAPEL, SEXTON_HOUSE] as const;

// Each building's pad and its apron. The inn and the chapel stand at the
// square's own height (2.5), so the square does not move; the house at 3.2 on
// the rise south of the graves.
const GROUND: readonly TownGround[] = [
  { building: INN, height: 2.5, columns: 3, rows: 2, taper: 4, apron: 10 },
  { building: CHAPEL, height: 2.5, columns: 2, rows: 3, taper: 4, apron: 10 },
  { building: SEXTON_HOUSE, height: 3.2, columns: 2, rows: 2, taper: 4, apron: 8 },
];

export const GIBBETMERE_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'gibbetmere',
  layoutId: 'gibbetmere_painted_v1',
  zoneId: 'wraithwood',
  hub: { center: { x: 360, z: 1430 }, radius: 17 },
  buildings: BUILDINGS,
  replacedKitBuildings: [
    { kind: 'inn', x: 352, z: 1434, w: 6, d: 7, rot: 0.5 },
    { kind: 'house', x: 368, z: 1426, w: 6, d: 6, rot: -1.2 },
    { kind: 'house', x: 354, z: 1420, w: 5, d: 5, rot: 2.3 },
    { kind: 'chapel', x: 365, z: 1440, w: 5, d: 7, rot: -2.2 },
  ],
  replacedDecorProps: [],
  pads: levelTownPads(GROUND),
  npcs: [],
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const GIBBETMERE_BUILDINGS_BY_ID = indexById(GIBBETMERE_LAYOUT.buildings);
export const GIBBETMERE_NPC_PLACEMENTS_BY_ID = indexById(GIBBETMERE_LAYOUT.npcs);
