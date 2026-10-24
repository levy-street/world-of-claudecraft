// The Drowned Temple, reworked as an OPEN-AIR temple half sunk in a lagoon
// (docs/design/dungeon-rework/drowned_temple.md): the Glimmermere's crater at
// the night the temple drowned, a moon impossibly large over the north rim,
// waterfalls pouring off the crater wall, and on an island in the middle of
// the lagoon the Moon Altar under a column of silver light. Every walkway is a
// terrace, causeway or stair standing out of the water; the void between them
// is the lake bed under the lagoon, sealed by the generated cliffs.
//
// Route (z forward, heights in yards, the lagoon at DROWNED_TEMPLE_WATER_LEVEL):
//   Moongate Landing (30) on the south rim -> the Pilgrim Steps down the crater
//   wall, their mid landing (17; G1) -> the Reflecting Causeway (1.2; G2 on the
//   stepping stones, G3 on the island, patrol A) -> the Colonnade of Tides (1.8;
//   G4, G5) -> the Choir Veil -> the Choir Court (4, Choirmother Selthe) -> the
//   Court Stairs, west and east -> west the Tidepool Terraces (7 and 12; G6,
//   G7), east the Waterfall Walk behind the falls (8 and 10; G8, G9, patrol B)
//   -> the Hydra Pool (6, the Mere Hydra) -> the Prism Stair (rises from the
//   pool when it drains; 12 and 18; G10, G11, patrol C) -> the Prism Ward ->
//   the Prism Terrace (20, the Tideglass Colossus) -> the Moonbridge (a bridge
//   of light) -> the Altar Landing (13; G12, G13) -> the Altar Ward -> the Moon
//   Altar island (12, Ysolei).
//
// The whole walkable field stays inside the instance slot's footprint
// (|x| < 115, |z| < 245): the claim, the trash kit and the gates count a
// player as "inside" only within |x| < 120 and |z| < 250 of the origin.
//
// Pure data: the sim (height, collision, spawns, gates, encounters) and the
// renderer (terrain, kit, dressing, light) all read this one record.

import type { AuthoredFieldDef, FieldProp, FieldSurface } from '../instances/authored_field/types';

/** The lake bed under the lagoon (the void between the walkways). */
export const DROWNED_TEMPLE_VOID_HEIGHT = -30;
/** The lagoon's surface (render only): a little under the lowest causeway. */
export const DROWNED_TEMPLE_WATER_LEVEL = 0;

function rect(
  id: string,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  h: number,
  extra: Partial<Pick<FieldSurface, 'edge' | 'ground'>> = {},
): FieldSurface {
  return {
    kind: 'poly',
    id,
    points: [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ],
    h,
    ...extra,
  };
}

/** Named anchors: spawns, dev teleports and the renderer's set pieces. */
export const DROWNED_TEMPLE_ANCHORS = {
  entry: { x: 0, z: -230 },
  exit: { x: 0, z: -236 },
  landing: { x: 0, z: -228 },
  pilgrimLanding: { x: -34, z: -189 },
  causeway: { x: -4, z: -140 },
  stones: { x: -16, z: -128 },
  island: { x: 15, z: -104 },
  colonnade: { x: 0, z: -60 },
  choirVeil: { x: 0, z: -34 },
  court: { x: 0, z: 0 },
  terraceLow: { x: -54, z: 22 },
  terraceHigh: { x: -66, z: 68 },
  ledge: { x: 54, z: 22 },
  grotto: { x: 80, z: 66 },
  pool: { x: 0, z: 92 },
  prismLow: { x: 42, z: 136 },
  prismHigh: { x: 72, z: 164 },
  prismTerrace: { x: 86, z: 208 },
  altarLanding: { x: 27, z: 207 },
  altar: { x: -30, z: 206 },
} as const;

/** The Choir Court, Choirmother Selthe's amphitheater stage. */
export const CHOIR_COURT = { x: 0, z: 0, r: 26, h: 4 } as const;
/** The Great Conch behind the stage (render hero piece, in the water). */
export const GREAT_CONCH = { x: 0, z: 40 } as const;

/** The Hydra Pool: its rim, and the moon pool the heads rise from. */
export const HYDRA_POOL = { x: 0, z: 92, r: 28, h: 6, poolR: 13, poolFloor: 5.3 } as const;
/** The Mere Hydra's body under the pool (render: where its one model stands,
 *  facing the entrance, and how big). Its scale stands the heads as tall over
 *  the water as the body it replaced (about 16 yd at Idle). */
