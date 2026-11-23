// The Wildheart Basin (docs/design/dungeon-rework/wildheart_basin.md): a closed
// jungle caldera behind the Sunken Idol in the Palmreach, rebuilt on the shared
// authored-field engine (G9). Cliff walls ring the whole basin; the river
// braids across its floor and falls into the gorge between the terraces; three
// waterfalls pour from the rim; the colony ruins of the Court sleep under the
// roots; the Sunbone shrine stands on a stepped pyramid under a colossal stone
// jaguar head. Every walkway is a basalt terrace, a fern stair, a ford, a vine
// bridge or a causeway; the void between them is the river gorge, sealed by
// the generated cliffs.
//
// Route (z forward, heights in yards):
//   the Idol Maw Landing (40; the first vista over the caldera) -> the Fern
//   Steps down the south wall (40 to 24; G1 on the fern landing, then on down
//   to the bank) -> the River Ford (0; G2 on the south bank, G3 on the basalt
//   steps, patrol A: the Great Saurian wading the shallows) -> the Twin Vine
//   Bridges (woven once G1, G2, G3 and the Saurian are dead) -> BOTH wings in
//   either order:
//     west, the Hunt Terraces (10 and 16; G4, G5, patrol B) -> the Beast Pits
//     thorn wall -> the Beast Pits (20; the Fanglord Beastmaster and his Great
//     Jaguar, three sunken pits);
//     east, the Waterfall Walk ledge (5; G6) -> the path behind the Weeping
//     Falls (15; G7) -> the Weeping Falls thorn wall -> the Weeping Falls pool
//     terrace (5; the Gorgebloom rooted at its front, the loam beds);
//   -> the Sunbone Causeway (its thorn wall recedes once BOTH wing bosses are
//   dead) -> the Central Island (10; the ruined Court colony, G8, G9, patrol C)
//   -> the Convergence Stair warded arch -> the Upper Convergence (20; G10,
//   G11) -> the Shrine Stair up the pyramid (20 to 45; G12 on the first
//   landing, G13 on the top landing, patrol D) -> the Shrine Ward -> the Jaguar
//   Shrine Terrace (45; Zulgar, the six sun glyphs, the stone jaguar head).
//
// Engine limit: ONE floor height per point, so every bridge spans open air
// beside the ground it looks onto, never over a floor. The whole walkable
// field stays inside the instance slot's footprint (|x| < 115, |z| < 245):
// the claim, the trash kit and the gates count a player as "inside" only
// within |x| < 120 and |z| < 250 of the origin.
//
// Pure data: the sim (height, collision, spawns, gates, encounters) and the
// renderer (terrain, set dressing, waterfalls, light) all read this one record.

import type { AuthoredFieldDef, FieldProp, FieldSurface } from '../instances/authored_field/types';

/** The river gorge under the terraces (the void between the walkways). */
export const WILDHEART_BASIN_VOID_HEIGHT = -25;

/** Named anchors: spawns, dev teleports and the renderer's set pieces. */
export const WILDHEART_BASIN_ANCHORS = {
  entry: { x: 0, z: -217 },
  exit: { x: 0, z: -229 },
  landing: { x: 0, z: -222 },
  fernLanding: { x: -34, z: -180 },
  southBank: { x: 0, z: -140 },
  ford: { x: -18, z: -109 },
  basaltSteps: { x: 41, z: -106 },
  northBank: { x: 0, z: -85 },
  huntLower: { x: -90, z: -60 },
  huntUpper: { x: -86, z: -12 },
  beastPits: { x: -86, z: 40 },
  waterfallLedge: { x: 92, z: -62 },
  behindFalls: { x: 102, z: -12 },
  weepingFalls: { x: 84, z: 42 },
  causeway: { x: 0, z: -62 },
  island: { x: 0, z: 16 },
  convergence: { x: 0, z: 110 },
  shrineLanding1: { x: 0, z: 152 },
  shrineLanding2: { x: 0, z: 180 },
  shrineTerrace: { x: 0, z: 216 },
} as const;

// ---- heights of the levels -------------------------------------------------------

export const WILDHEART_HEIGHTS = {
  landing: 40,
  fernLanding: 24,
  bank: 0.8,
  ford: 0,
  huntLower: 10,
  huntUpper: 16,
  beastPits: 20,
  /** The three sunken pits, a stride below the Beast Pits floor. */
  pit: 19.3,
  ledge: 5,
  behindFalls: 15,
  fallsTerrace: 5,
  island: 10,
  convergence: 20,
  shrineLanding1: 30,
  shrineLanding2: 40,
  shrineTerrace: 45,
} as const;

/** The Idol Maw Landing on the caldera's south wall (the first vista). */
export const IDOL_LANDING = { x: 0, z: -222, r: 13, h: WILDHEART_HEIGHTS.landing } as const;

