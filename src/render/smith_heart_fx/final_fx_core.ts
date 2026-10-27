// Pure plan of the Masterless Strength's body and its effects (final_fx.ts
// paints them; docs/design/raid/smith_heart.md sections 5.17 and 7.5). The
// owner's approved design (DECISIONES_DISENO.md, "jefe final"): the boss is
// the mountain's HEART, a great crystal with the four veins beating inside,
// and when the raid first arrives in the room the heart rises out of the
// chasm and tears rocks out of the room, which lift, spin and lock together
// into the colossus's body, the veins' light stitching the pieces. The fight
// is always with the whole body: a colossus of floating mountain, far bigger
// than a player. When it dies the body crumbles, the rocks fall over the
// room and the heart goes dark.
//
// Presentation only: the sim's numbers (Forge Fist's arc and reach, Forge
// Wrath's radius and bar, Forge Pour's cone, range and bar) are read here,
// never changed, and the arrival is a timeline from the moment the heart
// woke (the seal markers' arrival bit, heart_seal_core.ts `awakeSince`),
// never a sim state of its own. The body is the Heart kit's rock pieces and
// its crystal (heart_pieces.py `Kit_Col*`, `Kit_HeartCrystal`) until the
// final creature model replaces it: everything here speaks of joints and
// slots, so a skinned model can take the same timeline.
//
// Frames: the body's frame is the boss's own (origin at its feet, +Z its
// facing, +Y up, +X its left); the room's is instance-local yards.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import {
  SMITH_HEART_CASTS,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_MOBS,
} from '../../sim/content/smith_heart';
import { HEART_ROOM } from '../../sim/content/smith_heart_layout';
import { HEART_CORE_BED_Y } from '../smith_heart/heart_room_kit_plan_core';
import { fxHash } from './hammer_fx_core';

/** The boss whose body this is, and its casts. */
export const FINAL_BOSS = SMITH_HEART_FINAL_BOSS;
export const FORGE_WRATH = SMITH_HEART_CASTS.finalWrath;
export const FORGE_POUR = SMITH_HEART_CASTS.finalPour;
/** The arc cleave's cue (mob_swing.ts emits it as the cleave lands). */
export const FORGE_FIST_CUE = 'brood_cleave';

/** The sim's own numbers (read, never tuned here). */
export function finalBossKit(): {
  fistRange: number;
  fistArcDeg: number;
  wrathRadius: number;
  wrathCast: number;
  pourRange: number;
  pourArcDeg: number;
  pourCast: number;
} {
  const m = SMITH_HEART_MOBS[FINAL_BOSS];
  const k = m?.trashKit;
  return {
    fistRange: m?.arcCleave?.range ?? 9,
    fistArcDeg: m?.arcCleave?.arcDeg ?? 110,
    wrathRadius: k?.nova?.radius ?? 40,
    wrathCast: k?.nova?.castTime ?? 3,
    pourRange: k?.cone?.range ?? 22,
    pourArcDeg: k?.cone?.arcDeg ?? 70,
    pourCast: k?.cone?.castTime ?? 2.5,
  };
}

/** The palette (linear 0..1): the heart's white-gold, its gold, the veins'
 *  four colours for the threads and the shockwave, dust, the crust a pour
 *  leaves. */
export const FINAL_FX_COLORS = {
  core: [1.0, 0.95, 0.8] as const,
  gold: [1.0, 0.76, 0.36] as const,
  dust: [0.42, 0.38, 0.36] as const,
  dustDark: [0.26, 0.23, 0.23] as const,
  spark: [1.0, 0.86, 0.55] as const,
  crust: [0.1, 0.085, 0.08] as const,
  /** The heart's glow on the seams (hex). */
  seam: 0xffdca0,
  ring: 0xffe6b8,
  /** The telegraphs' element accent (the threat colour is the kit's). */
  accent: 0xffe6c0,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};
const easeOut = (v: number) => 1 - (1 - clamp01(v)) ** 3;

export interface V3 {
  x: number;
  y: number;
  z: number;
}

// ---- the body ---------------------------------------------------------------------------

