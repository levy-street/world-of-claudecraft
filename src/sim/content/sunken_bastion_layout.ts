// The Sunken Bastion, reworked as an OPEN-AIR sea fortress (docs/design/
// dungeon-rework/sunken_bastion.md): a Gleaming Court bastion drowned at storm
// tide on a headland of old sea cliffs, climbing from the tidal flats at the
// waterline to the Fogbeacon at the top of the headland. The void between the
// terraces is the sea under the fog, sealed by the generated cliffs.
//
// Route (z forward, heights in yards, the sea at SUNKEN_BASTION_SEA_LEVEL):
//   Sea-Gate Landing (4) -> the Tidal Flats (0; G1 G2 G3, patrol A) -> the Sea
//   Gate -> the Lower Bailey (2) round the Drowned Chapel and its moat ring
//   (1; G4 west, G5 east, the Turretback Hermit) -> the Bailey Drawbridge over
//   the ditch -> the Rampart Stair -> the Rampart Walk (14) along the east
//   cliff, two towers (G6 G7, patrol C) -> the Rampart Door -> the Breach
//   Bastion (16, Knight-Commander Olen) -> the Postern Fog Wall -> the Postern
//   Stair DOWN into the Sunken Gaol cleft (1; G8 G9 G10, patrol D) -> the Gaol
//   Grate -> the Drowning Yard (1, Gaoler Ossick) -> the Keep Stair Chain ->
//   the Keep Stair switchbacks up the west cliff (G11 G12 on its balconies) ->
//   the Keep Court (24; G13) -> the Beacon Ward -> the Beacon Crown (30, Vael
//   the Fogbinder) round the Fogbeacon.
//
// Pure data: the sim (height, collision, spawns, gates, encounters) and the
// renderer (terrain, kit, dressing, light) all read this one record.

import type { AuthoredFieldDef, FieldProp, FieldSurface } from '../instances/authored_field/types';

/** Height of the sea bed under the terraces (the void). */
export const SUNKEN_BASTION_VOID_HEIGHT = -30;
/** The sea's surface (render only): below every walkable terrace, lapping at
 *  the tidal flats a couple of yards under their mud. */
export const SUNKEN_BASTION_SEA_LEVEL = -2.5;

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
export const SUNKEN_BASTION_ANCHORS = {
  entry: { x: -10, z: -230 },
  exit: { x: -10, z: -237 },
  landing: { x: -10, z: -226 },
  flats: { x: -10, z: -175 },
  seaGate: { x: 0, z: -130 },
  bailey: { x: 0, z: -88 },
  chapelYard: { x: -55, z: -88 },
  cisternYard: { x: 55, z: -88 },
  drawbridge: { x: 57, z: -37 },
  gatehouse: { x: 57, z: -18 },
  rampart: { x: 57, z: 20 },
  towerOne: { x: 57, z: 36 },
  towerTwo: { x: 57, z: 72 },
  bastion: { x: 57, z: 130 },
  postern: { x: 18, z: 122 },
  gaol: { x: 0, z: 80 },
  drowningYard: { x: -2, z: 24 },
  keepStair: { x: -62, z: 50 },
  balconyOne: { x: -62, z: 24 },
  balconyTwo: { x: -62, z: 86 },
  keepCourt: { x: -54, z: 155 },
  beaconCrown: { x: -4, z: 208 },
} as const;

/** The Breach Bastion, Olen's gun terrace: centre, radius and height. */
export const BREACH_BASTION = { x: 57, z: 130, r: 22, h: 16 } as const;

/** Where a buttress stands on the Breach Bastion rim (yards from its centre). */
export const BUTTRESS_RADIUS = 19.5;
/** A buttress's half size (its collider is a square on the rim). */
export const BUTTRESS_HALF = 2.4;

export interface BastionButtress {
  id: 'nw' | 'n' | 'ne' | 'e';
  x: number;
  z: number;
  /** Bearing from the bastion centre (sim yaw, 0 = +z). */
  yaw: number;
}

/** Olen's four buttresses: north-west, north, north-east and east. */
export const BASTION_BUTTRESSES: readonly BastionButtress[] = (
  [
    ['nw', -Math.PI / 4],
    ['n', 0],
    ['ne', Math.PI / 4],
    ['e', Math.PI / 2],
  ] as const
).map(([id, yaw]) => ({
  id,
  yaw,
  x: BREACH_BASTION.x + Math.sin(yaw) * BUTTRESS_RADIUS,
  z: BREACH_BASTION.z + Math.cos(yaw) * BUTTRESS_RADIUS,
}));

