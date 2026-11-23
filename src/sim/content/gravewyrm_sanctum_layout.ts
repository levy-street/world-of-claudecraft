// Gravewyrm Sanctum (docs/design/dungeon-rework/gravewyrm_sanctum.md): the Ice
// Tomb of the Wyrm. A hidden glacier cirque inside the ring of Thornpeak's
// summits, filled by the Quench (the glacier the Smith made when he plunged his
// eldest dragon into the flood of the Night of Glass), with Korzul visible in
// the Calving Face from the first step. Open air under a clear polar dusk and a
// shard-light aurora; the void between the terraces is crevasse depth. The
// whole route DESCENDS, from the high pass to the frozen lake, circling the
// bowl so the face stays in view. Rebuilt on the shared authored-field engine
// (G9); the old three-chamber `sanctum` interior is no longer this dungeon's.
//
// Route (z forward, heights in yards):
//   the Gate Landing (55; the gate tunnel's mouth, the first vista) -> the
//   Landing Stair -> the Keystone Court (50; G1 round the keystone socket) ->
//   the Sledge Road down the moraine (50 to 38; G2 on the upper bend, G3 on the
//   lower bend, patrol A: the Sledge Tusker hauling its braziers up and down)
//   -> the Rime Gate (an ice wall that shatters once G1, G2, G3 and the Tusker
//   are dead) -> the Fork (38) -> BOTH wings in either order:
//     west, the Serac Field (36 then 34; the ice bridge over the crevasse, G4
//     at its far end, G5 at the top of the West Chain Stair, patrol B);
//     east, the Anchor Ledge (38 then 32; the rune wall and the chain anchors,
//     G6 under the wall, G7 at the top of the East Chain Stair);
//   -> the two Chain Stairs (their grates rise once BOTH wings are clear: the
//   terrace is entered only with both stairs open) -> the Lock Terrace (30;
//   Korgath the Bound chained to four seal pillars) -> the Chain Bridge (the
//   Smith's slack chain falls across the gulf once Korgath is dead) -> the Thaw
//   Works (24 then 16; G8 in the sledge park, G9 by the melt channel, G10
//   before the vault, patrol C on the works road) -> the Vault Ward -> the
//   Ritual Vault (10; Grand Necromancer Velkhar and three thaw pyres in their
//   meltwater pools) -> the Tithe Gate (an ice wall, Velkhar dead) -> the Shore
//   of the Held (4; G11 west, G12 east, patrol D) -> the Hollow Ward -> the
//   Wyrm's Hollow (0; the frozen lake of nineteen plates, Korzul the
//   Gravewyrm). The Calving Face stands past the lake's north shore (render).
//
// Engine limit: ONE floor height per point, so every bridge spans open air
// beside the ground it looks onto, never over a floor. The whole walkable
// field stays inside the instance slot's footprint (|x| < 115, |z| < 245): the
// claim, the trash kit and the gates count a player as "inside" only within
// |x| < 120 and |z| < 250 of the origin.
//
// Pure data: the sim (height, collision, spawns, gates, encounters) and the
// renderer (terrain, set dressing, the face, light) all read this one record.

import type { AuthoredFieldDef, FieldProp, FieldSurface } from '../instances/authored_field/types';

/** Crevasse depth under the terraces (the void between the walkways). */
export const GRAVEWYRM_SANCTUM_VOID_HEIGHT = -60;

/** The floor heights of the route, from the pass down to the lake. */
export const GRAVEWYRM_HEIGHTS = {
  landing: 55,
  court: 47.5,
  upperBend: 46,
  lowerBend: 42,
  fork: 38,
  seracUpper: 36,
  seracLower: 34,
  anchorUpper: 38,
  anchorLower: 32,
  terrace: 30,
  worksUpper: 24,
  worksLower: 16,
  vault: 10,
  shore: 4,
  lake: 0,
} as const;

const H = GRAVEWYRM_HEIGHTS;

/** Named anchors: spawns, dev teleports and the renderer's set pieces. */
export const GRAVEWYRM_SANCTUM_ANCHORS = {
  entry: { x: 0, z: -222 },
  exit: { x: 0, z: -230 },
  landing: { x: 0, z: -224 },
  court: { x: 0, z: -184 },
  upperBend: { x: -36, z: -144 },
  lowerBend: { x: 26, z: -110 },
  fork: { x: 0, z: -74 },
  seracUpper: { x: -82, z: -94 },
  seracLower: { x: -82, z: -40 },
  anchorUpper: { x: 84, z: -94 },
  anchorLower: { x: 84, z: -40 },
  terrace: { x: 0, z: -22 },
  chainBridge: { x: 0, z: 14 },
  worksUpper: { x: 0, z: 42 },
  worksLower: { x: 0, z: 72 },
  vault: { x: 0, z: 107 },
  shore: { x: 0, z: 140 },
  lake: { x: 0, z: 192 },
} as const;

