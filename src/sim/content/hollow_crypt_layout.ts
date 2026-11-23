// The Hollow Crypt, reworked as an OPEN-AIR necropolis (docs/design/
// dungeon-rework/hollow_crypt.md): the parish burial works of Eastbrook Vale
// broken open on a crag above a sea of grave-mist, under a vast moon. Every
// space is a terrace floating over the mist, joined by stairs, causeways and
// bridges; the void between them is the chasm, sealed by generated cliffs.
//
// Route (z forward, heights in yards):
//   Lychgate Landing (20) -> the Chapel Stair -> the Ossuary Cloister (0,
//   P1 P2 P3) -> Undercroft Grille -> the Processional (0, P8) with two wings:
//   west the Sexton's Yard (2, P4 P5) up to the Bell Yard (8, Sexton Marrow),
//   east the Widow's Gallery ravine (-6, P6) with its rim walkway (0, P7) and
//   the Great Web (-6, Rimeweb). Each arena opens a bridge back into the
//   Processional on its boss's death. The Twin Seals -> the Choir Ruin (0) and
//   its loft (5, Cantor Ilvane) -> the Stair Landing (5, P9) -> the Bone Stair
//   spiral up the crag -> the Rite Ring (24, Morthen).
//
// Pure data: the sim (height, collision, spawns, gates) and the renderer
// (terrain, dressing, light) both read this one record.

import type { AuthoredFieldDef, FieldProp, FieldSurface } from '../instances/authored_field/types';

/** Height of the mist chasm floor under every terrace. */
export const HOLLOW_CRYPT_VOID_HEIGHT = -40;

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
export const HOLLOW_CRYPT_ANCHORS = {
  entry: { x: 0, z: -130 },
  exit: { x: 0, z: -140 },
  landing: { x: 0, z: -128 },
  cloister: { x: 0, z: -30 },
  monument: { x: 0, z: -30 },
  processional: { x: 0, z: 60 },
  yard: { x: -82, z: 46 },
  bellYard: { x: -82, z: 116 },
  bellTower: { x: -108, z: 128 },
  gallery: { x: 76, z: 40 },
  rimWalk: { x: 105, z: 64 },
  greatWeb: { x: 80, z: 112 },
  choir: { x: 0, z: 130 },
  loft: { x: 0, z: 162 },
  stairLanding: { x: 43, z: 161 },
  boneStair: { x: 64, z: 200 },
  riteRing: { x: 0, z: 205 },
} as const;

/** The Rite Ring: centre, radius and floor height (the crag top). One level
 *  floor from rim to altar: the engraved rite circle (render/hollow_crypt/
 *  crypt_floor_marks.ts) reads whole across it, with no raised dais paved over
 *  its inner bands (playtest: it hid them). */
export const HOLLOW_CRYPT_RING = { x: 0, z: 205, r: 28, h: 24 } as const;
/** The collapsed bell tower's yaw: its broken beam (the piece's local +X) reaches
 *  toward the Bell Yard's centre with the Burial Bell at its end (Sexton
 *  Marrow's bell rope, encounters/hollow_crypt/marrow_ids.ts). */
export const HOLLOW_CRYPT_BELL_TOWER_ROT = 0.43;
/** The three grave lanterns round the frost ravine floor (the Lady of the
 *  Bonechill's shelter from her Lament, encounters/hollow_crypt/lady_ids.ts):
 *  14 yd out from the floor's centre, clear of the south entrance and the
 *  west postern. */
export const BONECHILL_LANTERN_SPOTS: readonly { x: number; z: number }[] = [20, 140, 260].map(
  (deg) => {
    const a = (deg * Math.PI) / 180;
    return {
      x: Math.round((HOLLOW_CRYPT_ANCHORS.greatWeb.x + Math.sin(a) * 14) * 10) / 10,
      z: Math.round((HOLLOW_CRYPT_ANCHORS.greatWeb.z + Math.cos(a) * 14) * 10) / 10,
    };
  },
);