/** The River Ford: ankle-deep shallows across a basalt sill, where the river
 *  crosses the basin floor before it falls into the gorge. The Great Saurian
 *  wades it (patrol A). The renderer draws its water from this box. */
export const RIVER_FORD = { x0: -72, z0: -128, x1: 72, z1: -90, h: 0 } as const;

/** The basalt steps in the ford's east half (G3 stands on them): three stacked
 *  hex-column drums, each a stride above the last. */
export const BASALT_STEPS: readonly { x: number; z: number; r: number; h: number }[] = [
  { x: 38, z: -106, r: 10, h: 0.8 },
  { x: 41, z: -106, r: 6.5, h: 1.6 },
  { x: 43, z: -106, r: 3.5, h: 2.4 },
];

/** The Twin Vine Bridges over the gorge (walkable once woven, drawn by their
 *  gates): ford to the Hunt Terraces (west) and to the Waterfall Walk (east). */
export const VINE_BRIDGES = {
  west: [
    [-62, -100, 0],
    [-69, -93, 0],
    [-82, -80, 10],
    [-86, -76, 10],
  ],
  east: [
    [62, -100, 0],
    [69, -93, 0],
    [81, -81, 5],
    [85, -75, 5],
  ],
  halfWidth: 4,
} as const satisfies {
  west: readonly (readonly [number, number, number])[];
  east: readonly (readonly [number, number, number])[];
  halfWidth: number;
};

/** The Beast Pits: a ring of three connected sunken pits, the Fanglord
 *  Beastmaster's arena (phase B: Pack Bond, Stalk). */
export const BEAST_PITS = { x: -86, z: 40, r: 24, h: WILDHEART_HEIGHTS.beastPits } as const;
export const BEAST_PIT_HOLES: readonly { x: number; z: number; r: number }[] = [
  { x: -95, z: 33, r: 7 },
  { x: -77, z: 33, r: 7 },
  { x: -86, z: 49, r: 7 },
];
/** The raised judging stone at the pits' north rim (render, a collider). */
export const JUDGING_STONE = { x: -86, z: 60, r: 2.2 } as const;

/** The Weeping Falls pool terrace, the Gorgebloom's arena: a half-moon of
 *  loam at the foot of a sixty-yard fall, the plunge pool to its east. */
export const WEEPING_FALLS_TERRACE = {
  x: 84,
  z: 42,
  r: 22,
  h: WILDHEART_HEIGHTS.fallsTerrace,
} as const;
/** The Weeping Falls themselves (render): where the water leaves the rim and
 *  where it meets the plunge pool, east of the terrace. */
export const WEEPING_FALLS = { x: 112, z: 40, topY: 62, poolY: 2.2, width: 18 } as const;
/** The Gorgebloom's root dais at the terrace's front, against the pool. */
export const GORGEBLOOM_DAIS = { x: 96, z: 44, r: 6, rise: 0.4 } as const;
/** The soft loam beds across the terrace where its seeds land (phase B: Seed
 *  Rain picks its pod spots on these). A named zone, painted as earth. */
export const GORGEBLOOM_LOAM_BEDS: readonly { x: number; z: number; r: number }[] = [
  { x: 72, z: 30, r: 5 },
  { x: 70, z: 46, r: 5 },
  { x: 78, z: 58, r: 5 },
  { x: 86, z: 28, r: 4.5 },
  { x: 82, z: 44, r: 4.5 },
  { x: 90, z: 58, r: 4.5 },
];

/** The Sunbone Causeway from the ford's north bank to the Central Island. */
export const SUNBONE_CAUSEWAY = { x: 0, fromZ: -81, toZ: -44, halfWidth: 6 } as const;

/** The Jaguar Shrine Terrace on the pyramid's top, Zulgar's arena. */
export const SHRINE_TERRACE = {
  points: [
    [-26, 196],
    [26, 196],
    [30, 214],
    [24, 236],
    [-24, 236],
    [-30, 214],
  ] as const,
  h: WILDHEART_HEIGHTS.shrineTerrace,
} as const;
/** Where Zulgar stands, and the centre of the six sun glyphs round him. */
export const ZULGAR_SPOT = { x: 0, z: 220 } as const;
/** The six sun glyphs cut into the shrine floor in a ring (phase B: G10
 *  zones that make a chasing avatar Sunstruck). Render: warm gold rings on
 *  the floor's ground rung. */
export const SUN_GLYPHS: readonly { x: number; z: number; r: number }[] = Array.from(
  { length: 6 },
  (_, i) => {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    return {
      x: Math.round(Math.sin(a) * 14 * 10) / 10,
      z: Math.round((ZULGAR_SPOT.z - 2 + Math.cos(a) * 14) * 10) / 10,
      r: 3,
    };
  },
);
/** The colossal stone jaguar head carved into the north rim behind the shrine
 *  (render hero piece, outside the walkable field). Its eyes burn during the
 *  hunt (phase B). */
