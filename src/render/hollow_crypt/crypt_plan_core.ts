// Pure dressing plan for the Hollow Crypt's open-air necropolis: where the
// soul-wisp rivers flow, where the lanterns and braziers burn, where the moon
// shafts fall, the distant crag ring that closes the vista, the balustrades and
// merlons that dress the generated cliff edges, and the gate reveal curve.
// Everything is derived from the sim layout (content/hollow_crypt_layout.ts)
// and its cliff runs, so moving a terrace moves its dressing with it.
//
// Three-free, DOM-free, deterministic (hash-seeded, never Math.random).

import { HOLLOW_CRYPT_FIELD, HOLLOW_CRYPT_RING } from '../../sim/content/hollow_crypt_layout';
import {
  authoredFieldCliffRuns,
  authoredFieldHeight,
  type FieldCliffRun,
} from '../../sim/instances/authored_field';

export type Vec3 = readonly [number, number, number];

function hash(i: number, salt: number): number {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

const ground = (x: number, z: number): number => authoredFieldHeight(HOLLOW_CRYPT_FIELD, x, z);

// ---- soul-wisp rivers --------------------------------------------------------

/** Every river flows from a place of the dead toward the Rite Ring and up the
 *  column: the finale is the one direction the whole necropolis leans. */
export interface WispRiver {
  id: string;
  points: Vec3[];
  /** Particles on this river at the full tier. */
  count: number;
}

function river(
  id: string,
  pts: readonly (readonly [number, number, number])[],
  count: number,
): WispRiver {
  // Each control point hovers `lift` yards over the ground beneath it.
  return { id, count, points: pts.map(([x, z, lift]) => [x, ground(x, z) + lift, z] as Vec3) };
}

export const HOLLOW_CRYPT_WISP_RIVERS: readonly WispRiver[] = [
  river(
    'cloister',
    [
      [0, -30, 11],
      [0, -2, 9],
      [0, 40, 8],
      [0, 90, 9],
      [0, 140, 16],
      [0, 175, 26],
      [0, 205, 36],
    ],
    90,
  ),
  river(
    'yard',
    [
      [-82, 40, 4],
      [-82, 80, 6],
      [-80, 116, 9],
      [-50, 140, 18],
      [-20, 180, 30],
      [0, 205, 40],
    ],
    70,
  ),
  river(
    'gallery',
    [
      [76, 40, 5],
      [80, 80, 5],
      [80, 112, 8],
      [50, 150, 20],
      [22, 185, 32],
      [0, 205, 42],
    ],
    70,
  ),
  river(
    'stair',
    [
      [43, 161, 4],
      [64, 180, 8],
      [66, 210, 12],
      [40, 238, 18],
      [8, 222, 28],
      [0, 205, 44],
    ],
    50,
  ),
];

/** A point on a river at s in [0, 1) (piecewise linear by length). */
export function riverPointAt(r: WispRiver, s: number): Vec3 {
  const pts = r.points;
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(
      pts[i + 1][0] - pts[i][0],
      pts[i + 1][1] - pts[i][1],
      pts[i + 1][2] - pts[i][2],
    );
    lens.push(l);
    total += l;
  }
  let d = (((s % 1) + 1) % 1) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const t = lens[i] > 0 ? Math.min(1, d / lens[i]) : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
        pts[i][2] + (pts[i + 1][2] - pts[i][2]) * t,
      ];
    }
    d -= lens[i];
  }
  return pts[pts.length - 1];
}

/** Resample a river into `n` evenly spaced points (the shader's control table). */
export function resampleRiver(r: WispRiver, n: number): Vec3[] {
  return Array.from({ length: n }, (_, i) => riverPointAt(r, i / (n - 1)));
}

// ---- lights -------------------------------------------------------------------------

export type CryptLightKind =
  | 'lantern'
  | 'brazier'
  | 'frost'
  | 'violet'
  | 'organ'
  | 'soul'
  | 'candle';