export const HYDRA_BODY = { x: HYDRA_POOL.x, z: HYDRA_POOL.z + 5, scale: 1.28 } as const;
/** Where each of the Mere Hydra's three heads rises in the pool: under the
 *  model's own heads (its left head is the one on its left, the east as it
 *  faces the entrance), so a head's click and its drawn neck agree. */
export const HYDRA_HEADS: readonly { id: 'left' | 'center' | 'right'; x: number; z: number }[] = [
  { id: 'left', x: HYDRA_BODY.x + 5.1, z: HYDRA_BODY.z - 0.5 },
  { id: 'center', x: HYDRA_BODY.x, z: HYDRA_BODY.z - 0.1 },
  { id: 'right', x: HYDRA_BODY.x - 5.3, z: HYDRA_BODY.z - 0.2 },
];

/** The broken columns round the Hydra Pool's rim (degrees round the pool,
 *  0 toward +z): the only cover from the Mere Hydra's Tsunami. */
export const HYDRA_POOL_COLUMN_DEGS = [45, 80, 280, 315] as const;
export const HYDRA_POOL_COLUMN_RING = 24.5;
export const HYDRA_POOL_COLUMN_R = 1.3;
/** Each rim column's centre (instance-local yards). */
export const HYDRA_POOL_COLUMNS: readonly { x: number; z: number }[] = HYDRA_POOL_COLUMN_DEGS.map(
  (deg) => ({
    x: HYDRA_POOL.x + Math.sin((deg * Math.PI) / 180) * HYDRA_POOL_COLUMN_RING,
    z: HYDRA_POOL.z + Math.cos((deg * Math.PI) / 180) * HYDRA_POOL_COLUMN_RING,
  }),
);

/** The Prism Terrace, the Tideglass Colossus's round terrace. */
export const PRISM_TERRACE = { x: 86, z: 208, r: 22, h: 20 } as const;
/** The Colossus's plinth in the terrace's centre. */
export const PRISM_PLINTH = { x: 86, z: 210, r: 4.5 } as const;

/** The Moon Altar island, Ysolei's arena, split by an east-west causeway. */
export const MOON_ALTAR = { x: -30, z: 206, r: 26, h: 12 } as const;
/** The altar stone in the island's centre (under the silver column). */
export const ALTAR_STONE = { x: -30, z: 206, r: 3 } as const;
/** Ysolei's dais: a raised ring floor round her coil, sized to her (her
 *  bodyRadius 10 plus the melee ring standing on its rim), centred where she
 *  coils against the altar stone's east face. */
export const YSOLEI_DAIS = {
  x: ALTAR_STONE.x + ALTAR_STONE.r + 0.6,
  z: 206,
  r: 13.5,
  rise: 0.4,
} as const;

/** The Moonbridge between the Prism Terrace and the Altar Landing. */
export const MOONBRIDGE = {
  fromX: 66,
  toX: 38,
  z: 208,
  fromH: 20,
  toH: 13,
  halfWidth: 4.5,
} as const;