export const JAGUAR_HEAD = { x: 0, z: 262, y: 30, height: 70 } as const;

/** The stone jaguar's open maw in the basin frame: the sculpt's MAW box
 *  (docs/design/dungeon-rework/kit/jaguar_head_sculpt.py, kit x half 11.6,
 *  y -31.6 to 5.6, z 16 to 29) through the head's placement (turned to the
 *  terrace, so kit -y runs toward -z). The way out opens in it: when Zulgar
 *  falls the exit portal stands on the lower jaw behind the front teeth
 *  (`portal`), reached up a walkway over the lower incisors (`floor`: the
 *  jaw's own surface measured off the shipped kit GLB, so the feet ride the
 *  carved stone). The walkway is a hidden field surface: the head draws it. */
export const JAGUAR_MAW = (() => {
  const s = JAGUAR_HEAD.height / 70;
  return {
    x: JAGUAR_HEAD.x,
    halfWidth: 11.6 * s,
    minZ: JAGUAR_HEAD.z - 31.6 * s,
    maxZ: JAGUAR_HEAD.z + 5.6 * s,
    jawY: JAGUAR_HEAD.y + 16 * s,
    roofY: JAGUAR_HEAD.y + 29 * s,
    /** The walkway's half width: inside the lower canines (|x| 5 and out). */
    walkHalfWidth: 4,
    /** [z, floor height] down the walkway's centre line: off the terrace's
     *  flat lip, over the lower incisor row (their tips knee high) and down
     *  onto the jaw, which lies a hand below the terrace, to the foot of the
     *  tongue (its 1.7 yd front lip closes the walkway). */
    floor: [
      [233, WILDHEART_HEIGHTS.shrineTerrace],
      [236, WILDHEART_HEIGHTS.shrineTerrace],
      [238.2, 45.9],
      [239, 45.9],
      [241, 45.1],
      [244.2, 45],
    ] as const,
    portal: { x: JAGUAR_HEAD.x, z: 242.5 },
  };
})();

/** The great waterfalls pouring from the caldera rim (render signature): the
 *  three on the far rim seen from the Idol Maw, and the Weeping Falls. */
export const RIM_FALLS: readonly {
  id: string;
  x: number;
  z: number;
  topY: number;
  bottomY: number;
  width: number;
  /** Yaw the curtain faces (sim convention: 0 = +z). */
  facing: number;
}[] = [
  { id: 'north_west', x: -84, z: 168, topY: 95, bottomY: -24, width: 16, facing: Math.PI * 0.85 },
  { id: 'north_east', x: 82, z: 172, topY: 92, bottomY: -24, width: 14, facing: -Math.PI * 0.85 },
  {
    id: 'weeping',
    x: WEEPING_FALLS.x,
    z: WEEPING_FALLS.z,
    topY: WEEPING_FALLS.topY,
    bottomY: WEEPING_FALLS.poolY,
    width: WEEPING_FALLS.width,
    facing: -Math.PI / 2,
  },
  { id: 'west_rim', x: -122, z: -40, topY: 88, bottomY: -24, width: 12, facing: Math.PI / 2 },
];

/** The river's course through the gorge (render): a polyline the water ribbon
 *  follows from the north-east falls past the island, under the causeway and
 *  out over the ford's west sill. x, z, water height. */
export const RIVER_COURSE: readonly (readonly [number, number, number])[] = [
  [82, 166, -22],
  [70, 130, -22.5],
  [62, 80, -23],
  [64, 0, -23],
  [56, -60, -23.4],
  [30, -78, -23.6],
  [0, -80, -23.8],
  [-40, -78, -24],
  [-70, -70, -24],
  [-112, -58, -24.2],
];

// ---- surfaces --------------------------------------------------------------------

type Extra = Partial<Pick<FieldSurface, 'edge' | 'ground' | 'hidden'>>;

function poly(
  id: string,
  points: readonly (readonly [number, number])[],
  h: number,
  extra: Extra = {},
): FieldSurface {
  return { kind: 'poly', id, points, h, ...extra };
}

function circle(id: string, x: number, z: number, r: number, h: number, extra: Extra = {}) {
  return { kind: 'circle', id, x, z, r, h, ...extra } satisfies FieldSurface;
}

function path(
  id: string,
  points: readonly (readonly [number, number, number])[],
  halfWidth: number,
  extra: Extra & { stairs?: boolean } = {},
): FieldSurface {
  return { kind: 'path', id, points, halfWidth, ...extra };
}

const H = WILDHEART_HEIGHTS;

/** Where the lower Fern Steps cross the south bank's edge (z -152) while
 *  still above it: the bank leaves this triangle to the ramp (its north edge
 *  0.3 inside the ramp's 6 yd band, out to the cross-section where it reaches
 *  the bank's level at (10, -150)). The ramp's side drops to the bank along
 *  the notch, never across the way down. */