/** The kit pieces that carry a flame or a glow, and where it burns in the
 *  piece's own frame (x, y, z: glTF axes, front +Z). Taken from the Blender
 *  builders (docs/design/dungeon-rework/kit/build_hollow_crypt_kit.py). */
export const KIT_FLAME_SOCKETS: Readonly<Record<string, readonly [number, number, number]>> = {
  // The lantern cage hangs off the arm, 0.9 in front of the post.
  Kit_LanternPost: [0, 3.05, 0.9],
  // The coal bowl of the standing brazier.
  Kit_Brazier: [0, 1.42, 0],
  // The candle niche on the shrine pillar's front face.
  Kit_ShrinePillar: [0, 4.05, 1.0],
  // The ring of tallow candles on the ossuary monument's lowest step.
  Kit_OssuaryMonument: [0, 1.55, -4.0],
  // The wick of a Remembrance Candle.
  Kit_RemembranceCandle: [0, 4.4, 0],
  // The glowing clutch inside an egg cluster, and the Great Web's frost heart.
  Kit_EggCluster: [0, 0.7, 0],
  Kit_GreatWeb: [0, 11, 0],
  // The violet throat of the Bone Organ.
  Kit_BoneOrgan: [0, 6.4, 0],
};

export interface CryptLightSpot {
  kind: CryptLightKind;
  /** The kit piece that carries this light (see KIT_FLAME_SOCKETS); `null`
   *  only for the soul column, whose light has no drawn source. */
  holder: string | null;
  /** Where the holder stands and its yaw (instance-local). */
  x: number;
  z: number;
  rot: number;
  /** The holder is placed by the light plan itself (a brazier or a lantern
   *  post that exists for this light); else it is already a sim prop or set
   *  dressing at exactly (x, z, rot). */
  places: boolean;
  /** For a holderless light: its height above the ground. */
  lift?: number;
}

const H = (
  kind: CryptLightKind,
  holder: string,
  x: number,
  z: number,
  rot = 0,
  places = true,
): CryptLightSpot => ({ kind, holder, x, z, rot, places });

/** Warm tallow lights are the "living" light; violet, frost and soul-green
 *  belong to the enemy's magic. At most eight per light zone. Every flame burns
 *  in a holder that stands on the floor (never a flame in mid-air). */
export const HOLLOW_CRYPT_LIGHTS: readonly CryptLightSpot[] = [
  // Lychgate Landing: two standing braziers flank the first vista.
  H('brazier', 'Kit_Brazier', -9, -118),
  H('brazier', 'Kit_Brazier', 9, -118),
  // Chapel Stair foot and the cloister arcade lantern posts.
  H('lantern', 'Kit_LanternPost', -11, -77),
  H('lantern', 'Kit_LanternPost', 11, -77),
  H('lantern', 'Kit_LanternPost', -33, -40, Math.PI / 2),
  H('lantern', 'Kit_LanternPost', 33, -40, -Math.PI / 2),
  // The candles on the ossuary monument's step, on the side facing the stair.
  H('candle', 'Kit_OssuaryMonument', 0, -30, 0, false),
  H('lantern', 'Kit_LanternPost', -12, 15, Math.PI),
  H('lantern', 'Kit_LanternPost', 12, 15, Math.PI),
  // The Processional: the candle niches of the shrine pillars (sim props,
  // turned to face the aisle).
  H('candle', 'Kit_ShrinePillar', -22, 30, Math.PI / 2, false),
  H('candle', 'Kit_ShrinePillar', 22, 30, -Math.PI / 2, false),
  H('candle', 'Kit_ShrinePillar', -22, 84, Math.PI / 2, false),
  H('candle', 'Kit_ShrinePillar', 22, 84, -Math.PI / 2, false),
  // Sexton's Yard lanterns (their posts are sim props).
  H('lantern', 'Kit_LanternPost', -58, 34, 0, false),
  H('lantern', 'Kit_LanternPost', -72, 70, 0, false),
  H('lantern', 'Kit_LanternPost', -92, 20, 0, false),
  H('lantern', 'Kit_LanternPost', -70, 100, 0, false),
  H('lantern', 'Kit_LanternPost', -94, 100, 0, false),
  // Widow's Gallery: the glowing egg clutches and the Great Web's frost heart.
  H('frost', 'Kit_EggCluster', 58, 40, 0.5, false),
  H('frost', 'Kit_EggCluster', 92, 54, 2.2, false),
  H('frost', 'Kit_GreatWeb', 80, 133, Math.PI, false),
  // Choir Ruin: violet braziers on the loft and the organ's violet throat.
  H('violet', 'Kit_Brazier', -26, 166),
  H('violet', 'Kit_Brazier', 26, 166),
  H('organ', 'Kit_BoneOrgan', 0, 170, Math.PI, false),
  // The Rite Ring: the soul column and the four Remembrance Candles.
  { kind: 'soul', holder: null, x: 0, z: 205, rot: 0, places: false, lift: 8 },
  H('candle', 'Kit_RemembranceCandle', 0, 225, 0, false),
  H('candle', 'Kit_RemembranceCandle', 20, 205, 0, false),
  H('candle', 'Kit_RemembranceCandle', 0, 185, 0, false),
  H('candle', 'Kit_RemembranceCandle', -20, 205, 0, false),
];