export type ColossusJoint =
  | 'torso'
  | 'hip'
  | 'head'
  | 'shoulder'
  | 'upper'
  | 'fore'
  | 'fist'
  | 'shard';

/** One rock piece of the body: its kit piece, the joint it rides, which side
 *  (-1 right, 1 left, 0 the middle), where it rests in the room before the
 *  heart wakes (a bearing and radius from the platform's centre, half sunk
 *  in the paving, or `chasm`: under the platform's lip, out of sight), and
 *  when the heart tears it out (`order`). */
export interface ColossusPiece {
  id: string;
  piece: string;
  joint: ColossusJoint;
  side: -1 | 0 | 1;
  /** Its size (yards across), for its dust and its socket. */
  size: number;
  scale: number;
  rest: { bearing: number; r: number; chasm: boolean };
  order: number;
}

/** The fixed joints' slots in the body's frame (yards). The heart sits in
 *  the torso's socket, a little proud of it. */
export const COLOSSUS_SLOTS = {
  heart: { x: 0, y: 12.6, z: 2.4 },
  torso: { x: 0, y: 12.0, z: -0.6 },
  hip: { x: 0, y: 6.6, z: -0.3 },
  head: { x: 0, y: 18.4, z: 0.4 },
  shoulder: { x: 6.6, y: 15.4, z: -0.5 },
} as const;
/** The arm: its shoulder joint (X mirrored per side), its two lengths. */
export const COLOSSUS_ARM = {
  root: { x: 7.4, y: 14.6, z: -0.2 },
  upper: 6.8,
  fore: 6.4,
  /** The wrist at rest: hanging a little forward and out. */
  idle: { x: 8.6, y: 3.4, z: 2.8 },
} as const;
/** The floating skirt of shards round its hips, and those over its back. */
export const COLOSSUS_SHARDS = { skirt: 6, back: 4, skirtR: 4.6, backR: 5.4 } as const;

const SHARD_PIECES = ['Kit_ColShardA', 'Kit_ColShardB', 'Kit_ColShardC'];

/** Every piece of the body, in the order the heart tears them out. The rest
 *  spots lie on the platform's walk between the altars and the channels,
 *  never on the bridge's line (where the raid walks in) nor an altar; the
 *  shards rise out of the chasm under the lip. */
export const COLOSSUS_PIECES: readonly ColossusPiece[] = (() => {
  const out: ColossusPiece[] = [];
  const big: [string, string, ColossusJoint, -1 | 0 | 1, number, number, number, number][] = [
    // id, piece, joint, side, size, scale, bearing, r
    ['hip', 'Kit_ColHip', 'hip', 0, 8, 1.2, 340, 27],
    ['torso', 'Kit_ColTorso', 'torso', 0, 11, 1.25, 20, 30],
    ['shoulderL', 'Kit_ColShoulder', 'shoulder', 1, 6.8, 1.35, 120, 29],
    ['shoulderR', 'Kit_ColShoulder', 'shoulder', -1, 6.8, 1.35, 300, 29],
    ['upperL', 'Kit_ColUpperArm', 'upper', 1, 7.8, 1.2, 150, 23],
    ['upperR', 'Kit_ColUpperArm', 'upper', -1, 7.8, 1.2, 325, 21],
    ['foreL', 'Kit_ColForearm', 'fore', 1, 7.5, 1.25, 104, 35],
    ['foreR', 'Kit_ColForearm', 'fore', -1, 7.5, 1.25, 284, 35],
    ['fistL', 'Kit_ColFist', 'fist', 1, 5.8, 1.45, 162, 33],
    ['fistR', 'Kit_ColFist', 'fist', -1, 5.8, 1.45, 252, 31],
    ['head', 'Kit_ColHead', 'head', 0, 5.7, 1.3, 62, 33],
  ];
  big.forEach(([id, piece, joint, side, size, scale, bearing, r], i) => {
    out.push({ id, piece, joint, side, size, scale, rest: { bearing, r, chasm: false }, order: i });
  });
  const n = COLOSSUS_SHARDS.skirt + COLOSSUS_SHARDS.back;
  for (let i = 0; i < n; i++) {
    out.push({
      id: `shard${i}`,
      piece: SHARD_PIECES[i % SHARD_PIECES.length],
      joint: 'shard',
      side: 0,
      size: 1.6 + (i % 3) * 0.8,
      scale: 0.85 + 0.35 * fxHash(91, i),
      rest: { bearing: (i * 360) / n + 13, r: 50 + 4 * fxHash(93, i), chasm: true },
      order: i,
    });
  }
  return out;
})();