const FERN_STEPS_NOTCH: [number, number][] = [
  [-3.26, -152],
  [6.835, -145.26],
  [11.34, -152],
];

const SURFACES: FieldSurface[] = [
  // --- The Idol Maw Landing: the carved lip inside the idol's jaw ------------------
  circle('idol_landing', IDOL_LANDING.x, IDOL_LANDING.z, IDOL_LANDING.r, IDOL_LANDING.h, {
    edge: 'rock',
    ground: 'flagstone',
  }),
  // --- The Fern Steps down the south wall (G1 on the fern landing) ----------------
  path(
    'fern_steps_upper',
    [
      [0, -215, H.landing],
      [-5, -211, H.landing],
      [-18, -205, 33],
      [-31, -199, 26],
      [-36, -194, H.fernLanding],
      [-37, -188, H.fernLanding],
    ],
    6,
    { stairs: true, edge: 'rock', ground: 'basalt' },
  ),
  poly(
    'fern_landing',
    [
      [-50, -192],
      [-22, -192],
      [-18, -164],
      [-50, -164],
    ],
    H.fernLanding,
    { edge: 'rock', ground: 'moss' },
  ),
  // One straight descent (a bend on a slope draws a seam): the south bank
  // below leaves the ramp's band out (FERN_STEPS_NOTCH), since the bank,
  // listed later, would otherwise cut the ramp off with a cliff across it
  // while it is still in the air.
  path(
    'fern_steps_lower',
    [
      [-26, -174, H.fernLanding],
      [-21, -170.7, H.fernLanding],
      [10, -150, H.bank],
      [16, -146, H.bank],
    ],
    6,
    { stairs: true, edge: 'rock', ground: 'basalt' },
  ),
  // --- The River Ford (G2 on the bank, G3 on the basalt steps, the Saurian) -------
  poly(
    'south_bank',
    [[-66, -152], ...FERN_STEPS_NOTCH, [66, -152], [66, -128], [-66, -128]],
    H.bank,
    { edge: 'rock', ground: 'moss' },
  ),
  poly(
    'river_ford',
    [
      [RIVER_FORD.x0, RIVER_FORD.z0],
      [RIVER_FORD.x1, RIVER_FORD.z0],
      [RIVER_FORD.x1, RIVER_FORD.z1],
      [RIVER_FORD.x0, RIVER_FORD.z1],
    ],
    RIVER_FORD.h,
    { edge: 'rock', ground: 'shallows' },
  ),
  ...BASALT_STEPS.map((s, i) =>
    circle(`basalt_step_${i + 1}`, s.x, s.z, s.r, s.h, { edge: 'rock', ground: 'basalt' }),
  ),
  poly(
    'north_bank',
    [
      [-60, -90],
      [60, -90],
      [56, -80],
      [-56, -80],
    ],
    H.bank,
    { edge: 'rock', ground: 'moss' },
  ),
  // --- The Twin Vine Bridges (walkable once woven, drawn by their gates) ----------
  path('vine_bridge_west', VINE_BRIDGES.west, VINE_BRIDGES.halfWidth, {
    hidden: true,
    edge: 'rock',
    ground: 'earth',
  }),
  path('vine_bridge_east', VINE_BRIDGES.east, VINE_BRIDGES.halfWidth, {
    hidden: true,
    edge: 'rock',
    ground: 'earth',
  }),
  // --- West: the Hunt Terraces (G4 lower, G5 upper, patrol B) ---------------------
  poly(
    'hunt_terrace_lower',
    [
      [-112, -78],
      [-86, -78],
      [-66, -60],
      [-66, -40],
      [-112, -40],
    ],
    H.huntLower,
    { edge: 'rock', ground: 'moss' },
  ),
  path(
    'hunt_ramp',
    [
      [-90, -46, H.huntLower],
      [-90, -40, H.huntLower],
      [-90, -28, H.huntUpper],
      [-90, -22, H.huntUpper],
    ],
    6,
    { stairs: true, edge: 'rock', ground: 'basalt' },
  ),
  poly(
    'hunt_terrace_upper',
    [
      [-112, -26],
      [-64, -26],
      [-62, 4],
      [-112, 4],
    ],
    H.huntUpper,
    { edge: 'rock', ground: 'moss' },
  ),
  path(
    'pits_stair',
    [
      [-86, 0, H.huntUpper],
      [-86, 4, H.huntUpper],
      [-86, 12, H.beastPits],
      [-86, 18, H.beastPits],
    ],
    6,
    { stairs: true, edge: 'bone', ground: 'basalt' },
  ),
  // --- The Beast Pits (the Fanglord Beastmaster and his Great Jaguar) -------------
  circle('beast_pits', BEAST_PITS.x, BEAST_PITS.z, BEAST_PITS.r, BEAST_PITS.h, {
    edge: 'bone',
    ground: 'earth',
  }),
  ...BEAST_PIT_HOLES.map((p, i) =>
    circle(`beast_pit_${i + 1}`, p.x, p.z, p.r, H.pit, { edge: 'bone', ground: 'mud' }),
  ),
  // --- East: the Waterfall Walk (G6 on the ledge, G7 behind the falls) -------------
  poly(
    'waterfall_ledge',
    [
      [112, -78],
      [88, -78],
      [70, -62],
      [70, -44],
      [112, -44],
    ],
    H.ledge,
    { edge: 'rock', ground: 'basalt' },
  ),
  path(
    'falls_path_up',
    [
      [100, -50, H.ledge],
      [100, -44, H.ledge],
      [104, -28, H.behindFalls],
      [104, -22, H.behindFalls],
    ],
    5,
    { stairs: true, edge: 'rock', ground: 'basalt' },
  ),
  poly(
    'behind_falls',
    [
      [92, -24],
      [112, -24],
      [112, 0],
      [92, 0],
    ],
    H.behindFalls,
    { edge: 'rock', ground: 'basalt' },
  ),
  path(
    'falls_path_down',
    [
      [101, -6, H.behindFalls],
      [100, -1, H.behindFalls],
      [94, 16, H.fallsTerrace],
      [92, 26, H.fallsTerrace],
    ],
    5,
    { stairs: true, edge: 'rock', ground: 'basalt' },
  ),
  // --- The Weeping Falls pool terrace (the Gorgebloom) ----------------------------
  circle(
    'weeping_falls_terrace',
    WEEPING_FALLS_TERRACE.x,
    WEEPING_FALLS_TERRACE.z,
    WEEPING_FALLS_TERRACE.r,
    WEEPING_FALLS_TERRACE.h,
    { edge: 'rock', ground: 'moss' },
  ),
  ...GORGEBLOOM_LOAM_BEDS.map((b, i) =>
    circle(`loam_bed_${i + 1}`, b.x, b.z, b.r, H.fallsTerrace, { edge: 'rock', ground: 'earth' }),
  ),
  circle(
    'gorgebloom_dais',
    GORGEBLOOM_DAIS.x,
    GORGEBLOOM_DAIS.z,
    GORGEBLOOM_DAIS.r,
    H.fallsTerrace + GORGEBLOOM_DAIS.rise,
    { edge: 'rock', ground: 'mud' },
  ),
  // --- The Sunbone Causeway to the Central Island ---------------------------------
  path(
    'sunbone_causeway',
    [
      [0, -86, H.bank],
      [0, SUNBONE_CAUSEWAY.fromZ, H.bank],
      [0, SUNBONE_CAUSEWAY.toZ, H.island],
      [0, -36, H.island],
    ],
    SUNBONE_CAUSEWAY.halfWidth,
    { edge: 'bone', ground: 'flagstone' },
  ),
  // --- The Central Island: the ruined Court colony (G8, G9, patrol C) -------------
  poly(
    'central_island',
    [
      [-46, -42],
      [46, -42],
      [52, 0],
      [48, 50],
      [36, 72],
      [-36, 72],
      [-50, 46],
      [-52, 0],
    ],
    H.island,
    { edge: 'rock', ground: 'moss' },
  ),
  poly(
    'colony_plaza',
    [
      [10, 26],
      [38, 26],
      [38, 52],
      [10, 52],
    ],
    H.island,
    { edge: 'rock', ground: 'flagstone' },
  ),
  // --- The Convergence Stair (the warded arch) and the Upper Convergence ----------
  path(
    'convergence_stair',
    [
      [0, 64, H.island],
      [0, 69, H.island],
      [0, 88, H.convergence],
      [0, 96, H.convergence],
    ],
    7,
    { stairs: true, edge: 'masonry', ground: 'flagstone' },
  ),
  poly(
    'upper_convergence',
    [
      [-52, 92],
      [52, 92],
      [48, 130],
      [-48, 130],
    ],
    H.convergence,
    { edge: 'rock', ground: 'moss' },
  ),
  // --- The Shrine Stair up the stepped pyramid (G12, G13, patrol D) ---------------
  path(
    'shrine_stair_1',
    [
      [0, 124, H.convergence],
      [0, 128, H.convergence],
      [0, 146, H.shrineLanding1],
      [0, 151, H.shrineLanding1],
    ],
    8,
    { stairs: true, edge: 'masonry', ground: 'flagstone' },
  ),
  poly(
    'shrine_landing_1',
    [
      [-24, 146],
      [24, 146],
      [24, 160],
      [-24, 160],
    ],
    H.shrineLanding1,
    { edge: 'masonry', ground: 'flagstone' },
  ),
  path(
    'shrine_stair_2',
    [
      [0, 155, H.shrineLanding1],
      [0, 160, H.shrineLanding1],
      [0, 174, H.shrineLanding2],
      [0, 179, H.shrineLanding2],
    ],
    8,
    { stairs: true, edge: 'masonry', ground: 'flagstone' },
  ),
  poly(
    'shrine_landing_2',
    [
      [-24, 174],
      [24, 174],
      [24, 186],
      [-24, 186],
    ],
    H.shrineLanding2,
    { edge: 'masonry', ground: 'flagstone' },
  ),
  path(
    'shrine_stair_3',
    [
      [0, 182, H.shrineLanding2],
      [0, 186, H.shrineLanding2],
      [0, 194, H.shrineTerrace],
      [0, 200, H.shrineTerrace],
    ],
    8,
    { stairs: true, edge: 'masonry', ground: 'flagstone' },
  ),
  // --- The Jaguar Shrine Terrace (Zulgar) ------------------------------------------
  poly('shrine_terrace', SHRINE_TERRACE.points, SHRINE_TERRACE.h, {
    edge: 'masonry',
    ground: 'ritual',
  }),
  // --- The way out: into the stone jaguar's maw (the boss exit portal) --------------
  path(
    'jaguar_maw',
    JAGUAR_MAW.floor.map(([z, h]) => [JAGUAR_MAW.x, z, h] as const),
    JAGUAR_MAW.walkHalfWidth,
    { hidden: true, edge: 'masonry', ground: 'ritual' },
  ),
];