const SURFACES: FieldSurface[] = [
  // --- The Moongate Landing on the crater's south rim ---------------------------
  {
    kind: 'circle',
    id: 'moongate_landing',
    x: 0,
    z: -228,
    r: 11,
    h: 30,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  // --- The Pilgrim Steps: down the crater wall, a landing half way (G1) --------
  {
    kind: 'path',
    id: 'pilgrim_steps_upper',
    points: [
      [3.9, -218.1, 30],
      [0, -215, 30],
      [-24, -196, 17],
      [-28, -193, 17],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  {
    kind: 'circle',
    id: 'pilgrim_landing',
    x: -34,
    z: -189,
    r: 10,
    h: 17,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  {
    kind: 'path',
    id: 'pilgrim_steps_lower',
    points: [
      [-31, -183, 17],
      [-27.5, -178, 17],
      [-11.3, -155, 1.2],
      [-9.5, -152.5, 1.2],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  // --- The Reflecting Causeway (G2 stones, G3 island, patrol A) -----------------
  {
    kind: 'path',
    id: 'reflecting_causeway',
    points: [
      [-10.2, -154.5, 1.2],
      [-5, -140, 1.2],
      [0, -112, 1.2],
      [0, -92, 1.2],
      [0, -82, 1.8],
      [0, -76, 1.8],
    ],
    halfWidth: 6,
    edge: 'masonry',
    ground: 'wetstone',
  },
  {
    kind: 'circle',
    id: 'stepping_stones',
    x: -16,
    z: -128,
    r: 9,
    h: 1.2,
    edge: 'rock',
    ground: 'wetstone',
  },
  {
    kind: 'circle',
    id: 'causeway_island',
    x: 15,
    z: -104,
    r: 11,
    h: 1.2,
    edge: 'rock',
    ground: 'wetstone',
  },
  // --- The Colonnade of Tides (G4, G5) --------------------------------------------
  rect('colonnade', -18, -80, 18, -40, 1.8, { edge: 'masonry', ground: 'flagstone' }),
  // --- The Choir Stair up to the court (the Choir Veil across it) --------------
  {
    kind: 'path',
    id: 'choir_stair',
    points: [
      [0, -44, 1.8],
      [0, -40, 1.8],
      [0, -29, 4],
      [0, -22, 4],
    ],
    halfWidth: 6,
    stairs: true,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  // --- The Choir Court (Choirmother Selthe) ---------------------------------------
  {
    kind: 'circle',
    id: 'choir_court',
    x: CHOIR_COURT.x,
    z: CHOIR_COURT.z,
    r: CHOIR_COURT.r,
    h: CHOIR_COURT.h,
    edge: 'masonry',
    ground: 'flagstone',
  },
  // --- West: the Court Stair and the Tidepool Terraces (G6, G7) -----------------
  {
    kind: 'path',
    id: 'court_stair_west',
    points: [
      [-19, 9, 4],
      [-23, 10.5, 4],
      [-39, 16, 7],
      [-44, 18, 7],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  {
    kind: 'circle',
    id: 'tidepool_terrace_low',
    x: -54,
    z: 22,
    r: 12,
    h: 7,
    edge: 'masonry',
    ground: 'wetstone',
  },
  {
    kind: 'path',
    id: 'tidepool_stair',
    points: [
      [-58, 30, 7],
      [-60, 35, 7],
      [-65, 52, 12],
      [-66, 58, 12],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'masonry',
    ground: 'wetstone',
  },
  {
    kind: 'circle',
    id: 'tidepool_terrace_high',
    x: -66,
    z: 68,
    r: 12,
    h: 12,
    edge: 'masonry',
    ground: 'wetstone',
  },
  {
    kind: 'path',
    id: 'tidepool_descent',
    points: [
      [-58, 75, 12],
      [-54, 77, 12],
      [-34, 87, 6],
      [-24, 90, 6],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'masonry',
    ground: 'wetstone',
  },
  // --- East: the Court Stair and the Waterfall Walk (G8, G9, patrol B) ----------
  {
    kind: 'path',
    id: 'court_stair_east',
    points: [
      [19, 9, 4],
      [23, 10.5, 4],
      [39, 16, 8],
      [44, 18, 8],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  {
    kind: 'circle',
    id: 'waterfall_ledge',
    x: 54,
    z: 22,
    r: 12,
    h: 8,
    edge: 'rock',
    ground: 'wetstone',
  },
  {
    kind: 'path',
    id: 'waterfall_walk',
    points: [
      [60, 30, 8],
      [63, 35, 8],
      [74, 52, 10],
      [76, 56, 10],
    ],
    halfWidth: 5,
    edge: 'rock',
    ground: 'wetstone',
  },
  {
    kind: 'circle',
    id: 'waterfall_grotto',
    x: 80,
    z: 66,
    r: 12,
    h: 10,
    edge: 'rock',
    ground: 'wetstone',
  },
  {
    kind: 'path',
    id: 'grotto_descent',
    points: [
      [72, 72, 10],
      [68, 75, 10],
      [34, 87, 6],
      [24, 90, 6],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'rock',
    ground: 'wetstone',
  },
  // --- The Hydra Pool (the Mere Hydra): the rim and the moon pool ---------------
  {
    kind: 'circle',
    id: 'hydra_pool_rim',
    x: HYDRA_POOL.x,
    z: HYDRA_POOL.z,
    r: HYDRA_POOL.r,
    h: HYDRA_POOL.h,
    edge: 'masonry',
    ground: 'flagstone',
  },
  // The moon pool a wading step below the rim (under MAX_STEP_HEIGHT, so a
  // body strides in and out of it), where the three heads rise.
  {
    kind: 'circle',
    id: 'hydra_moon_pool',
    x: HYDRA_POOL.x,
    z: HYDRA_POOL.z,
    r: HYDRA_POOL.poolR,
    h: HYDRA_POOL.poolFloor,
    edge: 'masonry',
    ground: 'shallows',
  },
  // --- The Prism Stair: rises out of the lagoon as the pool drains (G10, G11) ----
  {
    kind: 'path',
    id: 'prism_stair_sunken',
    hidden: true,
    points: [
      [13, 109, 6],
      [16.5, 112.3, 6],
      [34.5, 128.7, 12],
      [38, 132, 12],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  {
    kind: 'circle',
    id: 'prism_landing_low',
    x: 42,
    z: 136,
    r: 9,
    h: 12,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  {
    kind: 'path',
    id: 'prism_stair',
    points: [
      [47, 142, 12],
      [50, 145, 12],
      [64, 157, 18],
      [67, 160, 18],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  {
    kind: 'circle',
    id: 'prism_landing_high',
    x: 72,
    z: 164,
    r: 9,
    h: 18,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  {
    kind: 'path',
    id: 'prism_approach',
    points: [
      [75, 170, 18],
      [77, 174, 18],
      [81, 183, 20],
      [82, 188, 20],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  // --- The Prism Terrace (the Tideglass Colossus) --------------------------------
  {
    kind: 'circle',
    id: 'prism_terrace',
    x: PRISM_TERRACE.x,
    z: PRISM_TERRACE.z,
    r: PRISM_TERRACE.r,
    h: PRISM_TERRACE.h,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  // --- The Moonbridge (walkable once assembled, drawn by its gate) ---------------
  {
    kind: 'path',
    id: 'moonbridge',
    hidden: true,
    points: [
      [MOONBRIDGE.fromX + 3, MOONBRIDGE.z, MOONBRIDGE.fromH],
      [MOONBRIDGE.fromX, MOONBRIDGE.z, MOONBRIDGE.fromH],
      [MOONBRIDGE.toX, MOONBRIDGE.z, MOONBRIDGE.toH],
      [MOONBRIDGE.toX - 3, MOONBRIDGE.z, MOONBRIDGE.toH],
    ],
    halfWidth: MOONBRIDGE.halfWidth,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  // --- The Altar Landing (G12, G13) and the Altar Ward ---------------------------
  rect('altar_landing', 14, 190, 40, 224, 13, { edge: 'balustrade', ground: 'flagstone' }),
  {
    kind: 'path',
    id: 'altar_causeway',
    points: [
      [17, 206, 13],
      [13, 206, 13],
      [2, 206, 12],
      [-7, 206, 12],
    ],
    halfWidth: 5.5,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  // --- The Moon Altar island (Ysolei) ----------------------------------------------
  {
    kind: 'circle',
    id: 'moon_altar',
    x: MOON_ALTAR.x,
    z: MOON_ALTAR.z,
    r: MOON_ALTAR.r,
    h: MOON_ALTAR.h,
    edge: 'masonry',
    ground: 'flagstone',
  },
  // Ysolei's dais (after the island, so it wins there).
  {
    kind: 'circle',
    id: 'ysolei_dais',
    x: YSOLEI_DAIS.x,
    z: YSOLEI_DAIS.z,
    r: YSOLEI_DAIS.r,
    h: MOON_ALTAR.h + YSOLEI_DAIS.rise,
    edge: 'masonry',
    ground: 'ritual',
  },
];

function ring(
  kind: string,
  cx: number,
  cz: number,
  radius: number,
  degs: readonly number[],
  extra: Partial<FieldProp>,
): FieldProp[] {
  return degs.map((deg) => {
    const a = (deg * Math.PI) / 180;
    return {
      kind,
      x: cx + Math.sin(a) * radius,
      z: cz + Math.cos(a) * radius,
      rot: a,
      ...extra,
    };
  });
}

const PROPS: FieldProp[] = [
  // The Moongate itself behind the arrival, and two pale braziers on the rim.
  { kind: 'dt_moongate', x: 0, z: -238, rot: 0, hw: 6, hd: 1.2, h: 12 },
  { kind: 'dt_brazier', x: -8, z: -222, rot: 0, r: 0.8, h: 2 },
  { kind: 'dt_brazier', x: 8, z: -222, rot: 0, r: 0.8, h: 2 },
  // The pilgrims' way-shrine on the mid landing.
  { kind: 'dt_wayshrine', x: -41, z: -195, rot: 0.9, r: 1.6, h: 5 },
  // The stepping stones' fallen choir statue and the island's broken obelisk.
  { kind: 'dt_statue_fallen', x: -22, z: -134, rot: 0.6, hw: 1.4, hd: 3.2, h: 1.8 },
  { kind: 'dt_obelisk', x: 21, z: -98, rot: 0.3, r: 1.6, h: 11 },
  // The Colonnade of Tides: two rows of drowned columns along its sides.
  ...[-74, -64, -54, -44].flatMap((z): FieldProp[] => [
    { kind: 'dt_column', x: -15.5, z, rot: 0, r: 1.3, h: 12 },
    { kind: 'dt_column', x: 15.5, z, rot: Math.PI, r: 1.3, h: 12 },
  ]),
  // The Choir Court: the two lamp pillars flanking the stage.
  { kind: 'dt_lamp_pillar', x: -12, z: 18, rot: 0, r: 1.2, h: 7 },
  { kind: 'dt_lamp_pillar', x: 12, z: 18, rot: 0, r: 1.2, h: 7 },
  // The Tidepool Terraces: basins of glowing tide water.
  { kind: 'dt_tidepool_basin', x: -60, z: 16, rot: 0.4, r: 2.6, h: 1.1 },
  { kind: 'dt_tidepool_basin', x: -72, z: 72, rot: 1.8, r: 2.6, h: 1.1 },
  { kind: 'dt_coral_cluster', x: -46, z: 30, rot: 0.2, r: 1.6, h: 3 },
  // The Waterfall Walk: a rock spur between the ledge and the grotto.
  { kind: 'dt_coral_cluster', x: 88, z: 72, rot: 2.1, r: 1.6, h: 3 },
  // The Hydra Pool: broken columns round the rim (the Tsunami's only cover).
  ...ring(
    'dt_column_broken',
    HYDRA_POOL.x,
    HYDRA_POOL.z,
    HYDRA_POOL_COLUMN_RING,
    HYDRA_POOL_COLUMN_DEGS,
    {
      r: HYDRA_POOL_COLUMN_R,
      h: 6,
    },
  ),
  // The Prism Terrace: the Colossus's plinth and the ring of broken columns.
  // The Colossus's low plinth (render only: it never leaves it, and the fight
  // is fought on its step).
  { kind: 'dt_prism_plinth', x: PRISM_PLINTH.x, z: PRISM_PLINTH.z, rot: 0 },
  ...ring(
    'dt_column_broken',
    PRISM_TERRACE.x,
    PRISM_TERRACE.z,
    19.5,
    [20, 70, 120, 160, 220, 320],
    {
      r: 1.2,
      h: 5,
    },
  ),
  // The Altar Landing: two pale-fire braziers.
  { kind: 'dt_brazier', x: 22, z: 196, rot: 0, r: 0.8, h: 2 },
  { kind: 'dt_brazier', x: 22, z: 218, rot: 0, r: 0.8, h: 2 },
  // The Moon Altar in the island's centre, and its ring of standing stones.
  // The altar is drawn only (no footprint): an interior collider walls sight at
  // any height (colliders.ts sightBlockedAt), and the stone sits wholly inside
  // Ysolei's body (her bodyRadius round her pivot on its east face), so a
  // footprint only ever hid her from the casters behind it (playtest).
  { kind: 'dt_moon_altar', x: ALTAR_STONE.x, z: ALTAR_STONE.z, rot: 0 },
  ...ring('dt_standing_stone', MOON_ALTAR.x, MOON_ALTAR.z, 23.5, [30, 150, 210, 330], {
    r: 1.1,
    h: 7,
  }),
];

export const DROWNED_TEMPLE_FIELD: AuthoredFieldDef = {
  key: 'drowned_temple',
  bounds: { minX: -115, maxX: 115, minZ: -244, maxZ: 244 },
  voidHeight: DROWNED_TEMPLE_VOID_HEIGHT,
  cliffStep: 1.1,
  mapVoid: 'sea',
  surfaces: SURFACES,
  walls: [],
  props: PROPS,
  lightZones: [
    { id: 'rim', x: 0, z: -215, r: 45, key: 0xc9d6ee, accent: 0xdde8f5, fog: 0x2a2f4f },
    { id: 'causeway', x: 0, z: -120, r: 70, key: 0xb8c9e6, accent: 0x9fe6ee, fog: 0x283052 },
    { id: 'court', x: 0, z: 0, r: 60, key: 0xc4cff0, accent: 0xe3c06a, fog: 0x2a2d52 },
    { id: 'terraces', x: -60, z: 45, r: 50, key: 0xb2c6e2, accent: 0x6fe3e0, fog: 0x243052 },
    { id: 'falls', x: 70, z: 45, r: 50, key: 0xb6cbe8, accent: 0x9fdcff, fog: 0x263455 },
    { id: 'pool', x: 0, z: 92, r: 45, key: 0xbccbef, accent: 0x6fe3e0, fog: 0x273052 },
    { id: 'prism', x: 80, z: 190, r: 55, key: 0xd0d4f6, accent: 0xb9a6ff, fog: 0x2c2c58 },
    { id: 'altar', x: -20, z: 206, r: 55, key: 0xdde4fa, accent: 0xdde8f5, fog: 0x2e2e5a },
  ],
};