const SURFACES: FieldSurface[] = [
  // --- Lychgate Landing and the Chapel Stair -------------------------------
  {
    kind: 'circle',
    id: 'landing',
    x: 0,
    z: -128,
    r: 17,
    h: 20,
    edge: 'balustrade',
    ground: 'flagstone',
  },
  {
    kind: 'path',
    id: 'chapel_stair',
    points: [
      [0, -116, 20],
      [0, -110, 20],
      [0, -82, 0],
      [0, -74, 0],
    ],
    halfWidth: 8,
    stairs: true,
    edge: 'balustrade',
  },
  // --- The Ossuary Cloister (P1, P2 patrol, P3) ------------------------------
  // Its north lip runs a little past the Undercroft Grille's curtain wall so
  // the wall's footing stands on stone, not over the drop.
  rect('cloister', -46, -80, 46, 22.7, 0, { edge: 'masonry', ground: 'flagstone' }),
  // --- The Processional (fork and rejoin, P8) --------------------------------
  rect('processional', -26, 20, 26, 112, 0, { edge: 'masonry', ground: 'flagstone' }),
  // --- West wing: the Sexton's Yard -------------------------------------------
  {
    kind: 'path',
    id: 'west_causeway',
    points: [
      [-20, 42, 0],
      [-30, 42, 0],
      [-50, 42, 2],
      [-58, 42, 2],
    ],
    halfWidth: 6,
    edge: 'balustrade',
  },
  {
    kind: 'poly',
    id: 'sextons_yard',
    points: [
      [-54, 14],
      [-54, 80],
      [-70, 88],
      [-104, 86],
      [-112, 64],
      [-110, 24],
      [-96, 8],
      [-70, 6],
    ],
    h: 2,
    edge: 'rock',
    ground: 'grave',
  },
  {
    kind: 'path',
    id: 'yard_ramp',
    points: [
      [-82, 74, 2],
      [-82, 80, 2],
      [-82, 92, 8],
      [-82, 98, 8],
    ],
    halfWidth: 6,
    stairs: true,
    edge: 'rock',
  },
  { kind: 'circle', id: 'bell_yard', x: -82, z: 116, r: 22, h: 8, edge: 'rock', ground: 'grave' },
  // --- East wing: the Widow's Gallery --------------------------------------
  {
    kind: 'path',
    id: 'east_causeway',
    points: [
      [20, 42, 0],
      [30, 42, 0],
      [50, 42, -6],
      [58, 42, -6],
    ],
    halfWidth: 6,
    stairs: true,
    edge: 'balustrade',
  },
  {
    kind: 'poly',
    id: 'widows_gallery',
    points: [
      [54, 10],
      [54, 80],
      [70, 84],
      [90, 84],
      [96, 78],
      [96, 10],
      [80, 4],
      [62, 4],
    ],
    h: -6,
    edge: 'rock',
    ground: 'frost',
  },
  rect('rim_walk', 98, 24, 112, 104, 0, { edge: 'balustrade', ground: 'flagstone' }),
  {
    kind: 'path',
    id: 'rim_ramp',
    points: [
      [86, 16, -6],
      [92, 16, -6],
      [105, 28, 0],
      [105, 34, 0],
    ],
    halfWidth: 4.5,
    stairs: true,
    edge: 'rock',
  },
  {
    kind: 'path',
    id: 'web_neck',
    points: [
      [80, 78, -6],
      [80, 98, -6],
    ],
    halfWidth: 6,
    edge: 'rock',
    ground: 'frost',
  },
  { kind: 'circle', id: 'great_web', x: 80, z: 112, r: 20, h: -6, edge: 'rock', ground: 'frost' },
  {
    kind: 'path',
    id: 'east_postern',
    points: [
      [66, 104, -6],
      [60, 102, -6],
      [36, 100, 0],
      [20, 100, 0],
    ],
    halfWidth: 5,
    edge: 'bone',
    ground: 'bone',
  },
  // --- The Choir Ruin and its loft (Cantor Ilvane) --------------------------
  // The choir floor reaches under the Twin Seals' wall (its footing), and the
  // loft runs back far enough to carry the great tracery window on its lip.
  rect('choir', -30, 110.5, 30, 150, 0, { edge: 'masonry', ground: 'flagstone' }),
  rect('choir_loft', -30, 150, 30, 175.5, 5, { edge: 'balustrade', ground: 'bone' }),
  ...[-24, 24].map(
    (x): FieldSurface => ({
      kind: 'path',
      id: x < 0 ? 'loft_ramp_west' : 'loft_ramp_east',
      points: [
        [x, 132, 0],
        [x, 136, 0],
        [x, 150, 5],
        [x, 155, 5],
      ],
      halfWidth: 4,
      stairs: true,
      edge: 'balustrade',
    }),
  ),
  // --- The Stair Landing (P9) and the Bone Stair up the crag ----------------
  rect('stair_landing', 30, 154, 56, 168, 5, { edge: 'bone', ground: 'bone' }),
  {
    kind: 'path',
    id: 'bone_stair',
    points: [
      [52, 161, 5],
      [60, 161, 5],
      [64, 176, 8],
      [66, 208, 13],
      [62, 236, 18],
      [40, 240, 21],
      [14, 240, 23],
      [6, 234, 24],
      [2, 226, 24],
    ],
    halfWidth: 4.5,
    stairs: true,
    edge: 'bone',
    ground: 'bone',
  },
  // --- The Rite Ring on the crag top (Morthen) ------------------------------
  {
    kind: 'circle',
    id: 'rite_ring',
    x: HOLLOW_CRYPT_RING.x,
    z: HOLLOW_CRYPT_RING.z,
    r: HOLLOW_CRYPT_RING.r,
    h: HOLLOW_CRYPT_RING.h,
    edge: 'rock',
    ground: 'ritual',
  },
];

