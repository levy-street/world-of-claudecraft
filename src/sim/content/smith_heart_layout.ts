// The Smith's Heart (docs/design/raid/smith_heart.md): a ten-player raid in
// the heart of Stormcrag. Before he lay down to become Thornpeak, the Smith
// split his strength into four (the Heat, the Breath, the Hammer, the Quench:
// the four acts of the Sanctum's rune creed); each sleeps in a vein of the
// mountain that runs down to its heart, and Korzul's stirring woke them. Open
// air throughout: every vein is a fissure open to the storm sky, never a
// roofed tunnel, so the camera never meets a vault.
//
// TWO areas share the one instance slot, never joined by floor:
//
// The main map (north +z, east +x, heights in yards; the Ring is 0):
//   the Cleft (44; the world entrance, a crack in the Stormcrag cliffs) -> the
//   Hammer Gallery, descending east (packs h1, h2, h3) -> the Smith's Quarry
//   (14; a deep pit under stepped terraces and half-carved colossi, the Hammer
//   guardian, ALWAYS FIRST) -> the Slab (a stone gate that breaks when the
//   guardian dies) -> the Balcony (20; the first view over the whole heart)
//   -> the two Balcony Stairs, curving down to the Ring (0; packs r1 to r8)
//   -> in ANY order:
//     north, the Breath (climbs to the Storm Cornice at 60: packs b1 to b3,
//       the Wind Bridge, a cracked plateau cut by wind channels);
//     east, the Quench (descends to the Quench Basin at -30: packs q1 to q3,
//       the Singing Ice, the frozen lake where the Smith cooled his work);
//     west, the Heat (level, the Hearth, the Smith's first flame: packs f1
//       to f3, the Pour Channel, the Hearth's mouth and its altar-stone; the
//       ids below keep the forge names they had before phase 2I);
//   -> four colours lit on the heart seal, on the Seal Dais in the middle of
//   the Ring, reached by the Grand Stair down from the Balcony's tip or by the
//   North Stair down from the Ring's north (the Breath's mouth) -> the seal
//   opens into a portal.
//
// The Heart (a separate area in the slot's north-east corner, walled off by
// the mountain): the portal lands the raid on the Arrival Terrace, a short
// bridge (sealed while the final boss fights) crosses onto the Anvil of the
// World, a vast round platform hung by four colossal chains over the Smith's
// glowing heart, the four altars at its cardinal points. A return portal on
// the terrace walks the raid back to the Seal Dais.
//
// Engine limit: ONE floor height per point (authored_field/CLAUDE.md), so the
// Balcony replaces the Ring's south arc and the Ring loops over it by the two
// stairs. The void between the Ring and the dais is open air but for the two
// stairs down to the dais (south and north), both below every Ring eye's line
// to the seal: the seal is in sight from every point of the Ring. The whole field stays inside one slot of
// the instance band (|x| < 300, |z| < 250).
//
// Pure data: the sim (height, collision, spawns, gates, the portal hop) and
// the renderer (terrain, light rivers, the seal, the portal) read this one
// record.

import type { AuthoredFieldDef, FieldProp, FieldSurface } from '../instances/authored_field/types';

/** The void under every floor: the fissures' depth (below the Quench Basin). */
export const SMITH_HEART_VOID_HEIGHT = -70;

/** The floor heights of the route. */
export const SMITH_HEART_HEIGHTS = {
  cleft: 44,
  galleryUpper: 40,
  galleryMiddle: 34,
  galleryLower: 28,
  pit: 14,
  balcony: 20,
  ring: 0,
  dais: -4,
  breathLow: 0,
  breathMid: 16,
  breathHigh: 40,
  cornice: 60,
  quenchUpper: -8,
  quenchMiddle: -16,
  quenchShelf: -24,
  lake: -30,
  heat: 0,
  heartRoom: 0,
  heartTerrace: 4,
} as const;

const H = SMITH_HEART_HEIGHTS;

/** The four veins, in their lore order (the rune creed). */
export type SmithHeartVein = 'hammer' | 'breath' | 'quench' | 'heat';
export const SMITH_HEART_VEINS: readonly SmithHeartVein[] = ['hammer', 'breath', 'quench', 'heat'];

/** One colour per vein (render: light, light river, seal quarter, portal
 *  arm, pour). The Heat is white-gold smith fire, never Ignivar's volcanic
 *  orange-red. */
export const SMITH_HEART_VEIN_COLORS: Readonly<Record<SmithHeartVein, number>> = {
  hammer: 0xc8903c,
  breath: 0x5ab8e8,
  quench: 0x9ad8ff,
  heat: 0xffe6a0,
};

/** Deterministic hash in [0, 1) of two integers (the outlines' jag; no rng
 *  in a layout). */
function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A point at compass bearing `deg` (clockwise from north) on an ellipse. */
function bearingPoint(
  cx: number,
  cz: number,
  deg: number,
  rx: number,
  rz: number,
): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + Math.sin(a) * rx, cz + Math.cos(a) * rz];
}

// ---- the main map: the Ring and the Seal Dais ---------------------------------------

/** The Ring: the circular gallery round the heart seal. `R` is its centre line. */
export const RING = { x: 0, z: 0, R: 70, innerR: 62, outerR: 78, h: H.ring } as const;
/** The Ring's arc (degrees, clockwise from north): it runs the long way round
 *  from the west stair's foot to the east stair's foot, through the north. */
export const RING_ARC = { fromDeg: 222, toDeg: 498 } as const;

/** The Seal Dais: a round anvil-stone floating over the void in the middle of
 *  the Ring, a little below it (the whole Ring looks down onto the seal). */
export const SEAL_DAIS = { x: 0, z: 0, r: 19, h: H.dais } as const;
/** The seal at the dais's centre (render: the four-colour progress disc). */
export const HEART_SEAL = { x: 0, z: 0, r: 9 } as const;
/** The portal the seal opens into (its walk-in trigger radius). */
export const RING_PORTAL = { x: 0, z: 0, r: 4 } as const;
/** Where the Heart's return portal sets the raid down: on the dais, facing
 *  the Grand Stair (sim facing, 0 = +z), clear of the portal's trigger. */
export const RING_PORTAL_LANDING = { x: 0, z: -12, facing: Math.PI } as const;

/** The Ring's eight pack spots (bearings, degrees): two between each pair of
 *  vein mouths. */
export const RING_PACK_DEGREES = [30, 60, 105, 125, 235, 255, 300, 330] as const;

/** A point on the Ring's circle at `deg` (clockwise from north) and radius `r`. */
export function ringPoint(deg: number, r: number = RING.R): { x: number; z: number } {
  const a = (deg * Math.PI) / 180;
  return { x: RING.x + Math.sin(a) * r, z: RING.z + Math.cos(a) * r };
}

// ---- the main map: the Hammer (south-west to south) ---------------------------------