/** The Gate Landing: where the group walks out of the gate tunnel and sees
 *  the whole cirque (the first vista). */
export const GATE_LANDING = { x: 0, z: -224, r: 12, h: H.landing } as const;
/** The rock-cut gate tunnel's mouth behind the landing (render; the landing's
 *  south rim cliff already closes it). Its front faces north, onto the bowl. */
export const GATE_TUNNEL = { x: 0, z: -237, rot: 0 } as const;
/** The Keystone Court: the inner side of the gate, the empty keystone socket. */
export const KEYSTONE_COURT = { x0: -26, z0: -200, x1: 26, z1: -168, h: H.court } as const;
/** The keystone socket on its plinth in the court (a hero prop). */
export const KEYSTONE_SOCKET = { x: 14, z: -194, r: 2 } as const;
/** The two bends of the Sledge Road (round moraine pads the road turns on). */
export const ROAD_BENDS = {
  upper: { x: -36, z: -144, r: 12, h: H.upperBend },
  lower: { x: 26, z: -110, r: 12, h: H.lowerBend },
} as const;
/** The Fork: the moraine flat at the foot of the road where the wings part. */
export const FORK = { x0: -30, z0: -86, x1: 30, z1: -62, h: H.fork } as const;
/** The Serac Field (west wing): ice towers on two shelves, the crevasse
 *  between them crossed by a natural ice bridge. */
export const SERAC_FIELD = {
  upper: { x0: -106, z0: -112, x1: -58, z1: -76, h: H.seracUpper },
  lower: { x0: -108, z0: -62, x1: -56, z1: -16, h: H.seracLower },
} as const;
/** The natural ice bridge over the Serac Field's crevasse (G4 holds its far end). */
export const ICE_BRIDGE = { x: -82, fromZ: -80, toZ: -60, halfWidth: 4.5 } as const;
/** The Anchor Ledge (east wing): the rune wall and the Smith's chain anchors on
 *  the upper ledge, the gang frozen in the ice beside the path. */
export const ANCHOR_LEDGE = {
  upper: { x0: 58, z0: -112, x1: 108, z1: -76, h: H.anchorUpper },
  lower: { x0: 56, z0: -62, x1: 110, z1: -16, h: H.anchorLower },
} as const;
/** The rune wall on the Anchor Ledge's east edge: the Smith's three acts
 *  (heat, the hammer, the quench) cut as his runes, no letters; a body that
 *  walks up to it reads the lore line (encounters/gravewyrm_sanctum/rune_wall.ts). */
export const RUNE_WALL = { x: 106.5, z: -94, hw: 1.5, hd: 15 } as const;

/** The Lock Terrace, Korgath's arena: a flat rock spur over the gulf. */
export const LOCK_TERRACE = { x: 0, z: -22, r: 22, h: H.terrace } as const;
/** Where Korgath stands chained (the middle of the terrace). */
export const KORGATH_SPOT = { x: 0, z: -22 } as const;
/** The four seal pillars in a square 18 yd from the terrace's centre, each cut
 *  with one smith's tool. Each Seal Shackle (phase B, G23) is pinned at its
 *  pillar's foot on the side facing Korgath. */
export const SEAL_PILLARS: readonly {
  id: 'hammer' | 'tongs' | 'anvil' | 'bellows';
  x: number;
  z: number;
  r: number;
  shackle: { x: number; z: number };
}[] = (['hammer', 'tongs', 'anvil', 'bellows'] as const).map((id, i) => {
  // North-west, north-east, south-east, south-west, on the diagonals.
  const d = 18;
  const ux = i === 0 || i === 3 ? -Math.SQRT1_2 : Math.SQRT1_2;
  const uz = i === 0 || i === 1 ? Math.SQRT1_2 : -Math.SQRT1_2;
  const x = LOCK_TERRACE.x + ux * d;
  const z = LOCK_TERRACE.z + uz * d;
  return { id, x, z, r: 2.2, shackle: { x: x - ux * 3.2, z: z - uz * 3.2 } };
});
/** The Smith's own hammer, set down on the terrace's south rim (a hero prop). */
export const SMITHS_HAMMER = { x: 0, z: -38.5, rot: 0.35, hw: 4.8, hd: 1.7 } as const;