// ---- props (kit pieces; r or hw/hd add a collider) ----------------------------------

const PI = Math.PI;

/** Big jungle trees (kapok with buttress roots): trunk colliders only. */
const TREES: readonly [number, number, number, number][] = [
  // [x, z, rot, scale]
  [-47, -188, 0.4, 1],
  [-47, -167, 1.2, 1.15],
  [-60, -142, 0.2, 1.1],
  [58, -144, -0.6, 1.05],
  [-50, -86, 0.9, 0.95],
  [50, -86, -0.3, 1],
  [-106, -72, 0.5, 1.2],
  [-108, -46, -0.7, 1.05],
  [-106, -20, 1.4, 1.15],
  [-70, -20, 0.1, 0.9],
  [-106, 0, -0.2, 1],
  [106, -74, 0.3, 1.05],
  [74, -50, -1.1, 0.95],
  [70, 30, 0.6, 1.1],
  [68, 54, -0.4, 1.0],
  [-44, -32, 0.8, 1.1],
  [44, -30, -0.5, 1.05],
  [-46, 30, 1.0, 1.2],
  [44, 10, 0.2, 1.0],
  [-30, 64, -0.9, 1.1],
  [-44, 100, 0.3, 1.15],
  [44, 102, -0.8, 1.1],
  [-42, 124, 1.1, 1.0],
  [42, 124, -0.2, 1.05],
];