/** The Cleft: the world entrance's landing, high in the south-west. */
export const CLEFT = { x: -198, z: -212, r: 12, h: H.cleft } as const;
/** The Hammer Gallery's three landings (packs h1, h2, h3). */
export const GALLERY_LANDINGS = {
  h1: { x: -150, z: -226, r: 12, h: H.galleryUpper },
  h2: { x: -98, z: -232, r: 12, h: H.galleryMiddle },
  h3: { x: -66, z: -206, r: 12, h: H.galleryLower },
} as const;
/** The Smith's Quarry, the first guardian's arena: a deep pit, about 92 by 80
 *  yd, under stepped terraces on its east and south sides. */
export const HAMMER_PIT = { x: 8, z: -170, rx: 46, rz: 40, h: H.pit } as const;
/** The quarry's terraces (unreachable steps cut into the mountain): how far
 *  each step reaches past the pit's rim and its height. The colossi stand on
 *  the deep top step. The steps span bearings `fromDeg` to `toDeg` from the
 *  pit's centre (east and south, clockwise), facing the gallery's descent. */
export const QUARRY_TERRACES = {
  fromDeg: 35,
  toDeg: 215,
  steps: [
    { out: 7, h: 21 },
    { out: 14, h: 28 },
    { out: 21, h: 35 },
    { out: 33, h: 42 },
  ],
} as const;
/** The Slab: the living stone that seals the way to the heart. */
export const SLAB = { x: 0, z: -124 } as const;
/** The Balcony: the first view, jutting out over the void toward the seal. */
export const BALCONY = { x0: -12, z0: -114, x1: 12, z1: -58, h: H.balcony } as const;
/** The Grand Stair: from the Balcony's tip down across the void to the dais. */
export const GRAND_STAIR = { halfWidth: 8, top: -58, foot: -SEAL_DAIS.r } as const;
/** The North Stair: the dais's second way in, straight down from the Ring's
 *  inner edge at its north (the Breath's mouth, the vein mouth furthest from
 *  the Balcony) to the dais, as broad as the Grand Stair. A raid finishing in
 *  the north (or a spirit on its corpse run) reaches the portal without
 *  walking round the Ring. Its fall is gentle (the Ring at 0 to the dais at
 *  -4 over the chasm), so it stays under every Ring eye's line to the seal. */
export const NORTH_STAIR = { halfWidth: 8, top: RING.innerR, foot: SEAL_DAIS.r } as const;

// ---- the main map: the Breath (north, high) -----------------------------------------

/** The Breath: three landings and the Storm Cornice (about 100 by 80 yd). */
export const BREATH = {
  b1: { x: 0, z: 104, r: 13, h: H.breathLow },
  b2: { x: -64, z: 112, r: 11, h: H.breathMid },
  b3: { x: -112, z: 170, r: 11, h: H.breathHigh },
  cornice: { x: 0, z: 196, rx: 50, rz: 40, h: H.cornice },
} as const;
/** The Wind Bridge: the natural rock arch between the Breath's second and
 *  third landings (gusts in rhythm, phase 2). */
export const WIND_BRIDGE = {
  fromX: -67,
  fromZ: 121,
  toX: -101,
  toZ: 159,
  halfWidth: 6.5,
} as const;
/** The cornice's wind channels: notches cut into the plateau from its rim,
 *  where the updraft howls up out of the mountain (bearing from the cornice's
 *  centre, depth in yards, half the opening in degrees). */
export const CORNICE_CHANNELS: readonly { deg: number; depth: number; halfDeg: number }[] = [
  { deg: 22, depth: 14, halfDeg: 7 },
  { deg: 78, depth: 16, halfDeg: 6 },
  { deg: 128, depth: 12, halfDeg: 7 },
  { deg: 182, depth: 13, halfDeg: 6 },
  { deg: 332, depth: 15, halfDeg: 6 },
];

/** The Storm Cornice's broken gaps (the Guardian of the Breath's fight,
 *  design doc 7.2): the throats of four of the wind channels, where the rim's
 *  wall has fallen and the lip lies open to the void. A body walked or blown
 *  into one falls (the field builds no wall there: `lipOpenings`); everywhere
 *  else the rim stays walled. The eastern channel (78) keeps its wall. */
export const CORNICE_GAP_DEGREES: readonly number[] = [22, 128, 182, 332];
/** A gap's reach round its throat (yards): the lip inside it is open. */
export const CORNICE_GAP_R = 6;
export const CORNICE_GAPS: readonly { deg: number; x: number; z: number; r: number }[] =
  CORNICE_GAP_DEGREES.map((deg) => {
    const ch = CORNICE_CHANNELS.find((c) => c.deg === deg) ?? CORNICE_CHANNELS[0];
    const C = BREATH.cornice;
    const [x, z] = bearingPoint(C.x, C.z, deg, C.rx - ch.depth * 0.9, C.rz - ch.depth * 0.9);
    return { deg, x, z, r: CORNICE_GAP_R };
  });

// ---- the main map: the Quench (east, low) -------------------------------------------

/** The Quench: two landings, the Singing Ice sheet, the Quench Basin (its
 *  rock shelf and the frozen lake on it, about 96 by 92 yd). */
export const QUENCH = {
  q1: { x: 110, z: 0, r: 12, h: H.quenchUpper },
  q2: { x: 122, z: -48, r: 12, h: H.quenchMiddle },
  ice: { x0: 140, z0: -100, x1: 178, z1: -72, h: H.quenchShelf },
  shelf: { x: 198, z: -2, rx: 48, rz: 46, h: H.lake },
  lake: { x: 198, z: -2, rx: 37, rz: 35, h: H.lake },
} as const;

// ---- the main map: the Heat (west, level) -------------------------------------------

/** The Heat: the hall, the casting floor, the Hearth's arena (`forge`: the
 *  ids keep their forge names; the look is the Hearth's, phase 2I). */
export const HEAT = {
  hall: { x0: -124, z0: -14, x1: -76, z1: 14, h: H.heat },
  floor: { x0: -164, z0: -36, x1: -124, z1: 36, h: H.heat },
  forge: { x: -214, z: 0 },
} as const;
/** The Pour Channel: where the wellspring's fire crosses the casting floor's
 *  path (its look and cycle are the renderer's now, a timed hazard later). */
export const POUR_CHANNEL = { x: -150, z0: -36, z1: 36, halfWidth: 2.5 } as const;
/** The Hearth's arena (`smiths_forge`): an eight-sided hall carved in the
 *  mountain's basalt, the Hearth's mouth in its west wall (render: beyond the
 *  floor's edge). */
export const FORGE_POINTS: readonly (readonly [number, number])[] = [
  [-174, -22],
  [-182, -38],
  [-200, -46],
  [-230, -46],
  [-248, -36],
  [-256, -16],
  [-256, 16],
  [-248, 36],
  [-230, 46],
  [-200, 46],
  [-182, 38],
  [-174, 22],
];
/** The Hearth's mouth in the rock behind the west wall (render only; nothing
 *  of it stands over the floor). */
export const GREAT_HEARTH = { x: -263, z: 0, halfWidth: 18 } as const;
/** The great altar-stone (once the giant anvil: its footprint and height),
 *  side-on to the arena's door, its crystal crown north. */
export const GIANT_ANVIL = { x: -236, z: 0, hw: 3.2, hd: 8.5, h: 9 } as const;
/** The Guardian of the Heat's fight channel (design doc 7.4): a seam of the
 *  first flame across the Hearth's floor, north wall to south lip, through
 *  the hall's middle, that splits the floor in two while it flows (the
 *  wellspring's channel's twin, on the fight's own clock). Instance-local. */