/** A rest spot in room-local yards (the piece's centre). */
export function colossusRestPoint(p: ColossusPiece): V3 {
  const a = (p.rest.bearing * Math.PI) / 180;
  const y = p.rest.chasm
    ? HEART_ROOM.h - 14 - 6 * fxHash(95, p.order)
    : HEART_ROOM.h + p.size * 0.22;
  return {
    x: HEART_ROOM.x + Math.sin(a) * p.rest.r,
    y,
    z: HEART_ROOM.z + Math.cos(a) * p.rest.r,
  };
}

/** A rest piece's tilt (radians about X and Z): fallen, not placed. */
export function colossusRestTilt(p: ColossusPiece): { x: number; y: number; z: number } {
  return {
    x: (fxHash(97, p.order + (p.joint === 'shard' ? 40 : 0)) - 0.5) * 0.9,
    y: fxHash(98, p.order) * Math.PI * 2,
    z: (fxHash(99, p.order + (p.joint === 'shard' ? 40 : 0)) - 0.5) * 0.9,
  };
}

/** A shard's place in the body's frame at render time `t` (they turn slowly
 *  round the hips and the back). */
export function colossusShardSlot(index: number, t: number): V3 {
  const S = COLOSSUS_SHARDS;
  if (index < S.skirt) {
    const a = (index / S.skirt) * Math.PI * 2 + t * 0.22;
    return {
      x: Math.sin(a) * S.skirtR,
      y: 3.2 + 0.9 * Math.sin(t * 0.9 + index * 1.7),
      z: Math.cos(a) * S.skirtR - 0.3,
    };
  }
  const j = index - S.skirt;
  const a = -1.1 + (j / Math.max(1, S.back - 1)) * 2.2 + 0.12 * Math.sin(t * 0.5 + j);
  return {
    x: Math.sin(a) * S.backR,
    y: 15.5 + 1.6 * Math.cos(a * 1.3) + 0.5 * Math.sin(t * 0.7 + j * 2.1),
    z: -Math.cos(a) * S.backR - 1.2,
  };
}

/** The body's slow breath: how far it bobs and how far its pieces drift off
 *  their joints (the light stretching between them), by render time. */
export function colossusBreath(t: number): { bob: number; drift: number } {
  return { bob: 0.55 * Math.sin(t * 0.9), drift: 0.35 + 0.2 * Math.sin(t * 1.3 + 0.7) };
}

/** Two-bone reach: the elbow for a shoulder at `s` and a wrist target at
 *  `w` (the target pulled in to the arm's reach), the elbow bent out along
 *  `pole`. Returns the elbow and the wrist actually reached. */
export function colossusArmIk(
  s: V3,
  w: V3,
  l1: number,
  l2: number,
  pole: V3,
): { elbow: V3; wrist: V3 } {
  let dx = w.x - s.x;
  let dy = w.y - s.y;
  let dz = w.z - s.z;
  let d = Math.hypot(dx, dy, dz);
  const reach = (l1 + l2) * 0.999;
  const lo = Math.abs(l1 - l2) * 1.001 + 1e-6;
  const dd = Math.max(lo, Math.min(reach, d || lo));
  if (d < 1e-9) {
    dx = 0;
    dy = -1;
    dz = 0;
    d = 1;
  }
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  const wrist = { x: s.x + ux * dd, y: s.y + uy * dd, z: s.z + uz * dd };
  // Along the line to the wrist, then out along the pole's part across it.
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pd = pole.x * ux + pole.y * uy + pole.z * uz;
  let px = pole.x - ux * pd;
  let py = pole.y - uy * pd;
  let pz = pole.z - uz * pd;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl;
  py /= pl;
  pz /= pl;
  return {
    elbow: { x: s.x + ux * a + px * h, y: s.y + uy * a + py * h, z: s.z + uz * a + pz * h },
    wrist,
  };
}