function columns(
  kind: string,
  pts: readonly (readonly [number, number])[],
  r: number,
  h: number,
): FieldProp[] {
  return pts.map(([x, z], i) => ({ kind, x, z, rot: (i * 1.7) % (Math.PI * 2), r, h }));
}

// The cloister arcade: columns one arcade bay (10 yd) apart down both sides
// and along the south walk, where the Chapel Stair lands between the two
// central columns. Some are broken; the renderer derives every arch from these
// columns (an arch only ever springs from a standing capital).
const CLOISTER_COLUMNS: (readonly [number, number])[] = [];
for (let z = -70; z <= 10; z += 10) {
  CLOISTER_COLUMNS.push([-38, z], [38, z]);
}
for (const x of [-28, -18, -8, 8, 18, 28]) CLOISTER_COLUMNS.push([x, -70]);

const PROPS: FieldProp[] = [
  // Landing: the lychgate the party steps through, and two mourning statues.
  { kind: 'hc_lychgate', x: 0, z: -140, rot: 0 },
  { kind: 'hc_mourner_statue', x: -12, z: -122, rot: 0.5, r: 1.4, h: 7 },
  { kind: 'hc_mourner_statue', x: 12, z: -122, rot: -0.5, r: 1.4, h: 7 },
  // Cloister: arcade columns and the ossuary monument the patrol circles.
  ...columns('hc_cloister_column', CLOISTER_COLUMNS, 1.1, 9),
  { kind: 'hc_ossuary_monument', x: 0, z: -30, rot: 0, r: 5, h: 10 },
  { kind: 'hc_sarcophagus', x: -24, z: -56, rot: 0, hw: 1.2, hd: 2.6, h: 1.6 },
  { kind: 'hc_sarcophagus', x: 24, z: -56, rot: 0, hw: 1.2, hd: 2.6, h: 1.6 },
  { kind: 'hc_sarcophagus', x: -24, z: -4, rot: 0, hw: 1.2, hd: 2.6, h: 1.6 },
  { kind: 'hc_sarcophagus', x: 24, z: -4, rot: 0, hw: 1.2, hd: 2.6, h: 1.6 },
  // Processional: candle-lit shrines along the flanks, the wing arches.
  // Their candle niches face the aisle.
  ...[30, 62, 84].flatMap((z) =>
    [-22, 22].map(
      (x): FieldProp => ({
        kind: 'hc_processional_pillar',
        x,
        z,
        rot: x < 0 ? Math.PI / 2 : -Math.PI / 2,
        r: 1.3,
        h: 12,
      }),
    ),
  ),
  // The wing gateways stand just inside the Processional's lip, their two
  // piers solid (collider-only props under the kit's piers).
  { kind: 'hc_wing_arch', x: -24.6, z: 42, rot: Math.PI / 2 },
  { kind: 'hc_wing_arch', x: 24.6, z: 42, rot: -Math.PI / 2 },
  ...[-24.6, 24.6].flatMap((x) =>
    [34.8, 49.2].map(
      (z): FieldProp => ({ kind: 'hc_pier', x, z, rot: 0, hw: 1.2, hd: 1.2, h: 12 }),
    ),
  ),
  // Sexton's Yard: crooked headstones (walled off the pull lanes), lanterns,
  // dead trees, and the colossal collapsed bell tower beside the Bell Yard.
  ...[
    [-64, 20],
    [-68, 30],
    [-100, 36],
    [-104, 50],
    [-96, 22],
    [-62, 64],
    [-70, 76],
    [-100, 72],
    [-106, 60],
    [-64, 52],
  ].map(
    ([x, z], i): FieldProp => ({
      kind: 'hc_headstone',
      x,
      z,
      rot: (i * 0.9) % Math.PI,
      r: 0.8,
      h: 2,
    }),
  ),
  { kind: 'hc_lantern_post', x: -58, z: 34, rot: 0, r: 0.4, h: 4 },
  { kind: 'hc_lantern_post', x: -72, z: 70, rot: 0, r: 0.4, h: 4 },
  { kind: 'hc_lantern_post', x: -92, z: 20, rot: 0, r: 0.4, h: 4 },
  { kind: 'hc_dead_tree', x: -106, z: 44, rot: 0.4, r: 1, h: 10 },
  { kind: 'hc_dead_tree', x: -62, z: 17, rot: 2.1, r: 1, h: 10 },
  // The bell beam (the piece's local +X) reaches toward the Bell Yard's centre.
  { kind: 'hc_bell_tower', x: -108, z: 128, rot: HOLLOW_CRYPT_BELL_TOWER_ROT },
  { kind: 'hc_headstone', x: -96, z: 104, rot: 0.3, r: 0.8, h: 2 },
  { kind: 'hc_headstone', x: -70, z: 124, rot: 1.2, r: 0.8, h: 2 },
  { kind: 'hc_lantern_post', x: -70, z: 100, rot: 0, r: 0.4, h: 4 },
  { kind: 'hc_lantern_post', x: -94, z: 100, rot: 0, r: 0.4, h: 4 },
  // Widow's Gallery: frosted broken columns, egg clusters, the Great Web.
  ...columns(
    'hc_web_column',
    [
      [60, 24],
      [90, 30],
      [60, 66],
      [90, 70],
    ],
    1.4,
    12,
  ),
  { kind: 'hc_egg_cluster', x: 58, z: 40, rot: 0.5 },
  { kind: 'hc_egg_cluster', x: 92, z: 54, rot: 2.2 },
  // The frost ravine floor is the Lady of the Bonechill's (the Great Web that
  // hung over it went with the spider placeholder): three grave lanterns round
  // the floor, her only shelter from the Bride's Lament, and the frozen bridal
  // grave on the north lip where she rose. Both are drawn by the Lady's render
  // module (src/render/hollow_crypt/lady_fx.ts); here they are solid.
  ...BONECHILL_LANTERN_SPOTS.map(
    (l): FieldProp => ({ kind: 'hc_grave_lantern', x: l.x, z: l.z, rot: 0, r: 0.5, h: 4 }),
  ),
  {
    kind: 'hc_bridal_grave',
    x: HOLLOW_CRYPT_ANCHORS.greatWeb.x,
    z: HOLLOW_CRYPT_ANCHORS.greatWeb.z + 15.5,
    rot: Math.PI,
    hw: 1.5,
    hd: 2.7,
    h: 1.6,
  },
  // Choir Ruin: the six loft pillars (line-of-sight cover), the Bone Organ.
  ...columns(
    'hc_choir_pillar',
    [
      [-8, 158],
      [8, 158],
      [-18, 160],
      [18, 160],
      [-8, 166],
      [8, 166],
    ],
    1.4,
    14,
  ),
  { kind: 'hc_bone_organ', x: 0, z: 170, rot: Math.PI, hw: 9, hd: 1.4, h: 12 },
  // The great broken tracery window on the loft's back lip, framing the crag.
  { kind: 'hc_tracery_window', x: 0, z: 173.5, rot: Math.PI, hw: 9.8, hd: 1.1, h: 20 },
  // The choir's broken pews: two blocks off the centre aisle (P8 and the
  // loft ramps keep their lanes).
  ...[-16, -9.5, 9.5, 16].flatMap((x) =>
    [120, 126, 132, 138].map(
      (z, i): FieldProp => ({
        kind: 'hc_pew',
        x,
        z,
        rot: ((i + (x > 0 ? 1 : 0)) % 3) * 0.06 - 0.06,
        hw: 1.5,
        hd: 0.45,
        h: 1.2,
      }),
    ),
  ),
  ...columns(
    'hc_nave_column',
    [
      [-26, 118],
      [26, 118],
      [-26, 134],
      [26, 134],
    ],
    1.3,
    14,
  ),
  // The Rite Ring: four Remembrance Candles and the altar.
  ...columns(
    'hc_remembrance_candle',
    [
      [0, 225],
      [20, 205],
      [0, 185],
      [-20, 205],
    ],
    1.3,
    4,
  ),
  { kind: 'hc_rite_altar', x: 0, z: 207, rot: 0, r: 2.6, h: 2 },
  // Standing stones inside the ring's rim, between the candles and the
  // alcoves, clear of the Bone Stair's mouth (north-north-east).
  ...[75, 105, 165, 195, 255, 285, 345].map((deg): FieldProp => {
    const a = (deg * Math.PI) / 180;
    return {
      kind: 'hc_ring_stone',
      x: Math.sin(a) * 26.4,
      z: HOLLOW_CRYPT_RING.z + Math.cos(a) * 26.4,
      rot: a,
      r: 1,
      h: 5,
    };
  }),
  ...[0, 1, 2, 3].map(
    (i): FieldProp => ({
      kind: 'hc_sarcophagus_alcove',
      x: Math.sin(Math.PI / 4 + (i * Math.PI) / 2) * 25,
      z: 205 + Math.cos(Math.PI / 4 + (i * Math.PI) / 2) * 25,
      rot: Math.PI / 4 + (i * Math.PI) / 2 + Math.PI,
      hw: 2.4,
      hd: 1.4,
      h: 4,
    }),
  ),
];