export const HEARTH_CHANNEL = { x: -215, z0: -46, z1: 46 } as const;
/** Where the Guardian of the Heat's Kindled Crystals rise from the basalt
 *  (design doc 7.4): three sockets each side of the channel, clear of the
 *  altar-stone, the crystal clusters and the walls. `side` -1 the Hearth's
 *  (west), +1 the door's (east). Instance-local. */
export const HEARTH_CRYSTAL_SOCKETS: readonly { x: number; z: number; side: -1 | 1 }[] = [
  { x: -190, z: 0, side: 1 },
  { x: -196, z: -26, side: 1 },
  { x: -196, z: 26, side: 1 },
  { x: -249, z: 0, side: -1 },
  { x: -232, z: -28, side: -1 },
  { x: -232, z: 28, side: -1 },
];

// ---- the Heart: the separate final room ---------------------------------------------

/** The Anvil of the World: the final boss's platform (84 yd across), hung by
 *  four chains over the Smith's glowing heart. */
export const HEART_ROOM = { x: 188, z: 172, r: 42, h: H.heartRoom } as const;
/** The open air round the platform (its chasm, down to the glowing heart):
 *  no rock stands within this radius of the room's centre. */
export const HEART_ROOM_CHASM_R = 70;
/** The Arrival Terrace, south-west of the platform, outside the boss's reach. */
export const HEART_TERRACE = { x: 138.5, z: 122.5, r: 13, h: H.heartTerrace } as const;
/** Where the Ring's portal sets the raid down (facing the platform). */
export const HEART_ARRIVAL = { x: 141, z: 125, facing: Math.PI / 4 } as const;
/** The return portal on the terrace's west side, back to the Seal Dais: to
 *  the side of the arrival, never behind it (a camera behind a player who
 *  just arrived never stands in it). */
export const HEART_RETURN_PORTAL = { x: 132.5, z: 128.5, r: 3.5 } as const;
/** Everything of the Heart lies within this radius of the room's centre; the
 *  main map lies wholly outside it (the area split for music, fog, sky). */
export const HEART_ROOM_AREA_R = 125;

/** The four altars round the Anvil of the World, one per vein at its compass
 *  point; each takes its vein's light down its chain. */
export const HEART_ALTARS: readonly { vein: SmithHeartVein; x: number; z: number }[] = [
  { vein: 'breath', x: HEART_ROOM.x, z: HEART_ROOM.z + 36 },
  { vein: 'quench', x: HEART_ROOM.x + 36, z: HEART_ROOM.z },
  { vein: 'hammer', x: HEART_ROOM.x, z: HEART_ROOM.z - 36 },
  { vein: 'heat', x: HEART_ROOM.x - 36, z: HEART_ROOM.z },
];

/** The unit vector from the terrace toward the platform's centre. */
const TU = (() => {
  const dx = HEART_ROOM.x - HEART_TERRACE.x;
  const dz = HEART_ROOM.z - HEART_TERRACE.z;
  const l = Math.hypot(dx, dz);
  return { x: dx / l, z: dz / l };
})();
/** A point `s` yards from the terrace's centre toward the platform. */
function towardHeart(s: number): { x: number; z: number } {
  return { x: HEART_TERRACE.x + TU.x * s, z: HEART_TERRACE.z + TU.z * s };
}
/** The Heart Bridge's gate: sealed behind the raid while the final boss fights. */
export const HEART_BRIDGE_GATE = { ...towardHeart(22), dx: TU.x, dz: TU.z } as const;

/** Is (x, z) in the Heart (the separate final room)? Instance-local. */
export function inSmithHeartRoom(x: number, z: number): boolean {
  return Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z) < HEART_ROOM_AREA_R;
}

/** The named areas (music, fog, sky): the main map's veins and the Heart. */
export type SmithHeartArea = 'hammer' | 'ring' | 'breath' | 'quench' | 'heat' | 'heart';

/** Which area holds instance-local (x, z). Pure. */
export function smithHeartAreaAt(x: number, z: number): SmithHeartArea {
  if (inSmithHeartRoom(x, z)) return 'heart';
  if (Math.hypot(x, z) <= RING.outerR + 6) return 'ring';
  if (z > 80 && x < 90) return 'breath';
  if (x > 80) return 'quench';
  if (x < -76 && z > -80) return 'heat';
  return 'hammer';
}

// ---- bosses and anchors -------------------------------------------------------------

/** Where each boss stands. */
export const SMITH_HEART_BOSS_SPOTS = {
  hammer: { x: HAMMER_PIT.x, z: HAMMER_PIT.z },
  breath: { x: BREATH.cornice.x, z: BREATH.cornice.z + 2 },
  quench: { x: QUENCH.lake.x, z: QUENCH.lake.z },
  heat: { x: -210, z: 0 },
  final: { x: HEART_ROOM.x, z: HEART_ROOM.z },
  /** The Hammer Council's other two (section 7.1): the Slabwright and the
   *  Seam Singer flank the Guardian a little behind it, well inside the
   *  ring of columns. */
  slabwright: { x: HAMMER_PIT.x + 3, z: HAMMER_PIT.z - 9 },
  seamSinger: { x: HAMMER_PIT.x + 3, z: HAMMER_PIT.z + 9 },
} as const;

/** Named anchors: the entry, dev teleports and the renderer's set pieces. */
export const SMITH_HEART_ANCHORS = {
  entry: { x: -196, z: -210 },
  exit: { x: -204, z: -217 },
  cleft: { x: -198, z: -212 },
  gallery: { x: -98, z: -232 },
  pit: { x: -22, z: -172 },
  balcony: { x: 0, z: -70 },
  ring: { x: 0, z: 70 },
  ringSouthEast: ringPoint(125),
  ringSouthWest: ringPoint(235),
  breath: { x: 0, z: 100 },
  bridge: { x: -84, z: 140 },
  cornice: { x: -32, z: 194 },
  quench: { x: 106, z: 0 },
  ice: { x: 156, z: -86 },
  lake: { x: 186, z: -36 },
  heat: { x: -90, z: 0 },
  forge: { x: -140, z: 0 },
  anvil: { x: -186, z: 0 },
  portal: { x: RING_PORTAL_LANDING.x, z: RING_PORTAL_LANDING.z },
  heartRoom: { x: HEART_ARRIVAL.x, z: HEART_ARRIVAL.z },
} as const;

/**
 * The floor light-rivers: one per vein, from its guardian's arena down the
 * vein to the heart seal (render; a river lights up when its guardian dies).
 * Each is a polyline of instance-local points; the renderer drapes it on the
 * floor. They run the vein's walking line, so following the light always
 * leads to the guardian; the last leg leaps the void onto the dais.
 */
