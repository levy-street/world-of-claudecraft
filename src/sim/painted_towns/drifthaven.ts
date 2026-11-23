// Drifthaven (The Palmreach): the driftwood village on the strand, its kit
// houses replaced by three painted Tidehold buildings round the square, in the
// pantile look (market colours, barrel pantile roofs, brick and trowelled
// plaster). A pure, frozen data/geometry module: no engine imports, no
// randomness, no clocks (sim/painted_towns/CLAUDE.md).
//
// The square keeps its well, its fire, its stalls and crates, the mud huts and
// tents, the beach dock, the mailbox and the noticeboard, with Salvage-Boss
// Ryna and Pearl-Mother Isha where they stood. The four roads all leave it to
// the north and east (the south road in from the Tanglemouth, the lagoon road
// the navigator walks home along, and the two jungle roads north), so the
// grand buildings close the square's other sides: the inn on the south, a
// house on the west, and the provisioner's shop on the east behind the
// confectioner's game box. The tide scuttlers' beach to the west and the dry
// hollow south-west of it keep the west side shallow. The three hamlet houses
// and the two far homesteads out in the wilds (80 to 330 yd from the square)
// stay kit houses.
import {
  deepFreeze,
  indexById,
  levelTownPads,
  localToWorld,
  makeTownNpc,
  type TownGround,
} from '../placed_town_kit';
import { PAINTED_MODELS, paintedTownBuilding } from './models';
import type { PaintedTownLayout } from './types';

const LOOK = 'pantile' as const;

// The models face local -Z (rotation PI turns the door north, +z; PI / 2
// east, -x; -PI / 2 west, +x: this world's east is -x).
const NORTH_FACING = Math.PI;
const EAST_FACING = Math.PI / 2;
const WEST_FACING = -Math.PI / 2;

// The Wreck Line inn (tavern, 1.2: the door clears 5.3): the square's south
// side, its long front on the square and its back to the strand, clear of
// Palmreach Rest at its north-east corner.
const INN = paintedTownBuilding({
  id: 'drifthaven_wreckline_inn',
  kind: 'inn',
  model: 'tavern',
  look: LOOK,
  anchor: { x: -300.6, z: 791.04 },
  rotation: NORTH_FACING,
  scale: 1.2,
});
// The provisioner's shop (shop_a, 1.5: the door clears 4.9): the square's
// east side between the south road and the lagoon road, its counter and
// awning on the square and the confectioner's game box in its yard (the
// box's world quest area keeps its centre). Quartermaster Vaelen keeps the
// counter.
const SHOP_SCALE = 1.5;
const SHOP = paintedTownBuilding({
  id: 'drifthaven_provisioner',
  kind: 'house',
  model: 'shop_a',
  look: LOOK,
  anchor: { x: -339, z: 821.4 },
  rotation: WEST_FACING,
  scale: SHOP_SCALE,
});
// The strand house (house_a, 1.4, sealed): the square's west side, its door
// on the square. Kept shallow (house_a, not the deeper shop or house_b) so
// its pads stay off the scuttlers' beach to the north-west.
const HOUSE = paintedTownBuilding({
  id: 'drifthaven_strand_house',
  kind: 'house',
  model: 'house_a',
  look: LOOK,
  anchor: { x: -275.51, z: 807.04 },
  rotation: EAST_FACING,
  scale: 1.4,
});

const BUILDINGS = [INN, SHOP, HOUSE] as const;

// The shop's stall counter (the model's own, carried to the shop's scale):
// Vaelen stands a stride in front of its boards, looking out at the square.
const COUNTER = PAINTED_MODELS.shop_a.annexes?.find((annex) => annex.name === 'stall_counter');
if (!COUNTER) throw new Error('shop_a has no stall counter');
const COUNTER_STAND = localToWorld(
  { x: SHOP.placement.x, z: SHOP.placement.z },
  SHOP.rotation,
  COUNTER.x * SHOP_SCALE,
  (COUNTER.z - COUNTER.depth / 2) * SHOP_SCALE - 1.3,
);
const NPCS = [
  makeTownNpc(
    'npc_rift_watch_quartermaster',
    COUNTER_STAND,
    SHOP.frontFacing,
    `${SHOP.id}_counter`,
  ),
] as const;

// The strand is flat (about 2): shallow pads. The house's apron is short so
// no stamp reaches the tide scuttlers' ground at (-252, 840).
const GROUND: readonly TownGround[] = [
  { building: INN, height: 2, columns: 3, rows: 2, taper: 4, apron: 8 },
  { building: SHOP, height: 2.6, columns: 2, rows: 2, taper: 4, apron: 8 },
  { building: HOUSE, height: 1.8, columns: 2, rows: 2, taper: 3, apron: 6 },
];

export const DRIFTHAVEN_LAYOUT: PaintedTownLayout = deepFreeze({
  id: 'drifthaven',
  layoutId: 'drifthaven_painted_v1',
  zoneId: 'palmreach',
  hub: { center: { x: -300, z: 820 }, radius: 16 },
  buildings: BUILDINGS,
  // The inn and the house on the square, and the two lone homesteads inside
  // the town's ground (on the hollow road and the scuttlers' beach).
  replacedKitBuildings: [
    { kind: 'inn', x: -308, z: 824, w: 6, d: 7, rot: 0.9 },
    { kind: 'house', x: -292, z: 814, w: 5, d: 5, rot: -0.7 },
    { kind: 'house', x: -320, z: 780, w: 5, d: 5, rot: 1.8 },
    { kind: 'house', x: -270, z: 820, w: 5, d: 5, rot: -1.1 },
  ],
  replacedDecorProps: [],
  pads: levelTownPads(GROUND),
  npcs: NPCS,
});

/** Derived keyed views retain the exact frozen records owned by the layout. */
export const DRIFTHAVEN_BUILDINGS_BY_ID = indexById(DRIFTHAVEN_LAYOUT.buildings);
export const DRIFTHAVEN_NPC_PLACEMENTS_BY_ID = indexById(DRIFTHAVEN_LAYOUT.npcs);