/** The Drowning Yard, Ossick's arena: centre, radius and height. */
export const DROWNING_YARD = { x: -2, z: 24, r: 22, h: 1 } as const;
/** The Drowning Winch over its cage pit, in the yard's centre. */
export const DROWNING_WINCH = { x: -2, z: 24, r: 4.2 } as const;
/** The four Mooring Posts, one per quarter of the yard. */
export const MOORING_POSTS: readonly { id: string; x: number; z: number }[] = [
  { id: 'nw', x: DROWNING_YARD.x - 10.5, z: DROWNING_YARD.z + 10.5 },
  { id: 'ne', x: DROWNING_YARD.x + 10.5, z: DROWNING_YARD.z + 10.5 },
  { id: 'se', x: DROWNING_YARD.x + 10.5, z: DROWNING_YARD.z - 10.5 },
  { id: 'sw', x: DROWNING_YARD.x - 10.5, z: DROWNING_YARD.z - 10.5 },
];

/** The Beacon Crown, Vael's roof: centre, radius and height. */
export const BEACON_CROWN = { x: -4, z: 208, r: 26, h: 30 } as const;
/** The Fogbeacon lighthouse tower in the crown's centre. */
export const FOGBEACON = { x: -4, z: 208, r: 6.5, height: 44 } as const;

/** The Lower Bailey's Drowned Chapel on its island, ringed by the moat. */
/** moatFloor: the flooded ring sits a kerb under the bailey (2), never deeper than
 *  a body can stride (MAX_STEP_HEIGHT 0.9). */
export const BAILEY_CHAPEL = { x: 0, z: -88, island: 19, moat: 30, moatFloor: 1.3 } as const;