export const LIGHT_RIVERS: Readonly<Record<SmithHeartVein, readonly { x: number; z: number }[]>> = {
  hammer: [
    { x: 8, z: -170 },
    { x: 2, z: -142 },
    { x: 0, z: -128 },
    { x: 0, z: -110 },
    { x: 0, z: -58 },
    { x: 0, z: -19 },
    { x: 0, z: -9 },
  ],
  breath: [
    { x: 0, z: 198 },
    { x: -30, z: 194 },
    { x: -60, z: 193 },
    { x: -104, z: 179 },
    { x: -112, z: 170 },
    { x: -101, z: 159 },
    { x: -67, z: 121 },
    { x: -64, z: 112 },
    { x: -48, z: 112 },
    { x: -13, z: 109 },
    { x: 0, z: 104 },
    { x: 0, z: 78 },
    { x: 0, z: 62 },
    { x: 0, z: 9 },
  ],
  quench: [
    { x: 198, z: -2 },
    { x: 190, z: -44 },
    { x: 175, z: -72 },
    { x: 160, z: -86 },
    { x: 144, z: -79 },
    { x: 130, z: -60 },
    { x: 122, z: -48 },
    { x: 120, z: -32 },
    { x: 115, z: -13 },
    { x: 110, z: 0 },
    { x: 78, z: 0 },
    { x: 62, z: 0 },
    { x: 9, z: 0 },
  ],
  heat: [
    { x: -210, z: 0 },
    { x: -174, z: 0 },
    { x: -104, z: 0 },
    { x: -78, z: 0 },
    { x: -62, z: 0 },
    { x: -9, z: 0 },
  ],
};

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

function disc(
  id: string,
  c: { x: number; z: number; r: number; h: number },
  extra: Partial<Pick<FieldSurface, 'edge' | 'ground'>> = {},
): FieldSurface {
  return { kind: 'circle', id, x: c.x, z: c.z, r: c.r, h: c.h, ...extra };
}

/** A carved ellipse: its outline bites in by up to `jag` yards here and there
 *  (deterministic), so the rim reads as cut rock, never a lathe. */
function carvedEllipse(
  id: string,
  e: { x: number; z: number; rx: number; rz: number; h: number },
  jag: number,
  seed: number,
  extra: Partial<Pick<FieldSurface, 'edge' | 'ground'>> = {},
  stepDeg = 8,
): FieldSurface {
  const points: [number, number][] = [];
  for (let d = 0, k = 0; d < 360; d += stepDeg, k++) {
    const bite = jag * hash01(k, seed);
    points.push(bearingPoint(e.x, e.z, d, e.rx - bite, e.rz - bite));
  }
  return { kind: 'poly', id, points, h: e.h, ...extra };
}

/** One quarry step: the sector from the pit's centre out to the step's reach,
 *  over the terraces' bearings (the pit's own floor, drawn later, wins inside
 *  its rim). */
function quarryStep(i: number): FieldSurface {
  const step = QUARRY_TERRACES.steps[i];
  const P = HAMMER_PIT;
  const points: [number, number][] = [[P.x, P.z]];
  for (let d = QUARRY_TERRACES.fromDeg, k = 0; d <= QUARRY_TERRACES.toDeg; d += 6, k++) {
    const bite = 2.2 * hash01(k, 31 + i);
    points.push(bearingPoint(P.x, P.z, d, P.rx + step.out - bite, P.rz + step.out - bite));
  }
  return {
    kind: 'poly',
    id: `quarry_step_${i + 1}`,
    points,
    h: step.h,
    edge: 'rock',
    ground: 'quarry',
  };
}

/** The Storm Cornice: a cracked plateau, its rim cut by the wind channels. */
function cornice(): FieldSurface {
  const C = BREATH.cornice;
  const points: [number, number][] = [];
  for (let d = 0, k = 0; d < 360; d += 3, k++) {
    let bite = 1.6 * hash01(k, 47);
    for (const ch of CORNICE_CHANNELS) {
      let off = Math.abs(d - ch.deg) % 360;
      if (off > 180) off = 360 - off;
      // A V cut: deepest on the channel's line, gone at its opening's edge.
      if (off < ch.halfDeg) bite = Math.max(bite, ch.depth * (1 - off / ch.halfDeg));
    }
    points.push(bearingPoint(C.x, C.z, d, C.rx - bite, C.rz - bite));
  }
  return { kind: 'poly', id: 'storm_cornice', points, h: C.h, edge: 'rock', ground: 'scoured' };
}

/** The Ring as one flat annulus sector (clockwise from `fromDeg` to `toDeg`). */
function ringSector(): FieldSurface {
  const pts: [number, number][] = [];
  const step = 4;
  for (let d = RING_ARC.fromDeg; d <= RING_ARC.toDeg; d += step) {
    const p = ringPoint(d, RING.outerR);
    pts.push([p.x, p.z]);
  }
  for (let d = RING_ARC.toDeg; d >= RING_ARC.fromDeg; d -= step) {
    const p = ringPoint(d, RING.innerR);
    pts.push([p.x, p.z]);
  }
  return { kind: 'poly', id: 'ring', points: pts, h: H.ring, edge: 'balustrade', ground: 'slate' };
}

/**
 * One Balcony Stair, following the Ring's circle from the Balcony down to the
 * Ring: flat from `topDeg` for 4 degrees, down to the Ring by `footDeg` (+-6
 * degrees of flat run into the Ring).
 */
function balconyStair(id: string, topDeg: number, footDeg: number): FieldSurface {
  const dir = Math.sign(footDeg - topDeg);
  const pts: [number, number, number][] = [];
  const flatTop = topDeg + 4 * dir;
  const flatFoot = footDeg + 6 * dir;
  const push = (deg: number, h: number) => {
    const p = ringPoint(deg);
    pts.push([p.x, p.z, h]);
  };
  push(topDeg, H.balcony);
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    push(flatTop + (footDeg - flatTop) * t, H.balcony + (H.ring - H.balcony) * t);
  }
  push(flatFoot, H.ring);
  return {
    kind: 'path',
    id,
    points: pts,
    halfWidth: 7,
    stairs: true,
    edge: 'balustrade',
    ground: 'slate',
  };
}

function path(
  id: string,
  points: readonly (readonly [number, number, number])[],
  extra: Partial<Pick<FieldSurface, 'edge' | 'ground'>> & { stairs?: boolean; halfWidth?: number },
): FieldSurface {
  return {
    kind: 'path',
    id,
    points,
    halfWidth: extra.halfWidth ?? 7,
    ...(extra.stairs ? { stairs: true } : {}),
    edge: extra.edge ?? 'rock',
    ground: extra.ground ?? 'slate',
  };
}

const bridgeA = towardHeart(8);
const bridgeB = towardHeart(12);
const bridgeC = towardHeart(27);
const bridgeD = towardHeart(32);