/** Giant ferns, palms and undergrowth: dressing only, no collider. */
const FERNS: readonly [number, number, number][] = [
  [-12, -226, 0.3],
  [10, -229, -0.4],
  [-44, -186, 0.6],
  [-24, -168, -0.2],
  [-46, -168, 1.1],
  [-58, -148, 0.4],
  [-40, -132, -0.6],
  [30, -134, 0.9],
  [60, -134, -0.3],
  [-30, -84, 0.2],
  [30, -84, -0.9],
  [-110, -60, 0.7],
  [-68, -44, -0.4],
  [-110, -12, 1.2],
  [-66, 0, -0.8],
  [-100, 58, 0.5],
  [-72, 58, -0.5],
  [110, -50, 0.4],
  [80, -46, -1.0],
  [64, 40, 0.8],
  [76, 62, -0.3],
  [-40, -20, 0.2],
  [40, -6, -0.7],
  [-30, 40, 1.0],
  [28, 64, -0.2],
  [-46, 112, 0.6],
  [46, 112, -0.6],
  [-30, 96, 0.4],
  [30, 96, -0.4],
];

const PROPS: FieldProp[] = [
  // The Idol Maw: the stone fangs framing the way out, behind the landing.
  { kind: 'wb_idol_maw', x: 0, z: -235, rot: 0 },
  { kind: 'wb_maw_pylon', x: -9, z: -231, rot: 0, r: 2.2, h: 14 },
  { kind: 'wb_maw_pylon', x: 9, z: -231, rot: PI, r: 2.2, h: 14 },
  { kind: 'wb_brazier', x: -7, z: -213, rot: 0, r: 0.7, h: 2.4 },
  { kind: 'wb_brazier', x: 7, z: -213, rot: 0, r: 0.7, h: 2.4 },
  // The fern landing: a Sunbone totem and the strangler roots over a colony stone.
  { kind: 'wb_totem', x: -46, z: -190, rot: 0.3, r: 0.9, h: 7 },
  { kind: 'wb_strangler_roots', x: -46, z: -170, rot: 1.1, r: 2.6, h: 8 },
  // The south bank and the ford: basalt column clusters along the sill, Sunbone
  // banners and the river stepping stones (dressing in the shallows).
  { kind: 'wb_basalt_columns', x: -62, z: -146, rot: 0.2, r: 3, h: 6 },
  { kind: 'wb_basalt_columns', x: 62, z: -134, rot: -0.7, r: 2.6, h: 5 },
  { kind: 'wb_banner', x: -18, z: -134, rot: 0, r: 0.5, h: 6 },
  { kind: 'wb_banner', x: 22, z: -134, rot: 0, r: 0.5, h: 6 },
  { kind: 'wb_river_stones', x: -60, z: -98, rot: 0.4 },
  { kind: 'wb_river_stones', x: 24, z: -122, rot: -0.8 },
  { kind: 'wb_river_stones', x: 60, z: -122, rot: 1.6 },
  // The Twin Vine Bridges' anchor posts on the ford side, and the causeway's.
  { kind: 'wb_vine_anchor', x: -60, z: -102, rot: -PI / 4, r: 1, h: 5 },
  { kind: 'wb_vine_anchor', x: 60, z: -102, rot: PI / 4, r: 1, h: 5 },
  { kind: 'wb_bone_post', x: -8, z: -84, rot: 0, r: 0.8, h: 5 },
  { kind: 'wb_bone_post', x: 8, z: -84, rot: 0, r: 0.8, h: 5 },
  // The Hunt Terraces: hunting blinds, drying racks of hides, a totem.
  { kind: 'wb_hide_rack', x: -108, z: -53, rot: 0.4, hw: 2.4, hd: 0.6, h: 3 },
  { kind: 'wb_totem', x: -70, z: -56, rot: -0.3, r: 0.9, h: 7 },
  { kind: 'wb_hide_rack', x: -104, z: -4, rot: -0.6, hw: 2.4, hd: 0.6, h: 3 },
  { kind: 'wb_beast_cage', x: -68, z: -18, rot: 0.3, hw: 2, hd: 2, h: 3.5 },
  // The Beast Pits: bone fences round the rim, cages and the judging stone.
  // Each fence runs ALONG the rim (its long axis tangent, tusks turned out),
  // clear of the stair's mouth (180), the judging stone (0) and the cages.
  ...[80, 120, 150, 210, 240, 280].map((deg): FieldProp => {
    const a = (deg * PI) / 180;
    return {
      kind: 'wb_bone_fence',
      x: BEAST_PITS.x + Math.sin(a) * 21.5,
      z: BEAST_PITS.z + Math.cos(a) * 21.5,
      rot: a,
      hw: 4,
      hd: 0.4,
      h: 2.6,
    };
  }),
  { kind: 'wb_beast_cage', x: -104, z: 52, rot: 1.2, hw: 2, hd: 2, h: 3.5 },
  { kind: 'wb_beast_cage', x: -68, z: 54, rot: -1.0, hw: 2, hd: 2, h: 3.5 },
  {
    kind: 'wb_judging_stone',
    x: JUDGING_STONE.x,
    z: JUDGING_STONE.z,
    rot: PI,
    r: JUDGING_STONE.r,
    h: 3,
  },
  // The Waterfall Walk: wet basalt columns, the path behind the curtain.
  { kind: 'wb_basalt_columns', x: 109, z: -73, rot: 0.6, r: 2.6, h: 6 },
  { kind: 'wb_basalt_columns', x: 110, z: -3, rot: -0.2, r: 2, h: 8 },
  { kind: 'wb_totem', x: 94, z: -20, rot: PI, r: 0.9, h: 7 },
  // The Weeping Falls terrace: the plunge pool's rim stones and two totems
  // where the trolls bring their offerings.
  { kind: 'wb_pool_rim', x: 102, z: 32, rot: -PI / 2, r: 1.6, h: 2 },
  { kind: 'wb_pool_rim', x: 102, z: 52, rot: -PI / 2, r: 1.6, h: 2 },
  { kind: 'wb_totem', x: 66, z: 30, rot: 0.6, r: 0.9, h: 7 },
  { kind: 'wb_totem', x: 70, z: 58, rot: 1.2, r: 0.9, h: 7 },
  // The Central Island: the Court colony ruins swallowed by roots.
  { kind: 'wb_ruin_arch', x: -24, z: -20, rot: 0, hw: 5, hd: 1, h: 9 },
  { kind: 'wb_ruin_column', x: -40, z: 0, rot: 0.3, r: 1.2, h: 8 },
  { kind: 'wb_ruin_column', x: -8, z: 22, rot: 0.9, r: 1.2, h: 6 },
  { kind: 'wb_ruin_wall', x: -28, z: 28, rot: 1.3, hw: 6, hd: 0.8, h: 4 },
  { kind: 'wb_rooted_statue', x: 22, z: 65, rot: PI, r: 2.4, h: 9 },
  { kind: 'wb_strangler_roots', x: 44, z: -14, rot: -0.4, r: 2.8, h: 9 },
  { kind: 'wb_ruin_column', x: 12, z: 28, rot: 0.1, r: 1.2, h: 7 },
  { kind: 'wb_ruin_column', x: 33, z: 30, rot: 0.5, r: 1.2, h: 5 },
  { kind: 'wb_ruin_column', x: 12, z: 50, rot: 1.4, r: 1.2, h: 4 },
  // The Convergence Stair's warded arch posts (the gate draws the ward).
  { kind: 'wb_ward_post', x: -6.3, z: 75, rot: 0, r: 0.7, h: 7 },
  { kind: 'wb_ward_post', x: 6.3, z: 75, rot: 0, r: 0.7, h: 7 },
  // The Upper Convergence: braziers and banners at the foot of the pyramid.
  { kind: 'wb_brazier', x: -12, z: 122, rot: 0, r: 0.7, h: 2.4 },
  { kind: 'wb_brazier', x: 12, z: 122, rot: 0, r: 0.7, h: 2.4 },
  { kind: 'wb_banner', x: -40, z: 98, rot: 0, r: 0.5, h: 6 },
  { kind: 'wb_banner', x: 40, z: 98, rot: 0, r: 0.5, h: 6 },
  // The pyramid landings: Sunbone totems at the corners.
  { kind: 'wb_totem', x: -22, z: 148, rot: 0.2, r: 0.9, h: 7 },
  { kind: 'wb_totem', x: 22, z: 148, rot: -0.2, r: 0.9, h: 7 },
  { kind: 'wb_totem', x: -22, z: 176, rot: 0.2, r: 0.9, h: 7 },
  { kind: 'wb_totem', x: 22, z: 176, rot: -0.2, r: 0.9, h: 7 },
  // The Shrine Terrace: braziers at the stair head and the altar under the head.
  { kind: 'wb_brazier', x: -10, z: 198, rot: 0, r: 0.7, h: 2.4 },
  { kind: 'wb_brazier', x: 10, z: 198, rot: 0, r: 0.7, h: 2.4 },
  { kind: 'wb_shrine_altar', x: 0, z: 232, rot: PI, hw: 4, hd: 1.6, h: 3 },
  { kind: 'wb_brazier', x: -20, z: 230, rot: 0, r: 0.7, h: 2.4 },
  { kind: 'wb_brazier', x: 20, z: 230, rot: 0, r: 0.7, h: 2.4 },
  // The sun glyphs cut into the shrine floor (dressing: the floor rung).
  ...SUN_GLYPHS.map((g): FieldProp => ({ kind: 'wb_sun_glyph', x: g.x, z: g.z, rot: 0 })),
  // The jungle: trees (trunk colliders) and ferns (dressing).
  ...TREES.map(
    ([x, z, rot, scale]): FieldProp => ({
      kind: 'wb_jungle_tree',
      x,
      z,
      rot,
      scale,
      r: 1.6 * scale,
      h: 18 * scale,
    }),
  ),
  ...FERNS.map(
    ([x, z, rot], i): FieldProp => ({
      kind: i % 3 === 2 ? 'wb_palm' : 'wb_fern',
      x,
      z,
      rot,
      scale: 0.85 + (i % 4) * 0.1,
    }),
  ),
];