// ---- the poses ------------------------------------------------------------------------------

export type ColossusAction = 'idle' | 'swing' | 'fist' | 'wrath' | 'pour';

/** Where one wrist (side 1 left, -1 right) wants to be in the body's frame
 *  for an action at `k` (its own 0..1 clock): the idle hang, a swing at the
 *  tank, Forge Fist's two-fisted slam into the floor ahead, Forge Wrath's
 *  arms flung up over its bar, Forge Pour's hands cupped forward. And how far
 *  the body leans in (radians, forward). */
export function colossusWristTarget(
  action: ColossusAction,
  side: -1 | 1,
  k: number,
  swingSide: -1 | 1 = 1,
): { wrist: V3; lean: number } {
  const I = COLOSSUS_ARM.idle;
  const idle = { x: side * I.x, y: I.y, z: I.z };
  const lerp = (a: V3, b: V3, t: number): V3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  });
  if (action === 'swing') {
    if (side !== swingSide) return { wrist: idle, lean: 0.05 };
    const up = { x: side * 7.4, y: 13.5, z: 3.4 };
    const hit = { x: side * 2.6, y: 3.6, z: 9.0 };
    const t = clamp01(k);
    const w =
      t < 0.35
        ? lerp(idle, up, smooth(t / 0.35))
        : t < 0.55
          ? lerp(up, hit, smooth((t - 0.35) / 0.2))
          : lerp(hit, idle, smooth((t - 0.55) / 0.45));
    return { wrist: w, lean: 0.12 * Math.sin(Math.PI * t) };
  }
  if (action === 'fist') {
    // Both fists up, then down into the floor ahead (the cleave's arc).
    const up = { x: side * 3.8, y: 19.5, z: 2.6 };
    const hit = { x: side * 2.8, y: 1.0, z: 8.2 };
    const t = clamp01(k);
    const w =
      t < 0.2
        ? lerp(idle, up, smooth(t / 0.2))
        : t < 0.34
          ? lerp(up, hit, ((t - 0.2) / 0.14) ** 2)
          : t < 0.62
            ? hit
            : lerp(hit, idle, smooth((t - 0.62) / 0.38));
    const lean =
      t < 0.2 ? -0.08 * smooth(t / 0.2) : t < 0.62 ? 0.32 : 0.32 * (1 - smooth((t - 0.62) / 0.38));
    return { wrist: w, lean };
  }
  if (action === 'wrath') {
    const up = { x: side * 10.2, y: 20.6, z: -0.4 };
    return { wrist: lerp(idle, up, smooth(k / 0.7)), lean: -0.14 * smooth(k / 0.7) };
  }
  if (action === 'pour') {
    const cup = { x: side * 1.8, y: 10.2, z: 6.8 };
    return { wrist: lerp(idle, cup, smooth(k / 0.6)), lean: 0.22 * smooth(k / 0.6) };
  }
  return { wrist: idle, lean: 0 };
}

/** Seconds a swing, a Forge Fist and a released cast take. */
export const COLOSSUS_SWING_SECONDS = 0.9;
export const COLOSSUS_FIST_SECONDS = 1.5;
/** Forge Fist's floor strike lands this far into its pose. */
export const COLOSSUS_FIST_IMPACT = 0.34;
export const COLOSSUS_RELEASE_SECONDS = 1.1;

// ---- the arrival ----------------------------------------------------------------------------

/** The arrival's timeline (seconds after the heart woke): a breath while the
 *  raid's view clears of the hop, the heart rising out of its bed beyond the
 *  platform's far rim and gliding in to the body's heart, the pieces torn
 *  out one by one (each trembling, lifting free with its dust, flying in a
 *  spiral round the heart, locking with a flash), the shards rising out of
 *  the chasm meanwhile, then the shockwave as the last piece locks. */
export const ARRIVAL = {
  hold: 1.1,
  riseEnd: 4.9,
  glideEnd: 6.3,
  firstTear: 4.4,
  step: 0.42,
  tremble: 0.55,
  lift: 0.75,
  fly: 1.6,
  shardFirst: 4.0,
  shardStep: 0.28,
  /** After the last lock, the shockwave; then the body settles. */
  waveDelay: 0.25,
  waveSeconds: 1.8,
  settle: 1.0,
} as const;