export const HOLLOW_CRYPT_FIELD: AuthoredFieldDef = {
  key: 'hollow_crypt',
  bounds: { minX: -114, maxX: 114, minZ: -146, maxZ: 246 },
  voidHeight: HOLLOW_CRYPT_VOID_HEIGHT,
  cliffStep: 1.1,
  surfaces: SURFACES,
  walls: [
    // The Undercroft Grille's curtain wall across the cloister's north side.
    { id: 'grille_west', x: -26.5, z: 21, hw: 19.5, hd: 1.2, rot: 0, height: 10 },
    { id: 'grille_east', x: 26.5, z: 21, hw: 19.5, hd: 1.2, rot: 0, height: 10 },
    // The Twin Seals' warded wall between the Processional and the Choir.
    { id: 'seals_west', x: -18.4, z: 113, hw: 11.3, hd: 1.2, rot: 0, height: 12 },
    { id: 'seals_east', x: 18.4, z: 113, hw: 11.3, hd: 1.2, rot: 0, height: 12 },
  ],
  props: PROPS,
  lightZones: [
    { id: 'landing', x: 0, z: -110, r: 50, key: 0x9fb4d8, accent: 0xe8a64a, fog: 0x2a3148 },
    { id: 'cloister', x: 0, z: -30, r: 60, key: 0x93a7cc, accent: 0xe8a64a, fog: 0x262c40 },
    { id: 'processional', x: 0, z: 70, r: 50, key: 0x8e9dc4, accent: 0xe8a64a, fog: 0x252a3d },
    { id: 'yard', x: -82, z: 70, r: 60, key: 0x9aa3b8, accent: 0xf0a040, fog: 0x2b2a33 },
    { id: 'gallery', x: 80, z: 70, r: 60, key: 0xb9d6f0, accent: 0xcfe3f0, fog: 0x283a4c },
    { id: 'choir', x: 0, z: 150, r: 40, key: 0xa491c8, accent: 0x9d6cd0, fog: 0x2a2440 },
    { id: 'rite', x: 0, z: 205, r: 50, key: 0x9ad8c0, accent: 0x6fd6a8, fog: 0x1d3330 },
  ],
};