export const WILDHEART_BASIN_FIELD: AuthoredFieldDef = {
  key: 'wildheart',
  // North to the jaguar's maw (inside the 250 yd half slot the claim counts).
  bounds: { minX: -114, maxX: 114, minZ: -240, maxZ: 248 },
  voidHeight: WILDHEART_BASIN_VOID_HEIGHT,
  cliffStep: 1.1,
  mapVoid: 'jungle',
  surfaces: SURFACES,
  walls: [],
  props: PROPS,
  lightZones: [
    { id: 'maw', x: 0, z: -215, r: 40, key: 0xffe6b0, accent: 0xffb45a, fog: 0xc9c79a },
    { id: 'ford', x: 0, z: -120, r: 70, key: 0xfbe8b8, accent: 0xffc070, fog: 0xbfc79c },
    { id: 'hunt', x: -88, z: -30, r: 60, key: 0xf4e2b0, accent: 0xffa848, fog: 0xb6c094 },
    { id: 'falls', x: 90, z: 0, r: 60, key: 0xe8f0e0, accent: 0xbfe8e0, fog: 0xc2d2c4 },
    { id: 'island', x: 0, z: 16, r: 60, key: 0xf6e6b4, accent: 0xffb860, fog: 0xbcc496 },
    { id: 'convergence', x: 0, z: 110, r: 50, key: 0xf8e2ac, accent: 0xffa848, fog: 0xc4c094 },
    { id: 'shrine', x: 0, z: 200, r: 60, key: 0xffdca0, accent: 0x5fe0a0, fog: 0xc8bc8c },
  ],
};