const BIG = COLOSSUS_PIECES.filter((p) => p.joint !== 'shard').length;

/** When the heart tears a piece out. */
export function colossusTearAt(p: ColossusPiece): number {
  return p.joint === 'shard'
    ? ARRIVAL.shardFirst + p.order * ARRIVAL.shardStep
    : ARRIVAL.firstTear + p.order * ARRIVAL.step;
}

/** When a piece locks into the body. */
export function colossusLockAt(p: ColossusPiece): number {
  const lift = p.joint === 'shard' ? ARRIVAL.lift * 0.5 : ARRIVAL.lift;
  const tremble = p.joint === 'shard' ? 0 : ARRIVAL.tremble;
  return colossusTearAt(p) + tremble + lift + ARRIVAL.fly;
}

/** The last lock, the shockwave and the end of the arrival. */
export function arrivalLastLock(): number {
  let t = 0;
  for (const p of COLOSSUS_PIECES) t = Math.max(t, colossusLockAt(p));
  return t;
}
export const ARRIVAL_WAVE_AT = arrivalLastLock() + ARRIVAL.waveDelay;
export const ARRIVAL_END = ARRIVAL_WAVE_AT + ARRIVAL.waveSeconds + ARRIVAL.settle;

export type ArrivalPhase = 'rest' | 'tremble' | 'lift' | 'fly' | 'locked';

/** A piece at `t` seconds after the heart woke: its phase and its share
 *  through it. */
export function colossusPiecePhase(
  p: ColossusPiece,
  t: number,
): { phase: ArrivalPhase; k: number } {
  const t0 = colossusTearAt(p);
  const tremble = p.joint === 'shard' ? 0 : ARRIVAL.tremble;
  const lift = p.joint === 'shard' ? ARRIVAL.lift * 0.5 : ARRIVAL.lift;
  if (t < t0) return { phase: 'rest', k: 0 };
  if (t < t0 + tremble) return { phase: 'tremble', k: (t - t0) / tremble };
  if (t < t0 + tremble + lift) return { phase: 'lift', k: (t - t0 - tremble) / lift };
  const f = t0 + tremble + lift;
  if (t < f + ARRIVAL.fly) return { phase: 'fly', k: (t - f) / ARRIVAL.fly };
  return { phase: 'locked', k: Math.min(1, (t - f - ARRIVAL.fly) / 0.4) };
}

/** How high a torn piece lifts over its rest before it flies (yards). */
export function colossusLiftHeight(p: ColossusPiece): number {
  return p.joint === 'shard' ? 8 : 2.4 + p.size * 0.35;
}

/** A piece flying in (`k` 0..1) from where it lifted to its slot: a spiral
 *  round the heart, tightening and rising as it comes, easing into the
 *  slot. `centre` is the heart (room-local). Returns room-local yards. */
export function colossusFlyPoint(from: V3, to: V3, centre: V3, k: number, turns: number): V3 {
  const e = smooth(k);
  const bx = from.x + (to.x - from.x) * e;
  const by = from.y + (to.y - from.y) * e + Math.sin(Math.PI * clamp01(k)) * 4;
  const bz = from.z + (to.z - from.z) * e;
  // The orbit: round the heart's vertical axis, its radius dying away.
  const ox = bx - centre.x;
  const oz = bz - centre.z;
  const a = turns * Math.PI * 2 * (1 - e) * (1 - e) * 0.5;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: centre.x + ox * c - oz * s, y: by, z: centre.z + ox * s + oz * c };
}

/** How fast a flying piece tumbles (turns per second, dying to none as it
 *  locks) by its share through the flight. */
export function colossusSpin(k: number): number {
  return 1.4 * (1 - smooth(k)) ** 1.5;
}

/** Where the heart rises (room-local): out of its bed straight up past the
 *  platform's far rim (bearing 45, the side the raid faces from the
 *  terrace), then gliding in over the platform to the body's heart. */
export const HEART_RISE_FROM = (() => {
  const a = Math.PI / 4;
  return { x: HEART_ROOM.x + Math.sin(a) * 54, z: HEART_ROOM.z + Math.cos(a) * 54 };
})();