const AUTHORED_SURFACES: FieldSurface[] = [
  // --- The Hammer (south): the Cleft, the Gallery, the Quarry ------------------------
  disc('cleft', CLEFT, { edge: 'rock', ground: 'slate' }),
  path(
    'gallery_upper',
    [
      [-192, -214, H.cleft],
      [-188, -215, H.cleft],
      [-160, -223, H.galleryUpper],
      [-155, -224, H.galleryUpper],
    ],
    { ground: 'paving' },
  ),
  disc('gallery_h1', GALLERY_LANDINGS.h1, { edge: 'rock', ground: 'paving' }),
  path(
    'gallery_middle',
    [
      [-144, -227, H.galleryUpper],
      [-139, -228, H.galleryUpper],
      [-108, -231, H.galleryMiddle],
      [-103, -232, H.galleryMiddle],
    ],
    { ground: 'paving' },
  ),
  disc('gallery_h2', GALLERY_LANDINGS.h2, { edge: 'rock', ground: 'paving' }),
  path(
    'gallery_lower',
    [
      [-92, -228, H.galleryMiddle],
      [-88, -225, H.galleryMiddle],
      [-74, -212, H.galleryLower],
      [-70, -209, H.galleryLower],
    ],
    { ground: 'paving' },
  ),
  disc('gallery_h3', GALLERY_LANDINGS.h3, { edge: 'rock', ground: 'paving' }),
  // The quarry's steps, deepest reach first (each later, lower step wins
  // nearer the pit), then the pit's own floor.
  quarryStep(3),
  quarryStep(2),
  quarryStep(1),
  quarryStep(0),
  carvedEllipse('hammer_pit', HAMMER_PIT, 3, 13, { edge: 'rock', ground: 'quarry' }),
  path(
    'pit_descent',
    [
      [-58, -200, H.galleryLower],
      [-54, -197, H.galleryLower],
      [-35, -179, H.pit],
      [-28, -174, H.pit],
    ],
    { stairs: true },
  ),
  // --- The Slab, the Balcony and the Grand Stair --------------------------------------
  path(
    'slab_stair',
    [
      [0, -137, H.pit],
      [0, -132, H.pit],
      [0, -118, H.balcony],
      [0, -110, H.balcony],
    ],
    { stairs: true },
  ),
  rect('balcony', BALCONY, { edge: 'balustrade', ground: 'paving' }),
  path(
    'grand_stair',
    [
      [0, -63, H.balcony],
      [0, GRAND_STAIR.top, H.balcony],
      [0, -23, H.dais],
      [0, -15, H.dais],
    ],
    { stairs: true, edge: 'balustrade', halfWidth: GRAND_STAIR.halfWidth },
  ),
  // --- The Ring, its two stairs and the Seal Dais -------------------------------------
  ringSector(),
  path(
    'north_stair',
    [
      [0, NORTH_STAIR.top + 4, H.ring],
      [0, NORTH_STAIR.top, H.ring],
      [0, NORTH_STAIR.foot + 4, H.dais],
      [0, NORTH_STAIR.foot - 4, H.dais],
    ],
    { stairs: true, edge: 'balustrade', halfWidth: NORTH_STAIR.halfWidth },
  ),
  balconyStair('balcony_stair_east', 172, 142),
  balconyStair('balcony_stair_west', 188, 218),
  disc('seal_dais', SEAL_DAIS, { edge: 'balustrade', ground: 'ritual' }),
  // --- The Breath (north): climbs to the Storm Cornice ---------------------------------
  path(
    'breath_mouth',
    [
      [0, 74, H.ring],
      [0, 80, H.ring],
      [0, 92, H.breathLow],
      [0, 96, H.breathLow],
    ],
    { ground: 'scoured' },
  ),
  disc('breath_b1', BREATH.b1, { edge: 'rock', ground: 'scoured' }),
  path(
    'breath_chimney',
    [
      [-8, 108, H.breathLow],
      [-13, 109, H.breathLow],
      [-50, 112, H.breathMid],
      [-57, 112, H.breathMid],
    ],
    { stairs: true, ground: 'scoured' },
  ),
  disc('breath_b2', BREATH.b2, { edge: 'rock', ground: 'scoured' }),
  path(
    'wind_bridge',
    [
      [-65, 118, H.breathMid],
      [WIND_BRIDGE.fromX, WIND_BRIDGE.fromZ, H.breathMid],
      [WIND_BRIDGE.toX, WIND_BRIDGE.toZ, H.breathHigh],
      [-106, 165, H.breathHigh],
    ],
    { edge: 'balustrade', halfWidth: WIND_BRIDGE.halfWidth, ground: 'scoured' },
  ),
  disc('breath_b3', BREATH.b3, { edge: 'rock', ground: 'scoured' }),
  path(
    'cornice_climb',
    [
      [-108, 176, H.breathHigh],
      [-104, 179, H.breathHigh],
      [-64, 193, H.cornice],
      [-42, 195, H.cornice],
    ],
    { stairs: true, ground: 'scoured' },
  ),
  cornice(),
  // --- The Quench (east): descends to the Quench Basin --------------------------------
  path(
    'quench_mouth',
    [
      [74, 0, H.ring],
      [80, 0, H.ring],
      [98, 0, H.quenchUpper],
      [102, 0, H.quenchUpper],
    ],
    { stairs: true, ground: 'rime' },
  ),
  disc('quench_q1', QUENCH.q1, { edge: 'rock', ground: 'rime' }),
  path(
    'quench_stair',
    [
      [113, -9, H.quenchUpper],
      [115, -13, H.quenchUpper],
      [120, -32, H.quenchMiddle],
      [121, -38, H.quenchMiddle],
    ],
    { stairs: true, ground: 'rime' },
  ),
  disc('quench_q2', QUENCH.q2, { edge: 'rock', ground: 'rime' }),
  path(
    'quench_shelf_stair',
    [
      [127, -56, H.quenchMiddle],
      [130, -60, H.quenchMiddle],
      [141, -75, H.quenchShelf],
      [144, -79, H.quenchShelf],
    ],
    { stairs: true, ground: 'rime' },
  ),
  rect('singing_ice', QUENCH.ice, { edge: 'rock', ground: 'lake_ice' }),
  path(
    'lake_descent',
    [
      [172, -76, H.quenchShelf],
      [175, -72, H.quenchShelf],
      [188, -50, H.lake],
      [190, -44, H.lake],
    ],
    { ground: 'rime' },
  ),
  carvedEllipse('lake_shelf', QUENCH.shelf, 3, 71, { edge: 'rock', ground: 'rime' }),
  carvedEllipse('frozen_lake', QUENCH.lake, 2, 73, { edge: 'rock', ground: 'lake_ice' }, 10),
  // --- The Heat (west): the Hearth, level with the Ring (phase 2I: the
  // mountain's columnar basalt, fire in its joints; ids unchanged) ------------------
  rect('forge_hall', HEAT.hall, { edge: 'rock', ground: 'hearth' }),
  rect('casting_floor', HEAT.floor, { edge: 'rock', ground: 'hearth' }),
  path(
    'anvil_bridge',
    [
      [-160, 0, H.heat],
      [-164, 0, H.heat],
      [-174, 0, H.heat],
      [-178, 0, H.heat],
    ],
    { edge: 'rock', ground: 'hearth' },
  ),
  {
    kind: 'poly',
    id: 'smiths_forge',
    points: FORGE_POINTS,
    h: H.heat,
    edge: 'rock',
    ground: 'hearth',
  },
  // --- The Heart (the separate final room) --------------------------------------------
  disc('heart_terrace', HEART_TERRACE, { edge: 'balustrade', ground: 'slate' }),
  disc('heart_anvil', HEART_ROOM, { edge: 'balustrade', ground: 'ritual' }),
  path(
    'heart_bridge',
    [
      [bridgeA.x, bridgeA.z, H.heartTerrace],
      [bridgeB.x, bridgeB.z, H.heartTerrace],
      [bridgeC.x, bridgeC.z, H.heartRoom],
      [bridgeD.x, bridgeD.z, H.heartRoom],
    ],
    { edge: 'balustrade' },
  ),
];