/** Kinds that draw a flame cone (the rest glow as a halo in their holder). */
export const CRYPT_FLAME_KINDS: ReadonlySet<CryptLightKind> = new Set([
  'lantern',
  'brazier',
  'candle',
  'violet',
]);

/**
 * Where a light burns (instance-local): its holder's socket turned by the
 * holder's yaw, over the floor under the holder. Holderless lights (the soul
 * column) hang `lift` over the floor.
 */
export function lightFlamePosition(
  spot: CryptLightSpot,
  floor: (x: number, z: number) => number = ground,
): Vec3 {
  const base = floor(spot.x, spot.z);
  if (!spot.holder) return [spot.x, base + (spot.lift ?? 0), spot.z];
  const [sx, sy, sz] = KIT_FLAME_SOCKETS[spot.holder];
  const c = Math.cos(spot.rot);
  const s = Math.sin(spot.rot);
  // three.js yaw: x' = x cos + z sin, z' = -x sin + z cos.
  return [spot.x + sx * c + sz * s, base + sy, spot.z - sx * s + sz * c];
}

export const CRYPT_LIGHT_STYLE: Readonly<
  Record<CryptLightKind, { color: number; flame: number; intensity: number; range: number }>
> = {
  lantern: { color: 0xffa24a, flame: 0xffc070, intensity: 14, range: 22 },
  brazier: { color: 0xff8c3a, flame: 0xffb050, intensity: 22, range: 28 },
  candle: { color: 0xffb561, flame: 0xffd28a, intensity: 8, range: 14 },
  frost: { color: 0x9fd4ff, flame: 0xcfe9ff, intensity: 16, range: 26 },
  violet: { color: 0xa66bff, flame: 0xd2a8ff, intensity: 18, range: 24 },
  organ: { color: 0xa66bff, flame: 0xd2a8ff, intensity: 18, range: 24 },
  soul: { color: 0x6fd6a8, flame: 0xb8ffe0, intensity: 40, range: 48 },
};

// ---- particle emitters --------------------------------------------------------------

export type CryptEmitterKind = 'ember' | 'soul' | 'frost' | 'boneDust' | 'violet' | 'graveDust';

export interface CryptEmitter {
  kind: CryptEmitterKind;
  x: number;
  z: number;
  /** Base height above the ground under (x, z). */
  lift: number;
  radius: number;
  /** Particles at the full tier. */
  count: number;
}

const E = (
  kind: CryptEmitterKind,
  x: number,
  z: number,
  lift: number,
  radius: number,
  count: number,
): CryptEmitter => ({
  kind,
  x,
  z,
  lift,
  radius,
  count,
});