/** The heart at `t` seconds after it woke, toward `slot` (its place in the
 *  body, room-local): its point, and how bright it burns (it wakes dim and
 *  blazes as it rises). */
export function heartArrivalPoint(t: number, slot: V3): { p: V3; glow: number; rising: boolean } {
  const A = ARRIVAL;
  const bed = { x: HEART_ROOM.x, y: HEART_CORE_BED_Y, z: HEART_ROOM.z };
  const top = { x: HEART_RISE_FROM.x, y: HEART_ROOM.h + 16, z: HEART_RISE_FROM.z };
  if (t < A.hold) return { p: bed, glow: 0.35 + 0.15 * smooth(t / A.hold), rising: false };
  if (t < A.riseEnd) {
    // Out of the bed, along the chasm to the far rim, rising.
    const k = (t - A.hold) / (A.riseEnd - A.hold);
    const e = smooth(k);
    return {
      p: {
        x: bed.x + (top.x - bed.x) * smooth(k * 1.3),
        y: bed.y + (top.y - bed.y) * e,
        z: bed.z + (top.z - bed.z) * smooth(k * 1.3),
      },
      glow: 0.5 + 0.5 * e,
      rising: true,
    };
  }
  if (t < A.glideEnd) {
    const k = smooth((t - A.riseEnd) / (A.glideEnd - A.riseEnd));
    return {
      p: {
        x: top.x + (slot.x - top.x) * k,
        y: top.y + (slot.y - top.y) * k + Math.sin(Math.PI * k) * 3,
        z: top.z + (slot.z - top.z) * k,
      },
      glow: 1,
      rising: false,
    };
  }
  return { p: slot, glow: 1, rising: false };
}

/** The arrival's shockwave at `t` (0..1 through it, -1 before or after). */
export function arrivalWave(t: number): number {
  const k = (t - ARRIVAL_WAVE_AT) / ARRIVAL.waveSeconds;
  return k < 0 || k > 1 ? -1 : k;
}

/** A pull during the arrival skips it: the scene runs on to its end over
 *  this long (the fight is never kept waiting on a show). */
export const ARRIVAL_SKIP_SECONDS = 0.8;

// ---- the death ------------------------------------------------------------------------------

/** The fall's timeline (seconds after the body died): the heart flickers
 *  and the veins go out of it, the threads snap one by one, each piece
 *  falls (outward, tumbling), lands and crumbles to rubble, or tumbles off
 *  the platform's lip into the chasm; then the dark heart sinks into its
 *  bed. */
export const DEATH = {
  firstFall: 0.5,
  fallStep: 0.09,
  fallSeconds: 1.2,
  crumbleSeconds: 0.8,
  chasmSeconds: 2.6,
  darkAt: 2.0,
  darkSeconds: 1.6,
  heartSinkAt: 3.2,
  heartSinkSeconds: 4.5,
} as const;

/** Where a piece of the fallen body ends (room-local), and whether it goes
 *  over the lip into the chasm. Hashed outward from where the body stood. */
export function colossusFallPlan(
  p: ColossusPiece,
  from: V3,
  index: number,
): { land: V3; chasm: boolean; start: number } {
  const a = fxHash(131, index) * Math.PI * 2;
  const reach = 4 + 10 * fxHash(137, index) + (p.joint === 'shard' ? 6 : 0);
  let x = from.x + Math.sin(a) * reach;
  let z = from.z + Math.cos(a) * reach;
  const r = Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z);
  const chasm = r > HEART_ROOM.r - 1.5 || (p.joint === 'shard' && fxHash(139, index) < 0.5);
  if (chasm && r <= HEART_ROOM.r - 1.5) {
    // Flung on over the lip.
    const k = (HEART_ROOM.r + 6) / Math.max(1, r);
    x = HEART_ROOM.x + (x - HEART_ROOM.x) * k;
    z = HEART_ROOM.z + (z - HEART_ROOM.z) * k;
  }
  return {
    land: { x, y: chasm ? HEART_ROOM.h - 60 : HEART_ROOM.h + 0.2, z },
    chasm,
    start: DEATH.firstFall + index * DEATH.fallStep,
  };
}