/** Every path is drawn AFTER the floors it joins (a later surface wins where
 *  two overlap), so a stair's flat end runs owned into its landing and the
 *  landing's disc never cuts the stair's top off into a step. */
const SURFACES: FieldSurface[] = [
  ...AUTHORED_SURFACES.filter((s) => s.kind !== 'path'),
  ...AUTHORED_SURFACES.filter((s) => s.kind === 'path'),
];

/** The surfaces that float over open air (render: a shallow face and a keel
 *  under them instead of a cliff down to the void floor). */
export const SMITH_HEART_FLOATING_SURFACES: readonly string[] = [
  'seal_dais',
  'heart_anvil',
  'heart_terrace',
];

// ---- props (kit placeholders; `r` or `hw`/`hd` add a collider) ----------------------
// Kinds are the renderer's keys (render/smith_heart). Nothing solid stands on
// a walking line, a pack's spot, a gate's span or an arena's middle.

/** A prop at bearing `deg` and radius scale from an ellipse's centre. */
function around(
  c: { x: number; z: number; rx: number; rz: number },
  deg: number,
  out: number,
): { x: number; z: number } {
  const [x, z] = bearingPoint(c.x, c.z, deg, c.rx + out, c.rz + out);
  return { x, z };
}

/** Facing from (x, z) toward (tx, tz) (sim and three yaw: 0 = +z). */
function face(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

const ALTAR_PROPS: FieldProp[] = HEART_ALTARS.map((a) => ({
  kind: `sh_altar_${a.vein}`,
  x: a.x,
  z: a.z,
  rot: face(a.x, a.z, HEART_ROOM.x, HEART_ROOM.z),
  r: 3,
  h: 6,
}));

/** The quarry's five carved columns on a 24 yd circle: the Hammer Council's
 *  starting pillars (encounters/smith_heart/council_pillars.ts), the cover
 *  from Mountain's Wrath. The encounter owns their solid body (it cracks and
 *  falls in the fight and stands whole again on a reset), so the field builds
 *  no collider for them: a live claim publishes each standing one as a combat
 *  wall. Their radius and height are the encounter's pillar shape. */
export const QUARRY_PILLAR_SPOTS: readonly { x: number; z: number; rot: number }[] = [
  20, 92, 164, 236, 308,
].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: HAMMER_PIT.x + Math.sin(a) * 24, z: HAMMER_PIT.z + Math.cos(a) * 24, rot: a };
});
/** A carved column's footprint radius and sight height (yards). */
export const QUARRY_PILLAR_R = 2.6;
export const QUARRY_PILLAR_H = 13;

const PIT_COLUMNS: FieldProp[] = QUARRY_PILLAR_SPOTS.map((p) => ({
  kind: 'sh_pit_column',
  x: p.x,
  z: p.z,
  rot: p.rot,
  r: QUARRY_PILLAR_R,
  h: QUARRY_PILLAR_H,
  encounterOwned: true,
}));

/** How far past the pit's rim the colossi stand: carved out of the terraces
 *  themselves, their knees on the first step, their backs still one with the
 *  steps above, so the whole figure reads from the pit floor's camera. */
export const QUARRY_COLOSSUS_OUT = 12;

/** The four crystal spires on the Seal Dais (bearings, degrees): on the
 *  diagonals, the two southern ones turned a breath off them so the Ring's
 *  two ends (its arc's feet at 138 and 222) see past them to the portal. */
export const RING_SPIRE_BEARINGS = [45, 134, 226, 315] as const;

/** How far out from the Ring's centre the pack spots' cairns stand (on the
 *  walk, against its outer rim). */
export const RING_CAIRN_R = 75.6;
/** How far either side of the Balcony's middle the Hammer's jambs stand
 *  (between the Grand Stair's side and the Balcony's). */
export const HAMMER_JAMB_X = 10.3;

/** The colossi: half-carved giants the Smith left in the quarry's terraces,
 *  kneeling over the pit. */
const QUARRY_COLOSSI: FieldProp[] = [72, 128, 182].map((deg) => {
  const p = around(HAMMER_PIT, deg, QUARRY_COLOSSUS_OUT);
  return {
    kind: 'sh_quarry_colossus',
    ...p,
    rot: face(p.x, p.z, HAMMER_PIT.x, HAMMER_PIT.z),
    r: 7,
    h: 28,
  };
});

/** Cut blocks on the lower steps, and the derrick that lifted them. */
const QUARRY_BLOCKS: FieldProp[] = [
  { deg: 52, out: 10.5 },
  { deg: 100, out: 3.6 },
  { deg: 150, out: 10.5 },
  { deg: 205, out: 17.5 },
].map((b, i) => ({
  kind: 'sh_quarry_block',
  ...around(HAMMER_PIT, b.deg, b.out),
  rot: 0.3 + i * 0.7,
  hw: 2.4,
  hd: 2.4,
  h: 7.4,
}));

/** Blocks fallen onto the Gallery's walk, each by an edge of its path (a
 *  path is 14 yd across: the walking line keeps nine of them clear). */
const GALLERY_FALLEN_BLOCKS: FieldProp[] = [
  { x: -169.9, z: -215.4, rot: -0.27 },
  { x: -128.7, z: -234.0, rot: -0.1 },
  { x: -84.3, z: -215.0, rot: 0.75 },
].map((b) => ({ kind: 'sh_fallen_block', ...b, hw: 1.3, hd: 1.0, h: 1.5 }));

/** The Frozen Lake's braziers on its rock shelf (the Quench form's warmth):
 *  the Smith's carved fire bowls (phase 2H), a body wide each. */
export const LAKE_BRAZIERS: FieldProp[] = [40, 140, 220, 320].map((deg) => {
  const p = around(QUENCH.shelf, deg, -5);
  return { kind: 'sh_brazier', ...p, rot: 0, r: 1.5, h: 2.6 };
});

/** The Smith's four great blades of ice, half-sunk point first in the lake
 *  (great swords twice a body's height and more), round the Guardian of the
 *  Quench's ice: at half health they tear free, stand upright and float in
 *  place, each echoing the guardian's attacks (design doc 7.3). The encounter
 *  owns their bodies (encounters/smith_heart/quench_blades.ts: the claim's
 *  blade objects are combat walls, and the fight's renderer draws them, sunk
 *  or risen), so the field builds no collider and the kit no piece for them.
 *  Order is the blades' index (north-east, south-east, south-west,
 *  north-west). */
export const QUENCH_BLADE_SPOTS: readonly { x: number; z: number; rot: number }[] = [
  { deg: 40, tilt: 0 },
  { deg: 130, tilt: 1 },
  { deg: 220, tilt: 3 },
  { deg: 310, tilt: 4 },
].map((b) => {
  const p = around(QUENCH.lake, b.deg, -16);
  return { ...p, rot: 0.6 + b.tilt * 1.3 };
});
/** A sunk blade's footprint radius and height (yards). */
export const QUENCH_BLADE_R = 1.6;
export const QUENCH_BLADE_H = 12;