const SURFACES: FieldSurface[] = [
  // --- The Sea-Gate Landing and its stair onto the flats -----------------
  {
    kind: 'circle',
    id: 'landing',
    x: -10,
    z: -226,
    r: 13,
    h: 4,
    edge: 'balustrade',
    ground: 'quay',
  },
  {
    kind: 'path',
    id: 'landing_stair',
    points: [
      [-10, -217, 4],
      [-10, -213, 4],
      [-10, -203.5, 0],
      [-10, -197, 0],
    ],
    halfWidth: 6,
    stairs: true,
    edge: 'balustrade',
    ground: 'quay',
  },
  // --- The Tidal Flats (G1, G2, G3, patrol A) --------------------------------
  {
    kind: 'poly',
    id: 'tidal_flats',
    points: [
      [-100, -178],
      [-78, -206],
      [-40, -203],
      [20, -203],
      [62, -196],
      [86, -170],
      [84, -140],
      [70, -131],
      [-70, -131],
      [-92, -148],
    ],
    h: 0,
    edge: 'rock',
    ground: 'mud',
  },
  // --- The Sea Gate ramp and the Lower Bailey ---------------------------------
  // The bailey's south lip runs under the curtain wall, so the wall's footing
  // stands on stone, not over the drop.
  rect('lower_bailey', -80, -131, 80, -44, 2, { edge: 'masonry', ground: 'wetstone' }),
  // The ramp is authored after the bailey so it wins where it cuts into it.
  {
    kind: 'path',
    id: 'sea_gate_ramp',
    points: [
      [0, -140, 0],
      [0, -136, 0],
      [0, -126, 2],
      [0, -122, 2],
    ],
    halfWidth: 7,
    edge: 'masonry',
    ground: 'wetstone',
  },
  // The moat ring round the chapel island: a flooded channel sunk a kerb
  // below the bailey (under MAX_STEP_HEIGHT, so a body strides in and out of
  // it rather than being trapped), and the island inside it.
  {
    kind: 'circle',
    id: 'moat',
    x: BAILEY_CHAPEL.x,
    z: BAILEY_CHAPEL.z,
    r: BAILEY_CHAPEL.moat,
    h: BAILEY_CHAPEL.moatFloor,
    edge: 'masonry',
    ground: 'shallows',
  },
  {
    kind: 'circle',
    id: 'chapel_island',
    x: BAILEY_CHAPEL.x,
    z: BAILEY_CHAPEL.z,
    r: BAILEY_CHAPEL.island,
    h: 2,
    edge: 'masonry',
    ground: 'wetstone',
  },
  // --- The Bailey Drawbridge (walkable once lowered, drawn by the gate) --------
  {
    kind: 'path',
    id: 'drawbridge',
    hidden: true,
    points: [
      [57, -50, 2],
      [57, -46, 2],
      [57, -28, 2],
      [57, -24, 2],
    ],
    halfWidth: 5,
    edge: 'balustrade',
    ground: 'quay',
  },
  rect('gatehouse_yard', 34, -30, 80, -4, 2, { edge: 'masonry', ground: 'wetstone' }),
  // --- The Sunken Gaol cleft (authored before the ramparts, which win where
  //     their towers bulge over it) -----------------------------------------
  {
    kind: 'poly',
    id: 'gaol_yard',
    points: [
      [-42, 56],
      [-42, 98],
      [-28, 108],
      [22, 108],
      [49, 98],
      [49, 56],
    ],
    h: 1,
    edge: 'rock',
    ground: 'mud',
  },
  rect('gaol_neck', -10, 44, 6, 58, 1, { edge: 'rock', ground: 'wetstone' }),
  {
    kind: 'circle',
    id: 'drowning_yard',
    x: DROWNING_YARD.x,
    z: DROWNING_YARD.z,
    r: DROWNING_YARD.r,
    h: DROWNING_YARD.h,
    edge: 'rock',
    ground: 'wetstone',
  },
  // --- The Rampart Stair, the Rampart Walk and its two towers ------------------
  {
    kind: 'path',
    id: 'rampart_stair',
    points: [
      [57, -16, 2],
      [57, -12, 2],
      [57, 8, 14],
      [57, 12, 14],
    ],
    halfWidth: 6,
    stairs: true,
    edge: 'masonry',
    ground: 'wetstone',
  },
  rect('rampart_walk', 49, 8, 65, 98, 14, { edge: 'masonry', ground: 'wetstone' }),
  {
    kind: 'circle',
    id: 'tower_one',
    x: 57,
    z: 36,
    r: 10.5,
    h: 14,
    edge: 'masonry',
    ground: 'flagstone',
  },
  {
    kind: 'circle',
    id: 'tower_two',
    x: 57,
    z: 72,
    r: 10.5,
    h: 14,
    edge: 'masonry',
    ground: 'flagstone',
  },
  // --- The Breach Bastion (Knight-Commander Olen) -----------------------------
  {
    kind: 'path',
    id: 'bastion_ramp',
    points: [
      [57, 94, 14],
      [57, 98, 14],
      [57, 106, 16],
      [57, 110, 16],
    ],
    halfWidth: 6,
    edge: 'masonry',
    ground: 'wetstone',
  },
  {
    kind: 'circle',
    id: 'breach_bastion',
    x: BREACH_BASTION.x,
    z: BREACH_BASTION.z,
    r: BREACH_BASTION.r,
    h: BREACH_BASTION.h,
    edge: 'masonry',
    ground: 'flagstone',
  },
  // --- The Postern Stair down the north cliff into the gaol --------------------
  {
    kind: 'path',
    id: 'postern_stair',
    points: [
      [40, 126, 16],
      [36, 126, 16],
      [26, 126, 13],
      [14, 122, 8.5],
      [6, 114, 4],
      [2, 106, 1],
      [2, 102, 1],
    ],
    halfWidth: 4.5,
    stairs: true,
    edge: 'balustrade',
    ground: 'wetstone',
  },
  // --- The Keep Stair: switchbacks up the west cliff, two balconies -----------
  {
    kind: 'path',
    id: 'keep_stair_one',
    points: [
      [-20, 20, 1],
      [-26, 20, 1],
      [-50, 20, 5],
      [-56, 20, 5],
    ],
    halfWidth: 4.5,
    stairs: true,
    edge: 'rock',
    ground: 'wetstone',
  },
  {
    kind: 'circle',
    id: 'balcony_one',
    x: -62,
    z: 24,
    r: 9,
    h: 5,
    edge: 'balustrade',
    ground: 'wetstone',
  },
  {
    kind: 'path',
    id: 'keep_stair_two',
    points: [
      [-62, 28, 5],
      [-62, 34, 5],
      [-62, 70, 14],
      [-62, 76, 14],
    ],
    halfWidth: 4.5,
    stairs: true,
    edge: 'rock',
    ground: 'wetstone',
  },
  {
    kind: 'circle',
    id: 'balcony_two',
    x: -62,
    z: 86,
    r: 11,
    h: 14,
    edge: 'balustrade',
    ground: 'wetstone',
  },
  {
    kind: 'path',
    id: 'keep_stair_three',
    points: [
      [-62, 92, 14],
      [-61, 98, 14],
      [-58, 126, 23],
      [-56, 132, 24],
      [-55, 138, 24],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'rock',
    ground: 'wetstone',
  },
  // --- The Keep Court (G13) and the Beacon Crown (Vael the Fogbinder) ---------
  rect('keep_court', -84, 132, -24, 178, 24, { edge: 'masonry', ground: 'flagstone' }),
  {
    kind: 'path',
    id: 'crown_stair',
    points: [
      [-30, 170, 24],
      [-26, 174, 24],
      [-17, 186, 30],
      [-14, 190, 30],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'masonry',
    ground: 'flagstone',
  },
  {
    kind: 'circle',
    id: 'beacon_crown',
    x: BEACON_CROWN.x,
    z: BEACON_CROWN.z,
    r: BEACON_CROWN.r,
    h: BEACON_CROWN.h,
    edge: 'masonry',
    ground: 'flagstone',
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
  // Landing: two iron bollards and the quay lanterns (lanterns are lights).
  { kind: 'sb_bollard', x: -19, z: -222, rot: 0.3, r: 0.6, h: 1.2 },
  { kind: 'sb_bollard', x: -1, z: -222, rot: -0.3, r: 0.6, h: 1.2 },
  // The Tidal Flats: the wrecks and outworks the packs hold, clear of the lanes.
  { kind: 'sb_wreck_hull', x: -70, z: -172, rot: 0.55, hw: 3.6, hd: 10, h: 7 },
  { kind: 'sb_wreck_mast', x: 22, z: -198, rot: 1.25, hw: 0.7, hd: 8, h: 1.5 },
  { kind: 'sb_rowboat', x: -30, z: -150, rot: 2.4, hw: 1.3, hd: 2.8, h: 1.1 },
  { kind: 'sb_rowboat', x: 38, z: -142, rot: -0.7, hw: 1.3, hd: 2.8, h: 1.1 },
  { kind: 'sb_outwork_ruin', x: 66, z: -156, rot: 0.9, r: 5.5, h: 9 },
  { kind: 'sb_tide_rocks', x: -84, z: -160, rot: 0.2, r: 4, h: 3 },
  { kind: 'sb_tide_rocks', x: 74, z: -186, rot: 1.9, r: 3.5, h: 3 },
  { kind: 'sb_tide_rocks', x: -48, z: -204, rot: 4.1, r: 3, h: 2.5 },
  // The Sea Gate's two drum towers either side of the portcullis (solid).
  { kind: 'sb_gate_tower', x: -12.4, z: -130, rot: 0, r: 4.3, h: 18 },
  { kind: 'sb_gate_tower', x: 12.4, z: -130, rot: Math.PI, r: 4.3, h: 18 },
  // The drawbridge gatehouse on the far side of the ditch: its two piers are
  // solid (collider-only props under the kit's arch).
  { kind: 'sb_pier', x: 50.3, z: -26, rot: 0, hw: 1.3, hd: 1.3, h: 12 },
  { kind: 'sb_pier', x: 63.7, z: -26, rot: 0, hw: 1.3, hd: 1.3, h: 12 },
  // The Lower Bailey: the Drowned Chapel on its island, the east cistern and
  // the west graveyard of the drowned garrison.
  { kind: 'sb_drowned_chapel', x: 0, z: -88, rot: 0, hw: 8, hd: 12, h: 16 },
  { kind: 'sb_cistern', x: 66, z: -62, rot: 0.3, r: 4.2, h: 2.2 },
  { kind: 'sb_cargo_stack', x: 70, z: -118, rot: 0.2, hw: 2.4, hd: 1.6, h: 2.6 },
  { kind: 'sb_cargo_stack', x: -70, z: -60, rot: -0.4, hw: 2.4, hd: 1.6, h: 2.6 },
  { kind: 'sb_anchor', x: -68, z: -118, rot: 0.8, hw: 1.8, hd: 0.9, h: 3 },
  // The Rampart Walk: a cannon on each tower's seaward bulge.
  { kind: 'sb_cannon', x: 65, z: 42, rot: Math.PI / 2, hw: 0.9, hd: 1.6, h: 1.6 },
  { kind: 'sb_cannon', x: 65, z: 78, rot: Math.PI / 2, hw: 0.9, hd: 1.6, h: 1.6 },
  // The Breach Bastion: the four buttresses on the rim (Olen's core).
  ...[-45, 0, 45, 90].map(
    (deg): FieldProp => ({
      kind: 'sb_buttress',
      x: BREACH_BASTION.x + Math.sin((deg * Math.PI) / 180) * BUTTRESS_RADIUS,
      z: BREACH_BASTION.z + Math.cos((deg * Math.PI) / 180) * BUTTRESS_RADIUS,
      rot: (deg * Math.PI) / 180,
      hw: BUTTRESS_HALF,
      hd: BUTTRESS_HALF,
      h: 11,
    }),
  ),
  // The Sunken Gaol: the flooded well, the dead turnkeys' cell doors (on the
  // cliff), and the brazier stands.
  { kind: 'sb_flooded_well', x: 30, z: 92, rot: 0, r: 3.2, h: 1.6 },
  { kind: 'sb_gibbet_post', x: -14, z: 60, rot: 0, r: 0.7, h: 9 },
  { kind: 'sb_gibbet_post', x: 14, z: 60, rot: 0, r: 0.7, h: 9 },
  // The Drowning Yard: the winch over its cage pit and the four mooring posts.
  {
    kind: 'sb_drowning_winch',
    x: DROWNING_WINCH.x,
    z: DROWNING_WINCH.z,
    rot: 0,
    r: DROWNING_WINCH.r,
    h: 9,
  },
  ...MOORING_POSTS.map(
    (p, i): FieldProp => ({
      kind: 'sb_mooring_post',
      x: p.x,
      z: p.z,
      rot: i * 1.3,
      r: 0.8,
      h: 3,
    }),
  ),
  // The Keep Court: the dry fountain and the court's sentry statues.
  { kind: 'sb_court_fountain', x: -54, z: 150, rot: 0, r: 3.4, h: 2 },
  { kind: 'sb_court_statue', x: -78, z: 138, rot: 0.8, r: 1.4, h: 7 },
  { kind: 'sb_court_statue', x: -78, z: 172, rot: 2.3, r: 1.4, h: 7 },
  // The Beacon Crown: the Fogbeacon tower and the broken merlons on the rim.
  { kind: 'sb_fogbeacon', x: FOGBEACON.x, z: FOGBEACON.z, rot: 0, r: FOGBEACON.r, h: 44 },
  ...ring('sb_crown_merlon', BEACON_CROWN.x, BEACON_CROWN.z, 24.2, [30, 75, 120, 160, 250, 300], {
    r: 1.1,
    h: 2.4,
  }),
];

export const SUNKEN_BASTION_FIELD: AuthoredFieldDef = {
  key: 'sunken_bastion',
  bounds: { minX: -104, maxX: 90, minZ: -242, maxZ: 238 },
  voidHeight: SUNKEN_BASTION_VOID_HEIGHT,
  cliffStep: 1.1,
  mapVoid: 'sea',
  surfaces: SURFACES,
  walls: [
    // The curtain wall across the headland, either side of the Sea Gate.
    { id: 'curtain_west', x: -43.5, z: -130, hw: 36.5, hd: 1.3, rot: 0, height: 11 },
    { id: 'curtain_east', x: 43.5, z: -130, hw: 36.5, hd: 1.3, rot: 0, height: 11 },
  ],
  props: PROPS,
  lightZones: [
    { id: 'landing', x: -10, z: -215, r: 45, key: 0xa9b8b2, accent: 0xffd9a0, fog: 0x55655f },
    { id: 'flats', x: 0, z: -170, r: 70, key: 0x9fb0a8, accent: 0xffd9a0, fog: 0x4f5f5a },
    { id: 'bailey', x: 0, z: -88, r: 70, key: 0x98aaa2, accent: 0xffc890, fog: 0x4a5a55 },
    { id: 'rampart', x: 57, z: 50, r: 60, key: 0xb0c0bc, accent: 0xffd0a0, fog: 0x56665f },
    { id: 'bastion', x: 57, z: 130, r: 40, key: 0xb8c6c4, accent: 0xe8f0ff, fog: 0x5a6a66 },
    { id: 'gaol', x: 0, z: 60, r: 60, key: 0x7f9690, accent: 0x6fe0c0, fog: 0x34443f },
    { id: 'keep', x: -54, z: 130, r: 60, key: 0x9fb2aa, accent: 0xffd9a0, fog: 0x4c5c56 },
    { id: 'crown', x: -4, z: 208, r: 50, key: 0xa8c8b8, accent: 0x9fe0b0, fog: 0x44584f },
  ],
};