/** The living air of each space, and the presence of each boss's arena. */
export const HOLLOW_CRYPT_EMITTERS: readonly CryptEmitter[] = [
  // Brazier embers at the landing and the tallow lanterns' sparks.
  E('ember', -9, -118, 2.2, 0.6, 26),
  E('ember', 9, -118, 2.2, 0.6, 26),
  // The ossuary monument's candles breathe a little soul-light.
  E('soul', 0, -30, 6, 4, 30),
  // Bone dust drifting across the Sexton's Yard, grave dust whirling in the
  // Bell Yard around Sexton Marrow.
  E('boneDust', -82, 50, 1, 26, 70),
  E('graveDust', -82, 116, 0.5, 15, 60),
  // Frost glitter in the gallery ravine and over the Great Web.
  E('frost', 76, 50, 0.5, 22, 90),
  E('frost', 80, 116, 1, 16, 70),
  // Violet notes rising from the Bone Organ over Cantor Ilvane's loft.
  E('violet', 0, 168, 4, 8, 60),
  // The soul spiral round Morthen's altar, feeding the column.
  E('soul', 0, 205, 1, 7, 110),
];

export const CRYPT_EMITTER_STYLE: Readonly<
  Record<
    CryptEmitterKind,
    { color: number; rise: number; life: number; size: number; swirl: number }
  >
> = {
  ember: { color: 0xffa040, rise: 4.5, life: 2.2, size: 0.9, swirl: 0.4 },
  soul: { color: 0x7ff2c2, rise: 16, life: 6, size: 1.6, swirl: 1.4 },
  frost: { color: 0xd8f0ff, rise: 1.2, life: 5, size: 0.8, swirl: 0.3 },
  boneDust: { color: 0xd9d0bc, rise: 2, life: 9, size: 1.1, swirl: 0.6 },
  violet: { color: 0xb88cff, rise: 9, life: 4.5, size: 1.4, swirl: 0.8 },
  graveDust: { color: 0xa89878, rise: 3, life: 6, size: 1.3, swirl: 1.8 },
};

// ---- the distant crag ring -------------------------------------------------------------

export interface BackdropSpire {
  x: number;
  z: number;
  radius: number;
  height: number;
  /** Base depth (below the mist) and a per-spire noise seed. */
  base: number;
  seed: number;
}

/** A ring of black crags around the necropolis, far past the walkable edge,
 *  tall enough to break the horizon and close the vista. */
export function planBackdropSpires(count = 34): BackdropSpire[] {
  const cx = 0;
  const cz = 60;
  const out: BackdropSpire[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + hash(i, 1) * 0.12;
    const dist = 360 + hash(i, 2) * 200;
    // Leave the moon's quarter (north-north-west) lower so it rises clear.
    const moonward = Math.cos(a - Math.atan2(-0.32, 0.83));
    const height = (60 + hash(i, 3) * 110) * (moonward > 0.85 ? 0.5 : 1);
    out.push({
      x: cx + Math.sin(a) * dist,
      z: cz + Math.cos(a) * dist,
      radius: 34 + hash(i, 4) * 46,
      height,
      base: -90,
      seed: i,
    });
  }
  return out;
}

// ---- edge dressing ---------------------------------------------------------------------

export interface EdgeDressing {
  kind: 'balustrade' | 'merlon' | 'boneRail' | 'rubble';
  x: number;
  z: number;
  /** Ground height under the piece's centre, on the high side of the lip. */
  y: number;
  /** Yaw so the piece runs along the edge (three.js rotation.y). */
  rot: number;
  length: number;
  /** Stretch along local X so the piece's full extent spans exactly `length`. */
  stretch: number;
  /**
   * Rise per yard along the piece's local +X: on a ramp or stair the rail is
   * SHEARED (never tilted) so its plinth follows the incline while every post
   * and baluster stays plumb. Zero on a flat terrace.
   */
  shear: number;
}

/** How far inside the lip each kind stands: its half depth, so the outer face
 *  is flush with the lip and nothing overhangs the chasm (the cliff collider is
 *  0.45 thick). Loose rubble sits well back from the drop. */
const EDGE_INSET: Readonly<Record<EdgeDressing['kind'], number>> = {
  balustrade: 0.4,
  merlon: 0.42,
  boneRail: 0.2,
  rubble: 0.9,
};
/** Half the piece's length along its local X at stretch 1 (the Kit_* extents),
 *  so a run's end piece ends AT the run's end, never past a corner. */