const SUNK_BLADES: FieldProp[] = QUENCH_BLADE_SPOTS.map((p) => ({
  kind: 'sh_sunk_blade',
  ...p,
  r: QUENCH_BLADE_R,
  h: QUENCH_BLADE_H,
  encounterOwned: true,
}));

/** The ring of heaved ice the Guardian of the Quench raises round the Frozen
 *  Lake when it wakes (design doc 7.3): `segments` slabs of shore ice on an
 *  ellipse a little inside the lake's ragged edge, each an oriented combat
 *  wall (encounters/smith_heart/quench_rim.ts), so the whole fight stays on
 *  the ice (the shelf's rock never cracks). Instance-local yards. */
export const QUENCH_RIMEWALL = {
  x: QUENCH.lake.x,
  z: QUENCH.lake.z,
  rx: QUENCH.lake.rx - 3,
  rz: QUENCH.lake.rz - 3,
  segments: 28,
  /** A slab's half length along the ring, half thickness, height. */
  hw: 4.4,
  hd: 0.7,
  h: 3.2,
} as const;

/** The basin's steaming vents (flush on the shelf, steam rising). */
const STEAM_VENTS: FieldProp[] = [70, 190, 290].map((deg) => {
  const p = around(QUENCH.shelf, deg, -4);
  return { kind: 'sh_steam_vent', ...p, rot: 0 };
});

/** Frost-cracked standing stones at the Quench's landings' rims (phase 2H),
 *  on colliders, between the walks that leave each landing. */
const FROST_STONES: FieldProp[] = (
  [
    [QUENCH.q1, [30, 100, 215]],
    [QUENCH.q2, [70, 245]],
  ] as const
).flatMap(([c, degs]) =>
  degs.map((deg) => {
    const p = around({ x: c.x, z: c.z, rx: c.r, rz: c.r }, deg, -2.4);
    return { kind: 'sh_frost_stone', ...p, rot: 0, r: 1.6, h: 6 };
  }),
);

/** The ice shelves: tilted slabs of old ice heaped past the basin's rim. */
const ICE_SHELVES: FieldProp[] = [10, 60, 110, 300, 345].map((deg, i) => {
  const p = around(QUENCH.shelf, deg, 9);
  return {
    kind: 'sh_ice_shelf',
    ...p,
    rot: face(p.x, p.z, QUENCH.lake.x, QUENCH.lake.z) + i * 0.2,
  };
});

/** The Storm Cornice's lightning rods, on the rim between the wind channels. */
const LIGHTNING_RODS: FieldProp[] = [0, 50, 104, 155, 210, 305].map((deg) => {
  const p = around(BREATH.cornice, deg, -5);
  return { kind: 'sh_lightning_rod', ...p, rot: 0, r: 1.3, h: 24 };
});

/** The wind channels' cheek stones (phase 2G): two flanking each notch's
 *  mouth on the Cornice's rim, on colliders, clear of the walk to it. */
const CHANNEL_JAMBS: FieldProp[] = CORNICE_CHANNELS.flatMap((ch) =>
  [-1, 1].map((s) => {
    const p = around(BREATH.cornice, ch.deg + s * (ch.halfDeg + 2.5), -2.4);
    return { kind: 'sh_channel_jamb', ...p, rot: 0, r: 1.3, h: 9 };
  }),
);

/** Wind-carved standing stones at the Breath's landings' rims (phase 2G), on
 *  colliders, between the walks that leave each landing. */
const STORM_STONES: FieldProp[] = (
  [
    [BREATH.b1, [62, 138]],
    [BREATH.b2, [160, 232]],
    [BREATH.b3, [250, 302]],
  ] as const
).flatMap(([c, degs]) =>
  degs.map((deg) => {
    const p = around({ x: c.x, z: c.z, rx: c.r, rz: c.r }, deg, -2.4);
    return { kind: 'sh_storm_stone', ...p, rot: 0, r: 1.6, h: 8 };
  }),
);