/** The Chain Bridge: the Smith's slack chain that falls across the gulf from
 *  the Lock Terrace to the Thaw Works once Korgath is dead (walkable only then,
 *  drawn by its gate). */
export const CHAIN_BRIDGE = {
  x: 0,
  fromZ: -1,
  toZ: 26,
  fromH: H.terrace,
  toH: H.worksUpper,
  halfWidth: 4.5,
} as const;

/** The Thaw Works: the cult's camp on the glacier, two terraces down. */
export const THAW_WORKS = {
  upper: { x0: -50, z0: 28, x1: 50, z1: 56, h: H.worksUpper },
  lower: { x0: -44, z0: 62, x1: 44, z1: 82, h: H.worksLower },
} as const;
/** The melt channel cut through the works' upper terrace (render; G9's spot). */
export const MELT_CHANNEL: readonly (readonly [number, number])[] = [
  [14, 30],
  [22, 40],
  [30, 46],
  [46, 54],
];

/** The meltwater pools that put out a Goadsmith's Branding Iron (the trash
 *  engine's quench zones, DungeonDef.quenchZones, mob/trash_kit/brand.ts):
 *  shallow cold pools thawed out of the snow beside every pull a Goadsmith
 *  stands in or walks through, each 8 to 14 yd from the pack so a branded
 *  player runs a few strides to douse it. Two on the Sledge Road's upper bend
 *  (G2), two under the rune wall (G6), three in the Thaw Works' sledge park
 *  and on its road (G8, patrol C), and two in the melt channel itself (G9).
 *  Flat floor, clear of every prop footprint (tests/
 *  gravewyrm_sanctum_trash_mechanics.test.ts). The renderer paints the same
 *  circles. */
export const QUENCH_POOLS: readonly { x: number; z: number; r: number }[] = [
  { x: -37, z: -136, r: 2.6 },
  { x: -33, z: -153, r: 2.6 },
  { x: 84, z: -100, r: 2.6 },
  { x: 86, z: -84, r: 2.6 },
  { x: -18, z: 36, r: 2.6 },
  { x: -14, z: 52, r: 2.6 },
  { x: -10, z: 44, r: 2.6 },
  { x: 22, z: 40, r: 2.6 },
  { x: 30, z: 46, r: 2.6 },
];

/** The Ritual Vault, Velkhar's arena: a bowl melted out of the glacier's flank,
 *  open to the sky. The cold lake-ice floor is the SAFE floor. */
export const RITUAL_VAULT = { x: 0, z: 107, r: 19, h: H.vault } as const;
/** Velkhar's spot in the middle of the vault. */
export const VELKHAR_SPOT = { x: 0, z: 107 } as const;
/** The three thaw pyres in a triangle, each in its round pool of meltwater
 *  (7 yd): phase B's G10 zones and G24 death-site rule read these. */
export const THAW_POOLS: readonly { id: string; x: number; z: number; r: number }[] = [0, 1, 2].map(
  (i) => {
    const a = (i * 2 * Math.PI) / 3;
    return {
      id: `pool_${i}`,
      x: RITUAL_VAULT.x + Math.sin(a) * 10.5,
      z: RITUAL_VAULT.z + Math.cos(a) * 10.5,
      r: 7,
    };
  },
);

/** The frozen lake (the Wyrm's Hollow) and the rock shelf round it. */
export const WYRMS_HOLLOW = { x: 0, z: 192, lakeR: 40, shelfR: 46, h: H.lake } as const;
/** The Shore of the Held: a crescent round the lake's south half. */
export const SHORE = {
  x: WYRMS_HOLLOW.x,
  z: WYRMS_HOLLOW.z,
  innerR: 44,
  outerR: 62,
  halfArc: (62 * Math.PI) / 180,
  h: H.shore,
} as const;
/** Where Korzul lies on the lake's north side, under the Calving Face. */
export const KORZUL_SPOT = { x: 0, z: 214 } as const;

/** The nineteen lake plates (one in the middle, a ring of six, a ring of
 *  twelve, each about 16 yd across): phase B's G25 plate floor. A point of the
 *  lake belongs to the nearest plate centre. One floor height throughout; the
 *  sinking is render only. */
export const LAKE_PLATES: readonly { id: string; x: number; z: number; r: number }[] = (() => {
  const out: { id: string; x: number; z: number; r: number }[] = [];
  const { x, z } = WYRMS_HOLLOW;
  out.push({ id: 'plate_0', x, z, r: 8 });
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    out.push({ id: `plate_${1 + i}`, x: x + Math.sin(a) * 16, z: z + Math.cos(a) * 16, r: 8 });
  }
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6 + Math.PI / 12;
    out.push({ id: `plate_${7 + i}`, x: x + Math.sin(a) * 31, z: z + Math.cos(a) * 31, r: 8.5 });
  }
  return out;
})();