const EDGE_HALF_LENGTH: Readonly<Record<EdgeDressing['kind'], number>> = {
  balustrade: 2.28,
  merlon: 2.0,
  boneRail: 2.11,
  rubble: 1.9,
};
/** The floor under a piece is read this far further in, clear of the lip itself. */
const EDGE_PROBE = 0.35;

/** Rise per yard from the floor at a piece's centre and its two ends. An end
 *  that falls off the run (past a corner, into the chasm) is ignored, so a
 *  corner piece takes its slope from the end still on its own surface. */
export function edgeShear(y: number, yMinus: number, yPlus: number, half: number): number {
  const okMinus = Math.abs(yMinus - y) <= half * 1.2;
  const okPlus = Math.abs(yPlus - y) <= half * 1.2;
  if (okMinus && okPlus) return (yPlus - yMinus) / (2 * half);
  if (okPlus) return (yPlus - y) / half;
  if (okMinus) return (y - yMinus) / half;
  return 0;
}

/**
 * Pieces along every cliff edge that drops into the chasm: carved balustrade
 * or bone rails where a surface asks for them, crenellations on masonry, and
 * loose rubble on raw rock. Placed on the high side, just inside the wall
 * collider, so they read as the lip of the terrace.
 *
 * Every piece reads the REAL floor under its own two ends (a ramp's run is one
 * straight edge whose height changes along it), so on a stair or a sloped
 * bridge each segment sits on the incline instead of floating off its low end
 * or sinking into its high end.
 */
export function planEdgeDressing(segment = 4): EdgeDressing[] {
  const out: EdgeDressing[] = [];
  let k = 0;
  const hidden = new Set(HOLLOW_CRYPT_FIELD.surfaces.filter((s) => s.hidden).map((s) => s.id));
  for (const run of authoredFieldCliffRuns(HOLLOW_CRYPT_FIELD)) {
    const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
    if (len < 1.5 || hidden.has(run.surface)) continue;
    const pieces = Math.max(1, Math.round(len / segment));
    const step = len / pieces;
    const kind: EdgeDressing['kind'] =
      run.style === 'balustrade'
        ? 'balustrade'
        : run.style === 'bone'
          ? 'boneRail'
          : run.style === 'masonry'
            ? 'merlon'
            : 'rubble';
    for (let i = 0; i < pieces; i++) {
      k++;
      if (kind === 'rubble' && hash(k, 7) < 0.55) continue;
      fitEdgePieces(run, kind, step * i, step * (i + 1), 0, out);
    }
  }
  return out;
}

/** Half the piece's depth across the lip (the Kit_* extents on local Z). */
const EDGE_HALF_DEPTH: Readonly<Record<EdgeDressing['kind'], number>> = {
  balustrade: 0.45,
  merlon: 0.46,
  boneRail: 0.18,
  rubble: 0.77,
};

/** How far a plinth may miss the floor under it before the piece is refitted. */
const EDGE_FIT = 0.2;

/** The piece covering [s0, s1] of a run (yards along it), or null. */
function edgePiece(
  run: FieldCliffRun,
  kind: EdgeDressing['kind'],
  s0: number,
  s1: number,
): EdgeDressing {
  const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
  const ux = (run.bx - run.ax) / len;
  const uz = (run.bz - run.az) / len;
  const inset = EDGE_INSET[kind];
  const mid = (s0 + s1) / 2;
  const x = run.ax + ux * mid - run.nx * inset;
  const z = run.az + uz * mid - run.nz * inset;
  // The piece's outer (chasm) face is its local +Z: turn it toward the drop.
  const rot = Math.atan2(run.nx, run.nz);
  // Local +X in world after that yaw (three.js: x' = x cos, z' = -x sin).
  const lx = Math.cos(rot);
  const lz = -Math.sin(rot);
  const length = s1 - s0;
  // The floor under the piece, read just inside it at its centre and near its
  // two ends along its own local X.
  const px = x - run.nx * EDGE_PROBE;
  const pz = z - run.nz * EDGE_PROBE;
  const y = ground(px, pz);
  const half = Math.max(0.4, length / 2 - 0.3);
  const shear = edgeShear(
    y,
    ground(px - lx * half, pz - lz * half),
    ground(px + lx * half, pz + lz * half),
    half,
  );
  return {
    kind,
    x,
    z,
    y,
    rot,
    length,
    stretch: length / (2 * EDGE_HALF_LENGTH[kind]),
    shear: Math.abs(shear) < 1e-9 ? 0 : shear,
  };
}