// ---- the cloister arcade ---------------------------------------------------------

function hash(a: number, b: number): number {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** A cloister column the ruin has broken (a deterministic pick by position). */
export function isBrokenCloisterColumn(p: { x: number; z: number }): boolean {
  return hash(p.x, p.z) < 0.3;
}

/** One arcade bay spans this far between its two column centres. */
export const ARCADE_BAY = 10;
/** Height of the flat cap on a whole arcade arch (the Kit_ArcadeArch top). */
export const ARCADE_TOP_Y = 15.2;

export type ArcadeBayVariant = 'whole' | 'broken' | 'springer' | 'fallen';

export interface ArcadeBay {
  x: number;
  z: number;
  /** Yaw so the arch's local +X runs from column `a` to column `b`. */
  rot: number;
  variant: ArcadeBayVariant;
  /** The standing column a springer rises from (springer bays only). */
  standing?: { x: number; z: number };
}

/**
 * The cloister arcade, derived from its columns: one bay over every pair of
 * columns exactly one bay apart. Both columns standing: a whole arch (or a
 * broken one that keeps both springers). One fallen: only the springer on the
 * standing capital. Both fallen: stones in the grass. Shared by the renderer
 * (which arch piece each bay draws) and the sim (a gargoyle perches only on a
 * whole arch's cap).
 */
export function hollowCryptArcadeBays(): ArcadeBay[] {
  const cols = PROPS.filter((p) => p.kind === 'hc_cloister_column');
  const out: ArcadeBay[] = [];
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      const a = cols[i];
      const b = cols[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const aligned = Math.abs(dx) < 1e-6 || Math.abs(dz) < 1e-6;
      if (!aligned || Math.abs(Math.hypot(dx, dz) - ARCADE_BAY) > 1e-6) continue;
      const x = (a.x + b.x) / 2;
      const z = (a.z + b.z) / 2;
      const rot = Math.atan2(-dz, dx);
      const aDown = isBrokenCloisterColumn(a);
      const bDown = isBrokenCloisterColumn(b);
      if (!aDown && !bDown) {
        out.push({ x, z, rot, variant: hash(x * 0.37, z * 0.91) < 0.35 ? 'broken' : 'whole' });
      } else if (aDown && bDown) {
        out.push({ x, z, rot, variant: 'fallen' });
      } else {
        const s = aDown ? b : a;
        out.push({ x, z, rot, variant: 'springer', standing: { x: s.x, z: s.z } });
      }
    }
  }
  return out;
}