/** The Calving Face: the front wall of the Quench past the lake's north shore,
 *  Korzul coiled inside it (render only; no collider: the lake's own cliff
 *  closes the field). `y` is the wyrm's heart above the lake. */
export const CALVING_FACE = {
  x: 0,
  z: 250,
  width: 170,
  height: 100,
  wyrm: { x: 0, z: 256, y: 34 },
};

/** The run's story markers: one inert encounter object per spot, each carrying
 *  the Calving Face's crack step in its template id (encounters/gravewyrm_sanctum
 *  story.ts). Spread so every walkable point stands within the client's
 *  interest radius of at least one, so the face reads right from anywhere. */
export const STORY_MARKERS: readonly { x: number; z: number }[] = [
  { x: 8, z: -230 },
  { x: 0, z: -128 },
  { x: -82, z: -56 },
  { x: 84, z: -56 },
  { x: 0, z: -6 },
  { x: 0, z: 60 },
  { x: 0, z: 168 },
];

// ---- surfaces ----------------------------------------------------------------------

function rect(
  id: string,
  r: { x0: number; z0: number; x1: number; z1: number; h: number },
  extra: Partial<Pick<FieldSurface, 'edge' | 'ground'>> = {},
): FieldSurface {
  return {
    kind: 'poly',
    id,
    points: [
      [r.x0, r.z0],
      [r.x1, r.z0],
      [r.x1, r.z1],
      [r.x0, r.z1],
    ],
    h: r.h,
    ...extra,
  };
}

/** A crescent between two radii round (cx, cz), centred on the south. */
function crescent(
  id: string,
  cx: number,
  cz: number,
  r0: number,
  r1: number,
  halfArc: number,
  h: number,
  extra: Partial<Pick<FieldSurface, 'edge' | 'ground'>> = {},
): FieldSurface {
  const steps = 14;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -halfArc + (2 * halfArc * i) / steps;
    pts.push([cx + Math.sin(a) * r1, cz - Math.cos(a) * r1]);
  }
  for (let i = steps; i >= 0; i--) {
    const a = -halfArc + (2 * halfArc * i) / steps;
    pts.push([cx + Math.sin(a) * r0, cz - Math.cos(a) * r0]);
  }
  return { kind: 'poly', id, points: pts, h, ...extra };
}