/** Which ends of a piece miss the floor: bit 1 the run-start end, bit 2 the
 *  run-end end (0 when the whole footprint sits on its sheared plinth). */
function edgeMisfit(run: FieldCliffRun, e: EdgeDressing, s0: number, s1: number): number {
  const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
  const ux = (run.bx - run.ax) / len;
  const uz = (run.bz - run.az) / len;
  const lx = Math.cos(e.rot);
  const lz = -Math.sin(e.rot);
  const inset = EDGE_INSET[e.kind];
  const depth = EDGE_HALF_DEPTH[e.kind];
  let bad = 0;
  const ends: [number, number][] = [
    [s0 + 0.12, 1],
    [(s0 + s1) / 2, 3],
    [s1 - 0.12, 2],
  ];
  for (const [s, bit] of ends) {
    // Just inside the outer face and just inside the inner face.
    for (const back of [Math.max(0.05, inset - depth) + 0.1, inset + depth - 0.1]) {
      const wx = run.ax + ux * s - run.nx * back;
      const wz = run.az + uz * s - run.nz * back;
      const f = ground(wx, wz);
      const along = (wx - e.x) * lx + (wz - e.z) * lz;
      if (
        f <= HOLLOW_CRYPT_FIELD.voidHeight + 1e-6 ||
        Math.abs(f - (e.y + e.shear * along)) > EDGE_FIT
      )
        bad |= bit;
    }
  }
  return bad;
}

/**
 * Fit pieces over [s0, s1] of a run: a piece whose footprint leaves its floor
 * (past a corner, over a kink where a ramp meets a terrace) is trimmed from the
 * failing end, then split in two, so no rail overhangs a drop or floats off a
 * ramp. Pieces shorter than a yard are dropped.
 */
function fitEdgePieces(
  run: FieldCliffRun,
  kind: EdgeDressing['kind'],
  s0: number,
  s1: number,
  depth: number,
  out: EdgeDressing[],
): void {
  let a = s0;
  let b = s1;
  while (b - a >= 1.2) {
    const e = edgePiece(run, kind, a, b);
    const bad = edgeMisfit(run, e, a, b);
    if (bad === 0) {
      out.push(e);
      return;
    }
    if (bad === 3 || (bad & 1 && bad & 2)) break;
    if (bad & 1) a += 0.25;
    if (bad & 2) b -= 0.25;
  }
  if (depth < 2 && s1 - s0 >= 2.4) {
    const m = (s0 + s1) / 2;
    fitEdgePieces(run, kind, s0, m, depth + 1, out);
    fitEdgePieces(run, kind, m, s1, depth + 1, out);
  }
}

// ---- gate reveal curve -------------------------------------------------------------------

/** Seconds a gate takes to open (or seal) on screen. */
export const GATE_REVEAL_SECONDS = 2.6;

/**
 * Openness in [0, 1] of a gate `elapsed` seconds after its state changed from
 * `from` openness to `to`: a heavy ease (slow start, a settle at the end) so a
 * portcullis grinds up, a bridge knits bone by bone, a ward shatters.
 */
export function gateOpenness(from: number, to: number, elapsed: number): number {
  const t = Math.max(0, Math.min(1, elapsed / GATE_REVEAL_SECONDS));
  const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  return from + (to - from) * ease;
}

/** The ring the Remembrance Candles and alcoves stand on (render helpers). */
export const RITE_RING = HOLLOW_CRYPT_RING;