/** A fallen piece at `t` after the death (`plan` from colossusFallPlan):
 *  falling (`k` its share), crumbling (shrinking into its dust), gone or
 *  still held. */
export function colossusFallPhase(
  plan: { chasm: boolean; start: number },
  t: number,
): { phase: 'held' | 'fall' | 'crumble' | 'gone'; k: number } {
  if (t < plan.start) return { phase: 'held', k: 0 };
  const fall = plan.chasm ? DEATH.chasmSeconds : DEATH.fallSeconds;
  if (t < plan.start + fall) return { phase: 'fall', k: (t - plan.start) / fall };
  if (plan.chasm) return { phase: 'gone', k: 1 };
  const c = t - plan.start - fall;
  if (c < DEATH.crumbleSeconds) return { phase: 'crumble', k: c / DEATH.crumbleSeconds };
  return { phase: 'gone', k: 1 };
}

/** The heart's light after the death: 1 burning, toward 0 dark. */
export function heartDeathLevel(t: number): number {
  if (t < DEATH.darkAt) {
    // Flickering as the veins go out.
    const f = 0.7 + 0.3 * Math.sin(t * 31) * Math.sin(t * 7.3);
    return f * (1 - 0.3 * smooth(t / DEATH.darkAt));
  }
  return 0.7 * (1 - easeOut((t - DEATH.darkAt) / DEATH.darkSeconds));
}

/** How far the dark heart has sunk back toward its bed (0 to 1). */
export function heartSink(t: number): number {
  return smooth((t - DEATH.heartSinkAt) / DEATH.heartSinkSeconds);
}

/** The fall settles after this long (a later sight of the dead body shows
 *  the room as it ends: rubble, the heart dark in its bed). */
export const DEATH_END = DEATH.heartSinkAt + DEATH.heartSinkSeconds + 0.5;

// ---- Forge Wrath and Forge Pour ---------------------------------------------------------------

/** Forge Wrath over its bar (`progress` 0..1): how hard the light gathers
 *  into the heart, how far the pieces part (the body drawing breath). */
export function wrathGather(progress: number): { glow: number; part: number } {
  const p = clamp01(progress);
  return { glow: 0.3 + 0.7 * smooth(p / 0.9), part: 1.6 * smooth(p) };
}

/** Forge Wrath landing `elapsed` seconds ago: the flash, the wall of light
 *  riding out to the nova's radius on the trash engine's wave clock (its
 *  front at `front` of the radius), the afterglow. */
export function wrathBlastLook(
  elapsed: number,
  front: number,
): {
  flash: number;
  wall: number;
  glow: number;
} {
  return {
    flash: Math.max(0, 1 - elapsed / 0.35),
    wall: clamp01(front) < 1 ? 1 : Math.max(0, 1 - (elapsed - 0.5) / 0.5),
    glow: Math.max(0, 1 - elapsed / 1.6),
  };
}

/** Forge Pour over its bar: the fire gathering in the cupped hands. */
export function pourGather(progress: number): number {
  return 0.2 + 0.8 * smooth(clamp01(progress) / 0.9);
}

/** Forge Pour landing `elapsed` seconds ago: how far down the cone the
 *  torrent has run (a share of its range), how hot it burns, how far the
 *  floor has crusted over. */
export const POUR_FLOW_SECONDS = 0.45;
export const POUR_LINGER_SECONDS = 3.4;
export function pourFlowLook(elapsed: number): { front: number; heat: number; crust: number } {
  return {
    front: easeOut(elapsed / POUR_FLOW_SECONDS),
    heat: elapsed < POUR_FLOW_SECONDS ? 1 : Math.max(0, 1 - (elapsed - POUR_FLOW_SECONDS) / 1.4),
    crust:
      smooth((elapsed - 0.6) / 1.6) * (1 - smooth((elapsed - POUR_LINGER_SECONDS + 0.8) / 0.8)),
  };
}

/** The pools (fixed, allocated at build). */
export const FINAL_FX_POOLS = {
  threads: COLOSSUS_PIECES.length,
  sockets: BIG,
  rubble: BIG,
  particles: 900,
} as const;