const SURFACES: FieldSurface[] = [
  // --- The Gate Landing and the stair down to the court ---------------------------
  {
    kind: 'circle',
    id: 'gate_landing',
    x: GATE_LANDING.x,
    z: GATE_LANDING.z,
    r: GATE_LANDING.r,
    h: GATE_LANDING.h,
    edge: 'rock',
    ground: 'snow',
  },
  {
    kind: 'path',
    id: 'landing_stair',
    points: [
      [0, -214, H.landing],
      [0, -211, H.landing],
      [0, -200, H.court],
      [0, -196, H.court],
    ],
    halfWidth: 6,
    stairs: true,
    edge: 'rock',
    ground: 'slate',
  },
  // --- The Keystone Court (G1) -------------------------------------------------------
  rect('keystone_court', KEYSTONE_COURT, { edge: 'rock', ground: 'slate' }),
  // --- The Sledge Road down the moraine (G2, G3, patrol A) ---------------------------
  {
    kind: 'circle',
    id: 'road_upper_bend',
    x: ROAD_BENDS.upper.x,
    z: ROAD_BENDS.upper.z,
    r: ROAD_BENDS.upper.r,
    h: ROAD_BENDS.upper.h,
    edge: 'rock',
    ground: 'earth',
  },
  {
    kind: 'circle',
    id: 'road_lower_bend',
    x: ROAD_BENDS.lower.x,
    z: ROAD_BENDS.lower.z,
    r: ROAD_BENDS.lower.r,
    h: ROAD_BENDS.lower.h,
    edge: 'rock',
    ground: 'earth',
  },
  {
    kind: 'path',
    id: 'sledge_road_upper',
    points: [
      [-2, -174, H.court],
      [-6, -168.5, H.court],
      [-30, -150.5, H.upperBend],
      [-36, -144, H.upperBend],
    ],
    halfWidth: 7,
    edge: 'rock',
    ground: 'earth',
  },
  {
    kind: 'path',
    id: 'sledge_road_middle',
    points: [
      [-36, -144, H.upperBend],
      [-26, -137.9, H.upperBend],
      [16, -116.1, H.lowerBend],
      [26, -110, H.lowerBend],
    ],
    halfWidth: 7,
    edge: 'rock',
    ground: 'earth',
  },
  {
    kind: 'path',
    id: 'sledge_road_lower',
    points: [
      [26, -110, H.lowerBend],
      [22, -99, H.lowerBend],
      [8, -88, H.fork],
      [4, -82, H.fork],
    ],
    halfWidth: 7,
    edge: 'rock',
    ground: 'earth',
  },
  // --- The Fork --------------------------------------------------------------------
  rect('fork', FORK, { edge: 'rock', ground: 'snow' }),
  // --- West: the Serac Field (G4, G5, patrol B) -------------------------------------
  {
    kind: 'path',
    id: 'serac_walk',
    points: [
      [-24, -74, H.fork],
      [-32, -74, H.fork],
      [-56, -80, H.seracUpper],
      [-62, -81, H.seracUpper],
    ],
    halfWidth: 6,
    edge: 'rock',
    ground: 'snow',
  },
  rect('serac_upper', SERAC_FIELD.upper, { edge: 'rock', ground: 'snow' }),
  {
    kind: 'path',
    id: 'ice_bridge',
    points: [
      [ICE_BRIDGE.x, ICE_BRIDGE.fromZ, H.seracUpper],
      [ICE_BRIDGE.x, -76, H.seracUpper],
      [ICE_BRIDGE.x, -64, H.seracLower],
      [ICE_BRIDGE.x, ICE_BRIDGE.toZ, H.seracLower],
    ],
    halfWidth: ICE_BRIDGE.halfWidth,
    edge: 'rock',
    ground: 'ice',
  },
  rect('serac_lower', SERAC_FIELD.lower, { edge: 'rock', ground: 'snow' }),
  {
    kind: 'path',
    id: 'west_chain_stair',
    points: [
      [-62, -30, H.seracLower],
      [-56, -29, H.seracLower],
      [-24, -22, H.terrace],
      [-18, -21, H.terrace],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'rock',
    ground: 'slate',
  },
  // --- East: the Anchor Ledge (G6, G7) ----------------------------------------------
  {
    kind: 'path',
    id: 'anchor_walk',
    points: [
      [24, -74, H.fork],
      [32, -74, H.fork],
      [56, -80, H.anchorUpper],
      [62, -81, H.anchorUpper],
    ],
    halfWidth: 6,
    edge: 'rock',
    ground: 'slate',
  },
  rect('anchor_upper', ANCHOR_LEDGE.upper, { edge: 'rock', ground: 'slate' }),
  {
    kind: 'path',
    id: 'anchor_ramp',
    points: [
      [84, -80, H.anchorUpper],
      [84, -75, H.anchorUpper],
      [84, -64, H.anchorLower],
      [84, -59, H.anchorLower],
    ],
    halfWidth: 6,
    stairs: true,
    edge: 'rock',
    ground: 'slate',
  },
  rect('anchor_lower', ANCHOR_LEDGE.lower, { edge: 'rock', ground: 'snow' }),
  {
    kind: 'path',
    id: 'east_chain_stair',
    points: [
      [62, -30, H.anchorLower],
      [56, -29, H.anchorLower],
      [24, -22, H.terrace],
      [18, -21, H.terrace],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'rock',
    ground: 'slate',
  },
  // --- The Lock Terrace (Korgath the Bound) ----------------------------------------
  {
    kind: 'circle',
    id: 'lock_terrace',
    x: LOCK_TERRACE.x,
    z: LOCK_TERRACE.z,
    r: LOCK_TERRACE.r,
    h: LOCK_TERRACE.h,
    edge: 'rock',
    ground: 'slate',
  },
  // --- The Chain Bridge (walkable once it falls, drawn by its gate) ----------------
  {
    kind: 'path',
    id: 'chain_bridge',
    hidden: true,
    points: [
      [CHAIN_BRIDGE.x, -6, CHAIN_BRIDGE.fromH],
      [CHAIN_BRIDGE.x, CHAIN_BRIDGE.fromZ, CHAIN_BRIDGE.fromH],
      [CHAIN_BRIDGE.x, CHAIN_BRIDGE.toZ, CHAIN_BRIDGE.toH],
      [CHAIN_BRIDGE.x, CHAIN_BRIDGE.toZ + 6, CHAIN_BRIDGE.toH],
    ],
    halfWidth: CHAIN_BRIDGE.halfWidth,
    edge: 'rock',
    ground: 'slate',
  },
  // --- The Thaw Works (G8, G9, G10, patrol C) ---------------------------------------
  rect('works_upper', THAW_WORKS.upper, { edge: 'rock', ground: 'snow' }),
  rect('works_lower', THAW_WORKS.lower, { edge: 'rock', ground: 'snow' }),
  // After both terraces: its ramp runs into the lower one, down the glacier
  // itself (ice, as the vault stair below it: the camp sits on the Quench).
  {
    kind: 'path',
    id: 'works_road',
    points: [
      [0, 50, H.worksUpper],
      [0, 54, H.worksUpper],
      [0, 66, H.worksLower],
      [0, 70, H.worksLower],
    ],
    halfWidth: 7,
    edge: 'rock',
    ground: 'ice',
  },
  {
    kind: 'path',
    id: 'vault_stair',
    points: [
      [0, 76, H.worksLower],
      [0, 79, H.worksLower],
      [0, 87, H.vault],
      [0, 92, H.vault],
    ],
    halfWidth: 6,
    stairs: true,
    edge: 'rock',
    ground: 'ice',
  },
  // --- The Ritual Vault (Grand Necromancer Velkhar) --------------------------------
  {
    kind: 'circle',
    id: 'ritual_vault',
    x: RITUAL_VAULT.x,
    z: RITUAL_VAULT.z,
    r: RITUAL_VAULT.r,
    h: RITUAL_VAULT.h,
    edge: 'rock',
    ground: 'ice',
  },
  // --- The Shore of the Held (G11, G12, patrol D) -----------------------------------
  crescent(
    'shore_of_the_held',
    SHORE.x,
    SHORE.z,
    SHORE.innerR,
    SHORE.outerR,
    SHORE.halfArc,
    SHORE.h,
    { edge: 'rock', ground: 'snow' },
  ),
  {
    kind: 'path',
    id: 'shore_stair',
    points: [
      [0, 118, H.vault],
      [0, 121, H.vault],
      [0, 129, H.shore],
      [0, 134, H.shore],
    ],
    halfWidth: 6,
    stairs: true,
    edge: 'rock',
    ground: 'slate',
  },
  // --- The Wyrm's Hollow: the shelf, then the lake on top of it (Korzul) -----------
  {
    kind: 'circle',
    id: 'hollow_shelf',
    x: WYRMS_HOLLOW.x,
    z: WYRMS_HOLLOW.z,
    r: WYRMS_HOLLOW.shelfR,
    h: WYRMS_HOLLOW.h,
    edge: 'rock',
    ground: 'slate',
  },
  {
    kind: 'circle',
    id: 'frozen_lake',
    x: WYRMS_HOLLOW.x,
    z: WYRMS_HOLLOW.z,
    r: WYRMS_HOLLOW.lakeR,
    h: WYRMS_HOLLOW.h,
    edge: 'rock',
    ground: 'ice',
  },
  {
    kind: 'path',
    id: 'lake_stair',
    points: [
      [0, 136, H.shore],
      [0, 140, H.shore],
      [0, 146, H.lake],
      [0, 150, H.lake],
    ],
    halfWidth: 5,
    stairs: true,
    edge: 'rock',
    ground: 'slate',
  },
];

// ---- props ---------------------------------------------------------------------
// Kinds are the renderer's dressing keys (render/gravewyrm_sanctum); a footprint
// (`r`, or `hw`/`hd` turned by `rot`) adds a collider. Nothing solid stands on a
// path's walking line, a pack's spot, a gate's span or an arena's middle.

const PILLAR_PROPS: FieldProp[] = SEAL_PILLARS.map((p) => ({
  kind: `gs_seal_pillar_${p.id}`,
  x: p.x,
  z: p.z,
  rot: Math.atan2(LOCK_TERRACE.x - p.x, LOCK_TERRACE.z - p.z),
  r: p.r,
  h: 12,
}));

const POOL_PROPS: FieldProp[] = THAW_POOLS.map((p) => ({
  kind: 'gs_thaw_pyre',
  x: p.x,
  z: p.z,
  rot: Math.atan2(RITUAL_VAULT.x - p.x, RITUAL_VAULT.z - p.z),
  r: 1.6,
  h: 6,
}));

const PROPS: FieldProp[] = [
  // The Gate Landing: the gate tunnel's mouth behind it, the vigil cairn.
  { kind: 'gs_gate_tunnel', x: GATE_TUNNEL.x, z: GATE_TUNNEL.z, rot: GATE_TUNNEL.rot },
  { kind: 'gs_vigil_cairn', x: -8.5, z: -228, rot: 0.4, r: 1.1, h: 2.4 },
  // The Keystone Court: the empty socket on its plinth, chain heaps, a rune stone.
  {
    kind: 'gs_keystone_socket',
    x: KEYSTONE_SOCKET.x,
    z: KEYSTONE_SOCKET.z,
    rot: -0.5,
    r: KEYSTONE_SOCKET.r,
    h: 4,
  },
  { kind: 'gs_chain_heap', x: -19, z: -192, rot: 1.1, r: 2.2, h: 1.6 },
  { kind: 'gs_cult_brazier', x: -12, z: -170, rot: 0, r: 0.8, h: 1.6 },
  { kind: 'gs_cult_brazier', x: 12, z: -170, rot: 0, r: 0.8, h: 1.6 },
  // The Sledge Road: moraine rocks on the outside of each bend, a broken sledge.
  { kind: 'gs_moraine_rocks', x: -37, z: -155.5, rot: 0.6, r: 2.4, h: 2.4 },
  { kind: 'gs_moraine_rocks', x: 33, z: -101, rot: -0.4, r: 2.4, h: 2.2 },
  { kind: 'gs_cult_sledge', x: 19, z: -178, rot: 0.4, hw: 1.6, hd: 3.4, h: 1.8 },
  // On the lower bend's inner rim, clear of the Sledge Tusker's two lanes.
  { kind: 'gs_soul_brazier', x: 17, z: -104, rot: 0, r: 0.9, h: 1.8 },
  // The Fork: the Rime Gate's ice and a cairn of the cult's goad irons.
  { kind: 'gs_goad_rack', x: -22, z: -82, rot: 0.2, hw: 1.8, hd: 0.5, h: 2.2 },
  // Thornpeak boulders on the terrace rims (clear of the walk): solid, so a
  // body bumps the rock it sees instead of walking through it.
  { kind: 'gs_rim_rock_a', x: -24, z: -196, rot: 0.3, r: 2.5, h: 3.1 },
  { kind: 'gs_rim_rock_b', x: 24, z: -172, rot: 2.1, r: 2.6, h: 2 },
  { kind: 'gs_rim_rock_c', x: -46.5, z: -149.5, rot: 1.2, r: 1.7, h: 4.4 },
  { kind: 'gs_rim_rock_a', x: 36, z: -112, rot: 4, r: 2, h: 2.6 },
  { kind: 'gs_rim_rock_b', x: -26, z: -66, rot: 0.6, r: 2.4, h: 1.9 },
  { kind: 'gs_rim_rock_c', x: 26, z: -82, rot: 2.8, r: 1.5, h: 4.2 },
  { kind: 'gs_rim_rock_c', x: 46, z: 52, rot: 2.2, r: 1.7, h: 4.6 },
  // The Serac Field: ice towers on both shelves, clear of the walk and the bridge.
  { kind: 'gs_serac_large', x: -98, z: -106, rot: 0.3, r: 5, h: 26 },
  { kind: 'gs_serac_medium', x: -66, z: -106, rot: 1.2, r: 3.6, h: 18 },
  { kind: 'gs_serac_medium', x: -100, z: -84, rot: 2.1, r: 3.6, h: 18 },
  { kind: 'gs_serac_large', x: -102, z: -52, rot: 0.8, r: 5, h: 28 },
  { kind: 'gs_serac_small', x: -61, z: -56, rot: 0.1, r: 2.6, h: 12 },
  { kind: 'gs_serac_medium', x: -102, z: -22, rot: 2.6, r: 3.6, h: 18 },
  { kind: 'gs_serac_small', x: -90, z: -20, rot: 1.6, r: 2.6, h: 12 },
  // The Anchor Ledge: the rune wall, the two great chain anchors, the gang in
  // the ice beside the path.
  {
    kind: 'gs_rune_wall',
    x: RUNE_WALL.x,
    z: RUNE_WALL.z,
    rot: 0,
    hw: RUNE_WALL.hw,
    hd: RUNE_WALL.hd,
    h: 16,
  },
  { kind: 'gs_chain_anchor', x: 70, z: -106, rot: 0, hw: 4, hd: 3.4, h: 8 },
  { kind: 'gs_chain_anchor', x: 98, z: -108, rot: 0.2, hw: 4, hd: 3, h: 8 },
  { kind: 'gs_held_giant', x: 104, z: -56, rot: -1.4, r: 3, h: 9 },
  { kind: 'gs_held_giant', x: 106, z: -36, rot: -1.7, r: 3, h: 9 },
  { kind: 'gs_held_giant', x: 61, z: -100, rot: 1.6, r: 3, h: 9 },
  // The Lock Terrace: the four seal pillars and the Smith's hammer.
  ...PILLAR_PROPS,
  {
    kind: 'gs_smiths_hammer',
    x: SMITHS_HAMMER.x,
    z: SMITHS_HAMMER.z,
    rot: SMITHS_HAMMER.rot,
    hw: SMITHS_HAMMER.hw,
    hd: SMITHS_HAMMER.hd,
    h: 3,
  },
  // The Thaw Works: tents, sledges and soul pyres, the melt channel, a rite circle.
  { kind: 'gs_cult_tent', x: -44, z: 34, rot: 0.6, hw: 3, hd: 3, h: 4 },
  { kind: 'gs_cult_tent', x: 44, z: 34, rot: -0.6, hw: 3, hd: 3, h: 4 },
  { kind: 'gs_cult_sledge', x: -44, z: 50, rot: 0.2, hw: 1.6, hd: 3.4, h: 1.8 },
  { kind: 'gs_cult_sledge', x: -20, z: 52, rot: -0.4, hw: 1.6, hd: 3.4, h: 1.8 },
  { kind: 'gs_soul_pyre', x: -14, z: 32, rot: 0, r: 1.4, h: 4 },
  { kind: 'gs_soul_pyre', x: 16, z: 32, rot: 0, r: 1.4, h: 4 },
  { kind: 'gs_soul_pyre', x: -36, z: 76, rot: 0, r: 1.4, h: 4 },
  { kind: 'gs_soul_pyre', x: 36, z: 76, rot: 0, r: 1.4, h: 4 },
  { kind: 'gs_ritual_circle', x: 24, z: 70, rot: 0 },
  { kind: 'gs_melt_channel', x: 30, z: 42, rot: 0 },
  // The Ritual Vault: the three thaw pyres in their pools.
  ...POOL_PROPS,
  // The Shore of the Held: the held dead standing in the shallow ice.
  { kind: 'gs_held_dead', x: -45, z: 157, rot: 0.6, r: 0.6, h: 2.2 },
  { kind: 'gs_held_dead', x: -18, z: 141, rot: 0.2, r: 0.6, h: 2.2 },
  { kind: 'gs_held_dead', x: 18, z: 141, rot: -0.3, r: 0.6, h: 2.2 },
  { kind: 'gs_held_dead', x: 46, z: 156, rot: -0.7, r: 0.6, h: 2.2 },
  { kind: 'gs_held_dead', x: -46, z: 163, rot: 1, r: 0.6, h: 2.2 },
  { kind: 'gs_held_dead', x: 46, z: 163, rot: -1, r: 0.6, h: 2.2 },
];

export const GRAVEWYRM_SANCTUM_FIELD: AuthoredFieldDef = {
  key: 'gravewyrm_sanctum',
  bounds: { minX: -114, maxX: 114, minZ: -238, maxZ: 240 },
  voidHeight: GRAVEWYRM_SANCTUM_VOID_HEIGHT,
  cliffStep: 1.1,
  mapVoid: 'crevasse',
  surfaces: SURFACES,
  walls: [],
  props: PROPS,
  lightZones: [
    { id: 'landing', x: 0, z: -220, r: 40, key: 0xc8d8f0, accent: 0x9fd2ff, fog: 0x5a7090 },
    { id: 'road', x: 0, z: -140, r: 70, key: 0xc4d4ec, accent: 0xe8862e, fog: 0x56708e },
    { id: 'serac', x: -82, z: -64, r: 55, key: 0xbcd4f0, accent: 0x7fc4e8, fog: 0x4f6c8e },
    { id: 'anchor', x: 84, z: -64, r: 55, key: 0xc0d0ea, accent: 0x5ab8ff, fog: 0x526c8c },
    { id: 'terrace', x: 0, z: -22, r: 40, key: 0xc4d2ec, accent: 0x5ab8ff, fog: 0x546e8e },
    { id: 'works', x: 0, z: 54, r: 50, key: 0xd8ccc4, accent: 0xe8862e, fog: 0x6a6670 },
    { id: 'vault', x: 0, z: 107, r: 30, key: 0xc0c4dc, accent: 0x8fd6a0, fog: 0x544e6e },
    { id: 'shore', x: 0, z: 150, r: 45, key: 0xbcd0ec, accent: 0x9fd2ff, fog: 0x4c6688 },
    { id: 'hollow', x: 0, z: 200, r: 55, key: 0xc8d2ec, accent: 0xf2b880, fog: 0x4a6488 },
  ],
};