const PROPS: FieldProp[] = [
  // The Cleft: the crack's mouth behind the landing (render only), its
  // doorway's steps starting just past the landing's lip.
  { kind: 'sh_cleft_mouth', x: -213.4, z: -224.7, rot: 0.88 },
  // The Hammer Gallery: the Smith's half-carved mountain statues on the rims.
  { kind: 'sh_rough_statue', x: -150, z: -240, rot: 0, r: 3.2, h: 14 },
  { kind: 'sh_rough_statue', x: -96, z: -218, rot: Math.PI, r: 3.2, h: 14 },
  { kind: 'sh_rough_statue', x: -78, z: -198, rot: 2.2, r: 3.2, h: 14 },
  { kind: 'sh_geode', x: -140, z: -216, rot: 0.4, r: 2, h: 4 },
  { kind: 'sh_geode', x: -90, z: -242, rot: 1.9, r: 2, h: 4 },
  // Blocks fallen from the Smith's work onto the Gallery's walk (phase 2E),
  // at its edges, clear of its walking line and the packs' landings.
  ...GALLERY_FALLEN_BLOCKS,
  // The Smith's Quarry: columns, colossi, cut blocks, ochre geodes.
  ...PIT_COLUMNS,
  ...QUARRY_COLOSSI,
  ...QUARRY_BLOCKS,
  { kind: 'sh_quarry_derrick', ...around(HAMMER_PIT, 160, 17.5), rot: 0.4, r: 2.6, h: 18 },
  { kind: 'sh_geode', ...around(HAMMER_PIT, 75, 3.5), rot: 0.8, r: 2, h: 4 },
  { kind: 'sh_geode', ...around(HAMMER_PIT, 118, 10.5), rot: 2.4, r: 2, h: 4 },
  { kind: 'sh_geode', ...around(HAMMER_PIT, 196, 3.5), rot: 4.1, r: 2, h: 4 },
  { kind: 'sh_geode', ...around(HAMMER_PIT, 300, -4), rot: 5.2, r: 2, h: 4 },
  // The Slab's broken halves lie either side of the stair once it falls.
  { kind: 'sh_slab_frame', x: SLAB.x, z: SLAB.z, rot: 0 },
  // The Ring: standing stones on the outer rim, between the pack spots, a
  // crystal lamp in each one's head (none on the east Balcony Stair: phase
  // 2F, it stood on the stair's edge).
  ...[0, 45, 90, 225, 270, 315].map((deg) => {
    const p = ringPoint(deg + 22.5, RING.outerR - 1.5);
    return { kind: 'sh_ring_pillar', x: p.x, z: p.z, rot: 0, r: 1.2, h: 12 };
  }),
  // The Ring's pack spots made places (phase 2F): a cairn at the rim behind
  // each pack, a fallen block or a toppled stone with a crystal lamp.
  ...RING_PACK_DEGREES.map((deg, i) => {
    const p = ringPoint(deg + 3, RING_CAIRN_R);
    return {
      kind: 'sh_ring_cairn',
      x: p.x,
      z: p.z,
      rot: face(p.x, p.z, RING.x, RING.z) + (i % 2 ? 0.5 : -0.35),
      r: 2,
      h: 2.2,
    };
  }),
  // The Hammer's mouth on the Ring side: two standing stones flanking the
  // Grand Stair's head at the Balcony's tip (phase 2F), clear of the stair.
  ...[-1, 1].map((s) => ({
    kind: 'sh_hammer_jamb',
    x: s * HAMMER_JAMB_X,
    z: BALCONY.z1 - 2.5,
    rot: s < 0 ? 0 : Math.PI,
    r: 1.5,
    h: 10,
  })),
  // The Seal Dais: the four crystal spires of the portal's crown, on the
  // diagonals (clear of the four rivers and the two stairs), each lighting
  // with its vein.
  ...RING_SPIRE_BEARINGS.map((deg) => {
    const p = ringPoint(deg, 15.5);
    return { kind: 'sh_portal_tine', x: p.x, z: p.z, rot: (deg * Math.PI) / 180, r: 1.6, h: 16 };
  }),
  { kind: 'sh_heart_seal', x: HEART_SEAL.x, z: HEART_SEAL.z, rot: 0 },
  // The Breath: wind shelters on the bridge's windward edge (phase 2 gusts
  // push the raid against them, never off the arch), the cornice's lightning
  // rods and its broken bellows.
  { kind: 'sh_wind_shelter', x: -80, z: 140, rot: -0.75, hw: 2.4, hd: 0.7, h: 2 },
  { kind: 'sh_wind_shelter', x: -91, z: 152, rot: -0.75, hw: 2.4, hd: 0.7, h: 2 },
  ...LIGHTNING_RODS,
  ...CHANNEL_JAMBS,
  ...STORM_STONES,
  {
    kind: 'sh_broken_bellows',
    ...around(BREATH.cornice, 240, -12),
    rot: 0.5,
    hw: 4.4,
    hd: 7.5,
    h: 7,
  },
  {
    kind: 'sh_broken_bellows',
    ...around(BREATH.cornice, 108, -13),
    rot: 2.1,
    hw: 4.4,
    hd: 7.5,
    h: 7,
  },
  // The Quench: the basin's braziers, vents, sunk blades and ice shelves.
  ...LAKE_BRAZIERS,
  ...STEAM_VENTS,
  ...SUNK_BLADES,
  ...ICE_SHELVES,
  ...FROST_STONES,
  { kind: 'sh_ice_blade', x: 150, z: -78, rot: 0.3, r: 0.8, h: 4 },
  { kind: 'sh_ice_blade', x: 170, z: -96, rot: 1.2, r: 0.8, h: 4 },
  // The Heat (the Hearth, phase 2I; the kinds keep their forge names): the
  // crystal clusters (`sh_crucible`), the wellspring (`sh_pour_crucible`),
  // the Hearth's mouth, its ember boulders (`sh_great_bellows`), the
  // altar-stone (`sh_giant_anvil`), the seams of fire (`sh_casting_channel`).
  { kind: 'sh_crucible', x: -100, z: 11, rot: 0, r: 2.4, h: 6 },
  { kind: 'sh_crucible', x: -100, z: -11, rot: 0, r: 2.4, h: 6 },
  { kind: 'sh_pour_crucible', x: POUR_CHANNEL.x, z: 31, rot: Math.PI, r: 3, h: 10 },
  { kind: 'sh_great_hearth', x: GREAT_HEARTH.x, z: GREAT_HEARTH.z, rot: Math.PI / 2 },
  {
    kind: 'sh_great_bellows',
    x: -243,
    z: 30,
    rot: face(-243, 30, GREAT_HEARTH.x, 8),
    hw: 4,
    hd: 6.5,
    h: 6,
  },
  {
    kind: 'sh_great_bellows',
    x: -243,
    z: -30,
    rot: face(-243, -30, GREAT_HEARTH.x, -8),
    hw: 4,
    hd: 6.5,
    h: 6,
  },
  {
    kind: 'sh_giant_anvil',
    x: GIANT_ANVIL.x,
    z: GIANT_ANVIL.z,
    rot: 0,
    hw: GIANT_ANVIL.hw,
    hd: GIANT_ANVIL.hd,
    h: GIANT_ANVIL.h,
  },
  { kind: 'sh_crucible', x: -196, z: 38, rot: 0, r: 2.4, h: 6 },
  { kind: 'sh_crucible', x: -196, z: -38, rot: 0, r: 2.4, h: 6 },
  { kind: 'sh_crucible', x: -226, z: 39, rot: 0, r: 2.4, h: 6 },
  { kind: 'sh_crucible', x: -226, z: -39, rot: 0, r: 2.4, h: 6 },
  { kind: 'sh_casting_channel', x: -222, z: 16, rot: Math.PI / 2 },
  { kind: 'sh_casting_channel', x: -222, z: -16, rot: Math.PI / 2 },
  // The Heart: the four altars, each under its chain.
  ...ALTAR_PROPS,
];

export const SMITH_HEART_FIELD: AuthoredFieldDef = {
  key: 'smith_heart',
  bounds: { minX: -258, maxX: 248, minZ: -246, maxZ: 238 },
  voidHeight: SMITH_HEART_VOID_HEIGHT,
  cliffStep: 1.1,
  lipOpenings: CORNICE_GAPS.map(({ x, z, r }) => ({ x, z, r })),
  mapVoid: 'mist',
  surfaces: SURFACES,
  walls: [],
  props: PROPS,
  lightZones: [
    { id: 'cleft', x: -150, z: -222, r: 68, key: 0xc8c0b0, accent: 0xc8903c, fog: 0x5a5448 },
    { id: 'pit', x: 8, z: -172, r: 60, key: 0xc8bca8, accent: 0xc8903c, fog: 0x584e40 },
    { id: 'balcony', x: 0, z: -86, r: 26, key: 0xc4c8d8, accent: 0xc8903c, fog: 0x4c5468 },
    { id: 'ring', x: 0, z: 0, r: 85, key: 0xbcc4d8, accent: 0xd8c8a0, fog: 0x485068 },
    { id: 'breath', x: -60, z: 140, r: 70, key: 0xbcd0ec, accent: 0x5ab8e8, fog: 0x4a6080 },
    { id: 'cornice', x: 0, z: 196, r: 58, key: 0xbcd0ec, accent: 0x5ab8e8, fog: 0x4a6080 },
    { id: 'quench', x: 140, z: -50, r: 60, key: 0xc0d8f0, accent: 0x9ad8ff, fog: 0x4c6888 },
    { id: 'lake', x: 198, z: -2, r: 58, key: 0xc0d8f0, accent: 0x9ad8ff, fog: 0x4c6888 },
    { id: 'heat', x: -130, z: 0, r: 52, key: 0xe0d4bc, accent: 0xffe6a0, fog: 0x6a6050 },
    { id: 'forge', x: -214, z: 0, r: 58, key: 0xe0d4bc, accent: 0xffe6a0, fog: 0x6a6050 },
    { id: 'heart', x: 175, z: 158, r: 95, key: 0xd8c0a8, accent: 0xffd8a0, fog: 0x2a1c24 },
  ],
};
